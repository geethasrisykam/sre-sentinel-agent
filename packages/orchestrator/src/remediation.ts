import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { RemediationToolResult } from '@sre-sentinel/shared';
import { log } from './logger.js';

export class RemediationMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly cwd: string,
  ) {}

  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: this.command,
      args: this.args,
      cwd: this.cwd,
    });
    this.client = new Client(
      { name: 'sre-sentinel-orchestrator', version: '0.1.0' },
      { capabilities: {} },
    );
    await this.client.connect(this.transport);
    const tools = await this.client.listTools();
    log.info('remediation.mcp.connected', {
      tools: tools.tools.map((t) => t.name),
    });
  }

  async call(toolName: string, args: Record<string, unknown>): Promise<RemediationToolResult> {
    if (!this.client) throw new Error('RemediationMcpClient not connected');
    log.info('remediation.mcp.call', { toolName, args });
    const result = await this.client.callTool({ name: toolName, arguments: args });
    const firstContent = (result.content as Array<{ type: string; text?: string }> | undefined)?.[0];
    if (firstContent?.type === 'text' && firstContent.text) {
      try {
        return JSON.parse(firstContent.text) as RemediationToolResult;
      } catch (err) {
        throw new Error(`Remediation MCP returned non-JSON text: ${firstContent.text.slice(0, 200)}`);
      }
    }
    throw new Error('Remediation MCP returned no text content');
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
}
