import {
  FunctionTool,
  Gemini,
  InMemoryRunner,
  LlmAgent,
  getFunctionCalls,
  getFunctionResponses,
  stringifyContent,
  type BaseLlm,
  type Event,
} from '@google/adk';
import { Type, type Schema } from '@google/genai';
import { randomUUID } from 'node:crypto';
import type { AgentTurn, IncidentRecord, ProposedRemediation } from '@sre-sentinel/shared';
import { log } from '../logger.js';
import type { DiagnosisAdapter } from './diagnosis-adapter.js';
import { SYSTEM_PROMPT } from './prompt.js';

const MAX_TURNS = 6;

export type OnTurnFn = (incident: IncidentRecord) => void;

// AgentRunner wraps Google's Agent Development Kit (the code-first surface of
// Cloud Agent Builder). The DiagnosisAdapter the rest of the orchestrator hands
// us is exposed to the LlmAgent as three FunctionTools; the runner walks ADK's
// event stream and replays it onto IncidentRecord.agentTurns so the dashboard's
// SSE timeline stays unchanged.
export class AgentRunner {
  private readonly model: BaseLlm | string;

  constructor(
    apiKeyOrModel: string | BaseLlm,
    modelName: string,
    private readonly diagnosis: DiagnosisAdapter,
  ) {
    // Two construction modes:
    //   1. (apiKey, modelName, adapter)   – production path; ADK builds a Gemini.
    //   2. (BaseLlm,       _,       adapter) – tests pass a stub BaseLlm.
    if (typeof apiKeyOrModel === 'string') {
      this.model = new Gemini({ apiKey: apiKeyOrModel, model: modelName });
    } else {
      this.model = apiKeyOrModel;
    }
  }

