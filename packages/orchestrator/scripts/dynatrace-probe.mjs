// Dynatrace MCP smoke-test / discovery probe.
//
// Spawns @dynatrace-oss/dynatrace-mcp-server@latest over stdio against the
// live trial tenant, lists the tools it exposes, and exercises the three
// methods our DynatraceMcpAdapter wraps (getProblem / getDeployments /
// getLogs).
//
// Usage:
//   node --env-file=../../.env.local packages/orchestrator/scripts/dynatrace-probe.mjs
//   # or, from repo root:
//   node --env-file=.env.local packages/orchestrator/scripts/dynatrace-probe.mjs
//
// Requires DYNATRACE_ENVIRONMENT_URL + DYNATRACE_API_TOKEN in the env.
// Writes a JSON dump of the discovered tool surface to
// packages/orchestrator/scripts/.dynatrace-probe-output.json so the adapter
// tuning step has a stable reference.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '.dynatrace-probe-output.json');

const envUrl = process.env.DYNATRACE_ENVIRONMENT_URL?.trim();
const apiToken = process.env.DYNATRACE_API_TOKEN?.trim();
if (!envUrl || !apiToken) {
  console.error(
    'ERROR: Both DYNATRACE_ENVIRONMENT_URL and DYNATRACE_API_TOKEN must be set. ' +
      'Run with `node --env-file=.env.local packages/orchestrator/scripts/dynatrace-probe.mjs`.',
  );
  process.exit(2);
}

// The Dynatrace MCP rejects a trailing slash with a slightly confusing regex,
// but accepts it. We normalize anyway so logs are tidy.
const normalizedEnv = envUrl.replace(/\/+$/, '');

// The MCP requires Node 22.10+. If the parent process is older, document it
// loudly so the failure mode is obvious — npx will inherit whatever Node the
// caller used.
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  console.error(
    `WARN: this Node is v${process.versions.node}. The Dynatrace MCP requires v22.10+. ` +
      'Set PATH to a Node 22 install before running this probe, or it will crash with ' +
      "'webidl.util.markAsUncloneable is not a function'.",
  );
}

// Sanity-check the token type. The MCP only speaks Bearer JWTs, which means it
// only accepts Platform Tokens (`dt0s16.`) or OAuth-derived access tokens.
// A classic API Token (`dt0c01.`) WILL fail with "Could not parse JWT" — flag
// it early so the operator doesn't waste time debugging.
const tokenPrefix = apiToken.slice(0, 6);
if (tokenPrefix === 'dt0c01') {
  console.error(
    "WARN: DYNATRACE_API_TOKEN looks like a classic API token (prefix 'dt0c01.'). The " +
      "official MCP server only accepts Platform Tokens (prefix 'dt0s16.') or OAuth " +
      "clients. Connection test will fail. Mint a Platform Token at " +
      `${normalizedEnv}/ui/apps/dynatrace.platform.management.tokens.`,
  );
}

const transport = new StdioClientTransport({
  command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
  args: ['-y', '@dynatrace-oss/dynatrace-mcp-server@latest'],
  env: {
    ...process.env,
    DT_ENVIRONMENT: normalizedEnv,
    DT_PLATFORM_TOKEN: apiToken,
    // Disable telemetry so logs aren't noisy and the child doesn't hang waiting
    // on its OpenKit beacon.
    DT_MCP_DISABLE_TELEMETRY: 'true',
  },
});

const client = new Client(
  { name: 'sre-sentinel-probe', version: '0.0.1' },
  { capabilities: {} },
);

const dump = { environment: normalizedEnv, tools: [], probes: {} };

const failOnTimeout = setTimeout(() => {
  console.error('Probe timed out after 60s — most likely the token is invalid or scopes are missing.');
  process.exit(3);
}, 60_000);

try {
  console.error(`Connecting to ${normalizedEnv} via stdio …`);
  await client.connect(transport);
  console.error('Connected.');

  const tools = await client.listTools();
  dump.tools = tools.tools.map((t) => ({
    name: t.name,
    description: t.description?.slice(0, 200),
    inputSchema: t.inputSchema,
  }));
  console.error(`Discovered ${tools.tools.length} tools:`);
  for (const t of tools.tools) {
    console.error(`  • ${t.name}`);
  }

  // Probe 1: list_problems
  dump.probes.list_problems = await safeCall(client, 'list_problems', {
    timeframe: '24h',
    status: 'ALL',
    maxProblemsToDisplay: 5,
  });

  // Probe 2: execute_dql — fetch dt.davis.problems directly so we get
  // structured rows instead of templated text.
  dump.probes.execute_dql_problems = await safeCall(client, 'execute_dql', {
    dqlStatement:
      'fetch dt.davis.problems, from: now()-24h, to: now() | sort event.start desc | limit 5',
  });

  // Probe 3: execute_dql — generic logs sample (no entity filter so we always
  // get something on a trial tenant if logs are being ingested).
  dump.probes.execute_dql_logs = await safeCall(client, 'execute_dql', {
    dqlStatement: 'fetch logs, from: now()-1h, to: now() | sort timestamp desc | limit 5',
  });

  // Probe 4: execute_dql — deployment events. CUSTOM_DEPLOYMENT is the Dynatrace
  // canonical event.kind for deploys; we sweep a broad window.
  dump.probes.execute_dql_deployments = await safeCall(client, 'execute_dql', {
    dqlStatement:
      'fetch events, from: now()-7d, to: now() | filter event.kind == "CUSTOM_DEPLOYMENT" | sort timestamp desc | limit 5',
  });

  // Probe 5: find_entity_by_name with a placeholder so we can see how the tool
  // formats responses for unknown entities (helps the adapter fail loudly).
  dump.probes.find_entity_by_name = await safeCall(client, 'find_entity_by_name', {
    entityNames: ['checkout-api'],
    maxEntitiesToDisplay: 3,
  });

  writeFileSync(outputPath, JSON.stringify(dump, null, 2), 'utf8');
  console.error(`Wrote probe dump to ${outputPath}`);
} catch (err) {
  console.error('Probe failed:', err);
  // Still try to write whatever we have for postmortem.
  try {
    dump.fatal = err instanceof Error ? { message: err.message, stack: err.stack } : { error: String(err) };
    writeFileSync(outputPath, JSON.stringify(dump, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
} finally {
  clearTimeout(failOnTimeout);
  await client.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
}

async function safeCall(client, name, args) {
  console.error(`\n--- calling ${name} ---`);
  console.error(`  args: ${JSON.stringify(args)}`);
  try {
    const result = await client.callTool({ name, arguments: args });
    const preview = previewResult(result);
    console.error(`  ok. preview: ${preview}`);
    return { ok: true, args, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR: ${message}`);
    return { ok: false, args, error: message };
  }
}

function previewResult(result) {
  try {
    const content = result?.content;
    if (Array.isArray(content) && content[0]?.text) {
      const text = String(content[0].text);
      return text.length > 240 ? text.slice(0, 240) + '…' : text;
    }
    const s = JSON.stringify(result);
    return s.length > 240 ? s.slice(0, 240) + '…' : s;
  } catch {
    return '<unprintable>';
  }
}

// Surface unhandled rejections — the MCP transport sometimes throws after a
// successful close which would otherwise mask the real outcome.
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
