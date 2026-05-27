import { describe, expect, it, vi } from 'vitest';
import type { IncidentRecord } from '@sre-sentinel/shared';
import { AgentRunner } from './runner.js';
import type { GeminiClient, AgentTurnResponse } from './gemini.js';

class StubGemini {
  private readonly queue: AgentTurnResponse[] = [];
  public callCount = 0;

  enqueue(response: AgentTurnResponse): this {
    this.queue.push(response);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async generate(): Promise<AgentTurnResponse> {
    this.callCount += 1;
    const next = this.queue.shift();
    if (!next) {
      throw new Error('StubGemini: no more scripted responses');
    }
    return next;
  }
}

function asGemini(stub: StubGemini): GeminiClient {
  return stub as unknown as GeminiClient;
}

function makeIncident(): IncidentRecord {
  return {
    id: 'inc-1',
    receivedAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    state: 'TRIAGING',
    problemId: 'P-2026-05-25-001',
    problemTitle: 'Response time degradation on checkout-api',
    affectedEntity: 'checkout-api',
    severity: 'high',
    agentTurns: [],
  };
}

function toolResponse(name: string, args: Record<string, unknown>): AgentTurnResponse {
  return {
    toolCalls: [{ name, args }],
    text: null,
    rawCandidate: null,
  };
}

function textResponse(text: string): AgentTurnResponse {
  return { toolCalls: [], text, rawCandidate: null };
}

const VALID_PROPOSAL_JSON = JSON.stringify({
  tool: 'restartPod',
  args: { serviceName: 'checkout-api', reason: 'connection pool exhausted' },
  rationale: 'Logs show pool exhaustion shortly after deploy v2.14.0.',
  riskAssessment: 'low',
  estimatedBlastRadius: 'One pod replaced; traffic shifted seamlessly.',
});

describe('AgentRunner.diagnose', () => {
  it('runs diagnosis tools then parses the final proposal', async () => {
    const stub = new StubGemini();
    stub
      .enqueue(toolResponse('getProblem', { problemId: 'P-2026-05-25-001' }))
      .enqueue(toolResponse('getDeployments', { entityId: 'SERVICE-CHECKOUT-API', lookbackMinutes: 60 }))
      .enqueue(textResponse(VALID_PROPOSAL_JSON));

    const runner = new AgentRunner(asGemini(stub));
    const incident = makeIncident();
    const onTurn = vi.fn();

    const proposal = await runner.diagnose(incident, onTurn);

    expect(proposal).not.toBeNull();
    expect(proposal?.tool).toBe('restartPod');
    expect(proposal?.riskAssessment).toBe('low');
    expect(stub.callCount).toBe(3);

    // Two tool turns + one "Final remediation proposed." turn = 3.
    expect(incident.agentTurns).toHaveLength(3);
    expect(incident.agentTurns[0]?.toolCall?.name).toBe('getProblem');
    expect(incident.agentTurns[1]?.toolCall?.name).toBe('getDeployments');
    expect(incident.agentTurns[2]?.thought).toMatch(/final remediation/i);
    expect(onTurn).toHaveBeenCalledTimes(3);

    // The runner attaches the proposal to the incident before the final onTurn
    // fires, so subscribers see a complete record without a transient flash.
    expect(incident.proposedRemediation).toEqual(proposal);
  });

  it('strips ```json code fences from the final text', async () => {
    const stub = new StubGemini();
    stub
      .enqueue(toolResponse('getProblem', { problemId: 'P-2026-05-25-001' }))
      .enqueue(textResponse('```json\n' + VALID_PROPOSAL_JSON + '\n```'));

    const runner = new AgentRunner(asGemini(stub));
    const proposal = await runner.diagnose(makeIncident());
    expect(proposal?.tool).toBe('restartPod');
  });

  it('returns null and appends a Diagnosis aborted turn when the final text is not valid JSON', async () => {
    const stub = new StubGemini();
    stub
      .enqueue(toolResponse('getProblem', { problemId: 'P-2026-05-25-001' }))
      .enqueue(textResponse('I think we should probably restart the pod.'));

    const runner = new AgentRunner(asGemini(stub));
    const incident = makeIncident();
    const proposal = await runner.diagnose(incident);
    expect(proposal).toBeNull();
    const lastTurn = incident.agentTurns.at(-1);
    expect(lastTurn?.thought).toMatch(/^Diagnosis aborted:.*not a valid remediation proposal/);
  });

  it('returns null and appends a Diagnosis aborted turn for empty model responses', async () => {
    const stub = new StubGemini();
    stub.enqueue({ toolCalls: [], text: null, rawCandidate: null });

    const runner = new AgentRunner(asGemini(stub));
    const incident = makeIncident();
    const proposal = await runner.diagnose(incident);
    expect(proposal).toBeNull();
    expect(incident.agentTurns.at(-1)?.thought).toMatch(/^Diagnosis aborted:.*no tool call and no text/);
  });

  it('captures tool errors in the audit turn instead of throwing', async () => {
    const stub = new StubGemini();
    stub
      .enqueue(toolResponse('getProblem', { problemId: 'does-not-exist' }))
      .enqueue(textResponse(VALID_PROPOSAL_JSON));

    const runner = new AgentRunner(asGemini(stub));
    const incident = makeIncident();
    const proposal = await runner.diagnose(incident);

    expect(proposal).not.toBeNull();
    const errorTurn = incident.agentTurns[0];
    expect(errorTurn?.toolResult?.ok).toBe(false);
    expect((errorTurn?.toolResult?.data as { error: string }).error).toMatch(/No problem with problemId/);
  });

  it('bails after MAX_TURNS without a final proposal', async () => {
    const stub = new StubGemini();
    // 6 tool-call turns; never produces text.
    for (let i = 0; i < 6; i++) {
      stub.enqueue(toolResponse('getProblem', { problemId: 'P-2026-05-25-001' }));
    }

    const runner = new AgentRunner(asGemini(stub));
    const incident = makeIncident();
    const proposal = await runner.diagnose(incident);
    expect(proposal).toBeNull();
    expect(stub.callCount).toBe(6);
    expect(incident.agentTurns.at(-1)?.thought).toMatch(/^Diagnosis aborted:.*6-turn investigation cap/);
  });
});