  async diagnose(
    incident: IncidentRecord,
    onTurn: OnTurnFn = () => undefined,
  ): Promise<ProposedRemediation | null> {
    const agent = new LlmAgent({
      name: 'sre_sentinel',
      model: this.model,
      instruction: SYSTEM_PROMPT,
      tools: this.buildTools(incident),
      generateContentConfig: { temperature: 0.2 },
      // We parse the final JSON ourselves so the dashboard sees the raw
      // proposal text; leaving outputSchema unset keeps that path open.
    });

    const runner = new InMemoryRunner({ agent, appName: 'sre-sentinel' });
    const userId = `incident:${incident.id}`;
    const session = await runner.sessionService.createSession({
      appName: 'sre-sentinel',
      userId,
    });

    let finalText: string | null = null;
    let exhausted = false;
    let errorMessage: string | null = null;

    try {
      for await (const event of runner.runAsync({
        userId,
        sessionId: session.id,
        newMessage: { role: 'user', parts: [{ text: this.buildInitialPrompt(incident) }] },
        runConfig: { maxLlmCalls: MAX_TURNS },
      })) {
        // ADK surfaces a max-llm-calls exhaustion as a trailing event with an
        // errorMessage; the underlying Error is swallowed by runAndHandleError.
        if (event.errorMessage && /max.*llm.*calls/i.test(event.errorMessage)) {
          exhausted = true;
          continue;
        }
        if (event.errorMessage && !errorMessage) {
          errorMessage = event.errorMessage;
        }
        this.replayEventToIncident(event, incident, onTurn);
        if (this.isFinalText(event)) {
          finalText = stringifyContent(event).trim();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/max.*llm.*calls/i.test(message)) {
        exhausted = true;
      } else {
        throw err;
      }
    }

    if (exhausted) {
      const reason = `Reached the ${MAX_TURNS}-turn investigation cap without producing a proposal.`;
      this.recordFailure(incident, reason, onTurn);
      log.warn('agent.max.turns.exceeded', { incidentId: incident.id });
      return null;
    }

    // Surface a non-exhaustion model error (quota, invalid argument, etc.) so
    // routes.ts can run it through humaniseAgentError. The original direct-
    // genai loop let those errors propagate as exceptions; ADK swallows them
    // and reports via Event.errorMessage, so we re-throw here.
    if (!finalText && errorMessage) {
      throw new Error(errorMessage);
    }

    if (!finalText) {
      const reason = 'Model returned no tool call and no text. Cannot continue.';
      this.recordFailure(incident, reason, onTurn);
      log.warn('agent.empty.response', { incidentId: incident.id });
      return null;
    }

    const proposal = this.parseProposal(finalText);
    if (!proposal) {
      const reason = `Final response was not a valid remediation proposal: ${truncate(finalText, 200)}`;
      this.recordFailure(incident, reason, onTurn);
      log.warn('agent.parse.failed', { incidentId: incident.id, text: finalText });
      return null;
    }

    // Attach the proposal to the incident BEFORE emitting the final turn so
    // subscribers see a complete record in one frame.
    incident.proposedRemediation = proposal;
    incident.agentTurns.push({
      at: new Date().toISOString(),
      thought: 'Final remediation proposed.',
    });
    onTurn(incident);
    return proposal;
  }

  // ADK delivers events as soon as they're produced. A single event can carry
  // multiple function calls (parallel tools) or multiple function responses;
  // each maps to one AgentTurn so the dashboard timeline shows them all.
  // The final "answer" event has neither calls nor responses, just text.
  private replayEventToIncident(event: Event, incident: IncidentRecord, onTurn: OnTurnFn): void {
    const calls = getFunctionCalls(event);
    for (const call of calls) {
      log.info('agent.tool.call', { name: call.name, args: call.args });
      // ADK will run the FunctionTool's execute() next; the tool wrapper has
      // already captured the result via the response event. The "call" event
      // alone doesn't yet have the result, so we don't emit a turn here —
      // we emit when the response event arrives below.
    }

    const responses = getFunctionResponses(event);
    for (const fr of responses) {
      // Pull the response payload out. ADK FunctionTool wraps our return value
      // as { result: <returned-value> } inside FunctionResponse.response.
      const payload = (fr.response ?? {}) as Record<string, unknown>;
      const data = 'result' in payload ? payload.result : payload;
      const matchingCall = this.findCallForResponse(event, fr.id);
      const args = (matchingCall?.args ?? {}) as Record<string, unknown>;
      incident.agentTurns.push(this.recordTurn(fr.name ?? 'unknown', args, data));
      onTurn(incident);
    }
  }

  // Sometimes the model issues a call and the framework returns the response
  // in the same Event; sometimes they're in separate events. Look in the
  // current event first; the call args are echoed alongside the function call.
  private findCallForResponse(
    event: Event,
    responseId: string | undefined,
  ): { name?: string; args?: Record<string, unknown> } | undefined {
    if (!responseId) return undefined;
    const parts = event.content?.parts ?? [];
    for (const part of parts) {
      if (part.functionCall && part.functionCall.id === responseId) {
        return { name: part.functionCall.name, args: part.functionCall.args as Record<string, unknown> | undefined };
      }
    }
    return undefined;
  }

  private isFinalText(event: Event): boolean {
    if (getFunctionCalls(event).length > 0) return false;
    if (getFunctionResponses(event).length > 0) return false;
    const text = stringifyContent(event).trim();
    return text.length > 0;
  }

  // Each FunctionTool delegates to the injected DiagnosisAdapter; the abstract
  // contract is unchanged from the previous direct-genai loop. Errors are
  // captured and returned as { error } so the model can degrade gracefully
  // instead of the run aborting.
  private buildTools(incident: IncidentRecord): FunctionTool[] {
    void incident; // reserved for future per-incident scoping
    const wrap = async (
      toolName: string,
      args: Record<string, unknown>,
      run: () => Promise<unknown>,
    ): Promise<unknown> => {
      log.info('agent.tool.call', { name: toolName, args });
      try {
        return await run();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn('agent.tool.error', { name: toolName, args, message });
        return { error: message };
      }
    };

    const getProblem = new FunctionTool({
      name: 'getProblem',
      description:
        'Fetch the full Dynatrace problem record, including affected entities, severity, and detection signals. Always call this first to ground your investigation.',
      parameters: schemaObject({
        problemId: schemaString('The Dynatrace problem ID, e.g. "P-2026-05-25-001".'),
      }, ['problemId']),
      execute: async (input) => {
        const a = input as { problemId: string };
        return wrap('getProblem', a, () => this.diagnosis.getProblem({ problemId: String(a.problemId) }));
      },
    });

    const getDeployments = new FunctionTool({
      name: 'getDeployments',
      description:
        'List recent deployments to a specific entity. Use this to check whether a recent code deploy correlates with the incident start time — the single most common root cause.',
      parameters: schemaObject({
        entityId: schemaString('The Dynatrace entity ID, e.g. "SERVICE-CHECKOUT-API".'),
        lookbackMinutes: schemaNumber('How far back to look. 60 is a reasonable default for fresh problems.'),
      }, ['entityId', 'lookbackMinutes']),
      execute: async (input) => {
        const a = input as { entityId: string; lookbackMinutes: number };
        return wrap('getDeployments', a, () =>
          this.diagnosis.getDeployments({
            entityId: String(a.entityId),
            lookbackMinutes: Number(a.lookbackMinutes ?? 60),
          }),
        );
      },
    });

    const getLogs = new FunctionTool({
      name: 'getLogs',
      description:
        'Sample recent log lines from an entity. Use this to identify error patterns, stack traces, or upstream failures that point to a root cause.',
      parameters: schemaObject({
        entityId: schemaString('The Dynatrace entity ID, e.g. "SERVICE-CHECKOUT-API".'),
        sinceMinutes: schemaNumber('Look at logs from the last N minutes. 15 is typical.'),
        limit: schemaNumber('Maximum number of log lines to return. 20 is plenty for diagnosis.'),
      }, ['entityId', 'sinceMinutes', 'limit']),
      execute: async (input) => {
        const a = input as { entityId: string; sinceMinutes: number; limit: number };
        return wrap('getLogs', a, () =>
          this.diagnosis.getLogs({
            entityId: String(a.entityId),
            sinceMinutes: Number(a.sinceMinutes ?? 15),
            limit: Number(a.limit ?? 20),
          }),
        );
      },
    });

    return [getProblem, getDeployments, getLogs];
  }

  private recordFailure(incident: IncidentRecord, reason: string, onTurn: OnTurnFn): void {
    incident.agentTurns.push({
      at: new Date().toISOString(),
      thought: `Diagnosis aborted: ${reason}`,
    });
    onTurn(incident);
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

// Tiny Schema helpers — ADK accepts @google/genai Schema for tool parameters,
// which is the same wire format the previous direct-genai loop used. Using
// these instead of Zod keeps the dependency surface flat and avoids the
// zod-v3/v4 forking that ADK's tool API papers over.
function schemaObject(properties: Record<string, Schema>, required: string[]): Schema {
  return { type: Type.OBJECT, properties, required };
}
function schemaString(description: string): Schema {
  return { type: Type.STRING, description };
}
function schemaNumber(description: string): Schema {
  return { type: Type.NUMBER, description };
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

// Used by the orchestrator boot to produce a stable incidentId-free runner id
// for telemetry. Not strictly needed by the runtime path but kept exported in
// case downstream code wants to correlate logs across ADK and our own logger.
export function newAgentInvocationId(): string {
  return randomUUID();
}
