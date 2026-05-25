#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, log } from './config.js';
import { registerRemediationTools } from './tools/register.js';

async function main(): Promise<void> {
  const config = loadConfig();
  log('boot', {
    restartPodMode: config.restartPodMode,
    rollbackMode: config.rollbackMode,
    scaleMode: config.scaleMode,
    victimAppServiceName: config.victimAppServiceName ?? null,
  });

  const server = new McpServer({
    name: 'sre-sentinel-remediation',
    version: '0.1.0',
  });

  registerRemediationTools(server, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('ready', { transport: 'stdio' });
}

main().catch((err) => {
  log('fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
