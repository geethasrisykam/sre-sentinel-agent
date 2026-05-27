import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { log } from '../logger.js';
import type {
  DiagnosisAdapter,
  GetDeploymentsArgs,
  GetLogsArgs,
  GetProblemArgs,
} from './diagnosis-adapter.js';

// DiagnosisAdapter backed by the official @dynatrace-oss/dynatrace-mcp-server,
// spawned over stdio. The real MCP exposes a different tool surface than our
// internal mock (list_problems / execute_dql / find_entity_by_name) — this
// adapter translates the runner's getProblem/getDeployments/getLogs calls into
// MCP tool calls so the rest of the system doesn't change.
//
// Activation: set DYNATRACE_ENVIRONMENT_URL + DYNATRACE_API_TOKEN in .env.local.
// Until those are set, the orchestrator falls back to MockDiagnosisAdapter
// (see config.ts).
//
// Tuning required at trial activation: the DQL queries in getDeployments and
// getLogs are best-effort placeholders. Real tenant data may use different
// column names (e.g. `dt.entity.service` may need to match a different field).
// Review with a real Dynatrace shell once the trial is live.

export interface DynatraceMcpAdapterOptions {
  environmentUrl: string;
  apiToken: string;
  // Override the spawn command for tests; defaults to npx running the published package.
  command?: string;
  args?: string[];
}

export class DynatraceMcpAdapter implements DiagnosisAdapter {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(private readonly options: DynatraceMcpAdapterOptions) {}

  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: this.options.command ?? 'npx',
      args: this.options.args ?? ['-y', '@dynatrace-oss/dynatrace-mcp-server@latest'],
      env: {
        ...process.env,
        DT_ENVIRONMENT: this.options.environmentUrl,
        DT_PLATFORM_TOKEN: this.options.apiToken,
      },
    });
    this.client = new Client(
      { name: 'sre-sentinel-orchestrator', version: '0.1.0' },
      { capabilities: {} },
    );
    await this.client.connect(this.transport);
    const tools = await this.client.listTools();
    log.info('dynatrace.mcp.connected', {
      environment: this.options.environmentUrl,
      toolCount: tools.tools.length,
      tools: tools.tools.map((t) => t.name),
    });
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close().catch(() => undefined);
      this.transport = null;
    }
  }

  async getProblem(args: GetProblemArgs): Promise<unknown> {
    const result = await this.call('list_problems', {
      // The real MCP's filter shape may differ; tune at activation time.
      problem_filter: `problemId:${args.problemId}`,
    });
    const problems = this.extractStructured(result);
    // list_problems returns a collection; pick the one matching our id.
    if (Array.isArray(problems)) {
      const match = problems.find(
        (p): p is { problemId?: string } & Record<string, unknown> =>
          typeof p === 'object' && p !== null && 'problemId' in p && (p as { problemId: unknown }).problemId === args.problemId,
      );
      if (match) return match;
    }
    // Fall back to returning the raw payload so the agent at least has SOMETHING
    // to reason about; better than throwing.
    return problems ?? result;
  }

  async getDeployments(args: GetDeploymentsArgs): Promise<unknown> {
    // DQL placeholder — real query depends on tenant configuration.
    // Common patterns: events with event.kind == DEPLOYMENT, or k8s deployment
    // events from get_kubernetes_events. Review at trial activation.
    const dql = [
      'fetch events',
      `| filter event.kind == "DEPLOYMENT_EVENT"`,
      `| filter contains(affected_entity_ids, "${args.entityId}")`,
      `| filter timestamp > now() - ${args.lookbackMinutes}m`,
      `| sort timestamp desc`,
      `| limit 10`,
    ].join('\n');
    const result = await this.call('execute_dql', { query: dql });
    return this.extractStructured(result) ?? result;
  }

  async getLogs(args: GetLogsArgs): Promise<unknown> {
    const dql = [
      'fetch logs',
      `| filter dt.entity.service == "${args.entityId}" or dt.entity.host == "${args.entityId}"`,
      `| filter timestamp > now() - ${args.sinceMinutes}m`,
      `| sort timestamp desc`,
      `| limit ${args.limit}`,
    ].join('\n');
    const result = await this.call('execute_dql', { query: dql });
    return this.extractStructured(result) ?? result;
  }

  private async call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error('DynatraceMcpAdapter not connected — call connect() first');
    log.info('dynatrace.mcp.call', { tool: toolName, args });
    const result = await this.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  // MCP tool responses come back as `{ content: [{ type: 'text', text: '...' }] }`.
  // The Dynatrace tools typically return JSON-stringified results in that text;
  // we try to parse but fall back gracefully so the LLM still gets the raw text.
  private extractStructured(result: unknown): unknown {
    if (typeof result !== 'object' || result === null) return null;
    const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
    if (!Array.isArray(content) || content.length === 0) return null;
    const first = content[0];
    if (first?.type !== 'text' || typeof first.text !== 'string') return null;
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text;
    }
  }
}
