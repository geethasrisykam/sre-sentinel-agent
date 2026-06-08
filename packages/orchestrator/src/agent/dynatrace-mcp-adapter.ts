import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { log } from '../logger.js';
import type {
  DiagnosisAdapter,
  GetDeploymentsArgs,
  GetLogsArgs,
  GetProblemArgs,
} from './diagnosis-adapter.js';

// DiagnosisAdapter backed by the official @dynatrace-oss/dynatrace-mcp-server
// (v1.8.x), spawned over stdio. The MCP exposes a fixed tool surface — the
// names and shapes here are taken from the package source rather than
// guessed:
//
//   - list_problems(timeframe, status, additionalFilter, maxProblemsToDisplay)
//   - execute_dql(dqlStatement, recordLimit, recordSizeLimitMB)
//   - find_entity_by_name(entityNames, maxEntitiesToDisplay, extendedSearch)
//   - get_kubernetes_events(timeframe, clusterId, kubernetesEntityId, eventType)
//   - …and a number of other tools we don't use here.
//
// `list_problems` returns a templated human-readable text response (not JSON),
// so for the structured problem record we use `execute_dql` directly against
// `dt.davis.problems`. `execute_dql` returns BOTH a markdown text blob AND a
// `_meta.records` array — extractStructured() prefers _meta.records when
// available and falls back to parsing the embedded ```json``` block.
//
// Activation: set DYNATRACE_ENVIRONMENT_URL + DYNATRACE_API_TOKEN in
// .env.local. The token MUST be a Platform Token (prefix `dt0s16.`); the
// MCP only speaks Bearer auth and a classic API Token (`dt0c01.`) fails the
// connection test with "Could not parse JWT". See docs/DYNATRACE_TUNING.md
// for the full scope list.

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
    // The MCP rejects `https://*.apps.dynatrace.com/` with a trailing slash
    // in some code paths; normalize defensively so we don't depend on
    // .env.local hygiene.
    const env = this.options.environmentUrl.replace(/\/+$/, '');
    this.transport = new StdioClientTransport({
      command: this.options.command ?? (process.platform === 'win32' ? 'npx.cmd' : 'npx'),
      args: this.options.args ?? ['-y', '@dynatrace-oss/dynatrace-mcp-server@latest'],
      env: {
        ...process.env,
        DT_ENVIRONMENT: env,
        DT_PLATFORM_TOKEN: this.options.apiToken,
        // Telemetry is opt-in. Keep the orchestrator quiet by default; the
        // user can flip this off explicitly if they want Dynatrace's beacon.
        DT_MCP_DISABLE_TELEMETRY: process.env.DT_MCP_DISABLE_TELEMETRY ?? 'true',
      },
    });
    this.client = new Client(
      { name: 'sre-sentinel-orchestrator', version: '0.1.0' },
      { capabilities: {} },
    );
    await this.client.connect(this.transport);
    const tools = await this.client.listTools();
    log.info('dynatrace.mcp.connected', {
      environment: env,
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

  // Fetch the full problem record. list_problems returns a chatty human-readable
  // string, which is hard for the agent to reason about — instead we issue the
  // recommended `fetch dt.davis.problems` DQL directly (the same query
  // list_problems suggests in its "Next Steps" tail). That gives us a structured
  // record we can hand back as JSON.
  async getProblem(args: GetProblemArgs): Promise<unknown> {
    // The problem_id field in Grail is the bare UUID; the display id (P-...)
    // lives in `display_id`. We match against both so either form works.
    const escaped = escapeDqlString(args.problemId);
    const dql = [
      `fetch dt.davis.problems, from: now()-72h, to: now()`,
      `| filter event.id == "${escaped}" or problem_id == "${escaped}" or display_id == "${escaped}"`,
      `| fields event.id, display_id, problem_id, event.name, event.description, event.status,`,
      `         event.category, event.start, event.end, duration, affected_entity_ids,`,
      `         affected_entity_count, affected_users_count, root_cause_entity_id,`,
      `         root_cause_entity_name, entity_tags, labels.alerting_profile`,
      `| limit 1`,
    ].join('\n');
    const result = await this.call('execute_dql', { dqlStatement: dql, recordLimit: 1 });
    const records = this.extractRecords(result);
    if (records && records.length > 0) return records[0];
    if (records) {
      // Empty result — surface a tidy "not found" so the agent can degrade
      // gracefully instead of staring at a stray markdown blob.
      return {
        error: `No Dynatrace problem matched problemId=${args.problemId} in the last 72h.`,
        problemId: args.problemId,
      };
    }
    // Could not extract records at all — return the raw text so the agent at
    // least has something to reason about.
    return this.extractStructured(result) ?? result;
  }

  // Recent deployments to an entity. Dynatrace tracks deploys as events with
  // event.kind == "CUSTOM_DEPLOYMENT" (the canonical event.kind emitted by
  // the v2 Events API and by Dynatrace's deployment integrations).
  // affected_entity_ids is a multi-value column, so we match with `in`.
  async getDeployments(args: GetDeploymentsArgs): Promise<unknown> {
    const escaped = escapeDqlString(args.entityId);
    const timeframe = `${Math.max(1, Math.floor(args.lookbackMinutes))}m`;
    const dql = [
      `fetch events, from: now()-${timeframe}, to: now()`,
      `| filter event.kind == "CUSTOM_DEPLOYMENT"`,
      `| filter in("${escaped}", affected_entity_ids) or dt.entity.service == "${escaped}" or dt.entity.host == "${escaped}"`,
      `| fields timestamp, event.id, event.name, event.description, deployment.name,`,
      `         deployment.version, deployment.project, deployment.release_stage,`,
      `         deployment.release_product, dt.entity.service, dt.entity.host,`,
      `         affected_entity_ids`,
      `| sort timestamp desc`,
      `| limit 10`,
    ].join('\n');
    const result = await this.call('execute_dql', { dqlStatement: dql, recordLimit: 10 });
    const records = this.extractRecords(result);
    if (records) return { deployments: records, entityId: args.entityId, lookbackMinutes: args.lookbackMinutes };
    return this.extractStructured(result) ?? result;
  }

  // Recent log lines for an entity. The `logs` Grail table is indexed by
  // dt.entity.* — services, hosts, process_groups, and k8s workloads all
  // have their own column. We OR across the common ones because the entity
  // id format alone (e.g. SERVICE-xxxx, HOST-xxxx) doesn't tell us which
  // column to filter on, and the wrong column silently returns nothing.
  async getLogs(args: GetLogsArgs): Promise<unknown> {
    const escaped = escapeDqlString(args.entityId);
    const timeframe = `${Math.max(1, Math.floor(args.sinceMinutes))}m`;
    const limit = Math.max(1, Math.min(500, args.limit));
    const dql = [
      `fetch logs, from: now()-${timeframe}, to: now()`,
      `| filter dt.entity.service == "${escaped}"`,
      `      or dt.entity.host == "${escaped}"`,
      `      or dt.entity.process_group == "${escaped}"`,
      `      or dt.entity.kubernetes_workload == "${escaped}"`,
      `| fields timestamp, status, loglevel, content, dt.entity.service,`,
      `         dt.entity.host, dt.entity.kubernetes_workload, k8s.namespace.name,`,
      `         k8s.pod.name, container.name`,
      `| sort timestamp desc`,
      `| limit ${limit}`,
    ].join('\n');
    const result = await this.call('execute_dql', { dqlStatement: dql, recordLimit: limit });
    const records = this.extractRecords(result);
    if (records) return { logs: records, entityId: args.entityId, sinceMinutes: args.sinceMinutes };
    return this.extractStructured(result) ?? result;
  }

  private async call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error('DynatraceMcpAdapter not connected — call connect() first');
    log.info('dynatrace.mcp.call', { tool: toolName, args });
    const result = await this.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  // execute_dql returns its rows in two places: a markdown ```json``` block
  // inside content[0].text AND structured rows in `_meta.records` on the
  // tool response. _meta.records is the cleaner source — prefer it when
  // present.
  private extractRecords(result: unknown): unknown[] | null {
    if (typeof result !== 'object' || result === null) return null;
    const meta = (result as { _meta?: { records?: unknown } })._meta;
    if (meta && Array.isArray(meta.records)) return meta.records;
    const structured = this.extractStructured(result);
    if (Array.isArray(structured)) return structured;
    if (structured && typeof structured === 'object' && Array.isArray((structured as { records?: unknown }).records)) {
      return (structured as { records: unknown[] }).records;
    }
    // Try to parse a ```json``` code block out of the text content (the format
    // execute_dql uses for its embedded results).
    if (typeof result === 'object') {
      const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'text' && typeof c.text === 'string') {
            const match = c.text.match(/```json\s*([\s\S]*?)```/);
            if (match) {
              try {
                const parsed = JSON.parse(match[1]);
                if (Array.isArray(parsed)) return parsed;
              } catch {
                /* fall through */
              }
            }
          }
        }
      }
    }
    return null;
  }

  // MCP tool responses come back as `{ content: [{ type: 'text', text: '...' }] }`.
  // Some tools return JSON-stringified payloads, others return human-readable
  // markdown. Try to parse but fall back gracefully so the LLM still gets the
  // raw text.
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

// DQL strings are delimited by double quotes; the only safe escape is to drop
// embedded quotes. Entity IDs and problem IDs come from Dynatrace itself and
// are ASCII-safe in practice, but a defensive scrub keeps us out of trouble
// if the agent ever passes something hand-crafted.
function escapeDqlString(value: string): string {
  return value.replace(/["\\]/g, '');
}
