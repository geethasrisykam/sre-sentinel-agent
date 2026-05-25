import { GoogleGenAI, Type, type FunctionDeclaration, type Content } from '@google/genai';
import { log } from '../logger.js';

export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface AgentTurnResponse {
  toolCalls: AgentToolCall[];
  text: string | null;
  rawCandidate: unknown;
}

export const DIAGNOSIS_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'getProblem',
    description:
      'Fetch the full Dynatrace problem record, including affected entities, severity, and detection signals. Always call this first to ground your investigation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        problemId: {
          type: Type.STRING,
          description: 'The Dynatrace problem ID, e.g. "P-2026-05-25-001".',
        },
      },
      required: ['problemId'],
    },
  },
  {
    name: 'getDeployments',
    description:
      'List recent deployments to a specific entity. Use this to check whether a recent code deploy correlates with the incident start time — the single most common root cause.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        entityId: {
          type: Type.STRING,
          description: 'The Dynatrace entity ID, e.g. "SERVICE-CHECKOUT-API".',
        },
        lookbackMinutes: {
          type: Type.NUMBER,
          description: 'How far back to look. 60 is a reasonable default for fresh problems.',
        },
      },
      required: ['entityId', 'lookbackMinutes'],
    },
  },
  {
    name: 'getLogs',
    description:
      'Sample recent log lines from an entity. Use this to identify error patterns, stack traces, or upstream failures that point to a root cause.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        entityId: {
          type: Type.STRING,
          description: 'The Dynatrace entity ID, e.g. "SERVICE-CHECKOUT-API".',
        },
        sinceMinutes: {
          type: Type.NUMBER,
          description: 'Look at logs from the last N minutes. 15 is typical.',
        },
        limit: {
          type: Type.NUMBER,
          description: 'Maximum number of log lines to return. 20 is plenty for diagnosis.',
        },
      },
      required: ['entityId', 'sinceMinutes', 'limit'],
    },
  },
];

export class GeminiClient {
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    log.info('gemini.init', { model });
  }

  async generate(systemInstruction: string, contents: Content[]): Promise<AgentTurnResponse> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: DIAGNOSIS_FUNCTION_DECLARATIONS }],
        temperature: 0.2,
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content) {
      return { toolCalls: [], text: null, rawCandidate: candidate };
    }

    const toolCalls: AgentToolCall[] = [];
    const textParts: string[] = [];
    for (const part of candidate.content.parts ?? []) {
      if (part.functionCall) {
        toolCalls.push({
          name: part.functionCall.name ?? '',
          args: (part.functionCall.args ?? {}) as Record<string, unknown>,
          id: part.functionCall.id,
        });
      } else if (typeof part.text === 'string') {
        textParts.push(part.text);
      }
    }

    return {
      toolCalls,
      text: textParts.length > 0 ? textParts.join('\n').trim() : null,
      rawCandidate: candidate,
    };
  }
}
