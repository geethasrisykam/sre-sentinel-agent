import type { Content, Part } from '@google/genai';
import type { AgentTurn, IncidentRecord, ProposedRemediation } from '@sre-sentinel/shared';
import { log } from '../logger.js';
import { GeminiClient } from './gemini.js';
import { getDeployments, getLogs, getProblem } from './mock-diagnosis.js';
import { SYSTEM_PROMPT } from './prompt.js';

const MAX_TURNS = 6;

export class AgentRunner {
  constructor(private readonly gemini: GeminiClient) {}

  async diagnose(incident: IncidentRecord): Promise<ProposedRemediation | null> {
    const initialPrompt = this.buildInitialPrompt(incident);
    const contents: Content[] = [
      { role: 'user', parts: [{ text: initialPrompt }] },
    ];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await this.gemini.generate(SYSTEM_PROMPT, contents);

      // Tool calls path
      if (response.toolCalls.length > 0) {
        const modelParts: Part[] = response.toolCalls.map((c) => ({
          functionCall: { name: c.name, args: c.args, id: c.id },
        }));
        contents.push({ role: 'model', parts: modelParts });

        const toolResponses: Part[] = [];
        for (const call of response.toolCalls) {
          const result = this.executeDiagnosisTool(call.name, call.args);
          incident.agentTurns.push(this.recordTurn(call.name, call.args, result));
          toolResponses.push({
            functionResponse: {
              name: call.name,
              id: call.id,
              response: { result } as Record<string, unknown>,
            },
          });
        }
        contents.push({ role: 'user', parts: toolResponses });
        continue;
      }

      // Final text path — parse remediation proposal
      if (response.text) {
        const proposal = this.parseProposal(response.text);
        if (proposal) {
          incident.agentTurns.push({
            at: new Date().toISOString(),
            thought: 'Final remediation proposed.',
          });
          return proposal;
        }
        log.warn('agent.parse.failed', { incidentId: incident.id, text: response.text });
        return null;
      }

      // Neither tool nor text — bail out
      log.warn('agent.empty.response', { incidentId: incident.id, turn });
      return null;
    }

    log.warn('agent.max.turns.exceeded', { incidentId: incident.id });
    return null;
  }

  private buildInitialPrompt(incident: IncidentRecord): string {
    return [
      `A new Dynatrace problem has fired. Diagnose it and propose exactly one remediation.`,
      ``,
      `Problem ID: ${incident.problemId}`,
      `Title: ${incident.problemTitle}`,
      `Affected entity: ${incident.affectedEntity}`,
      `Severity: ${incident.severity}`,
      ``,
      `Start by calling getProblem to pull the full context.`,
    ].join('\n');
  }

  private executeDiagnosisTool(name: string, args: Record<string, unknown>): unknown {
    log.info('agent.tool.call', { name, args });
    try {
      switch (name) {
        case 'getProblem':
          return getProblem(String(args.problemId));
        case 'getDeployments':
          return getDeployments(String(args.entityId), Number(args.lookbackMinutes ?? 60));
        case 'getLogs':
          return getLogs(
            String(args.entityId),
            Number(args.sinceMinutes ?? 15),
            Number(args.limit ?? 20),
          );
        default:
          return { error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('agent.tool.error', { name, args, message });
      return { error: message };
    }
  }

  private recordTurn(name: string, args: Record<string, unknown>, result: unknown): AgentTurn {
    return {
      at: new Date().toISOString(),
      thought: `Called diagnosis tool: ${name}`,
      toolCall: { name, args },
      toolResult: { ok: !(typeof result === 'object' && result !== null && 'error' in result), data: result },
    };
  }

  private parseProposal(text: string): ProposedRemediation | null {
    // Strip code fences if Gemini wrapped the JSON in ```json ... ```
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    try {
      const parsed = JSON.parse(cleaned) as Partial<ProposedRemediation>;
      if (
        typeof parsed.tool === 'string' &&
        typeof parsed.args === 'object' &&
        parsed.args !== null &&
        typeof parsed.rationale === 'string' &&
        typeof parsed.riskAssessment === 'string'
      ) {
        return parsed as ProposedRemediation;
      }
    } catch {
      // fall through
    }
    return null;
  }
}
