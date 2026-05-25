// Quick smoke test: spawn the MCP server, send an `initialize` request and a
// `tools/list` request, print responses, exit. No external deps.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(here, '..', 'dist', 'index.js');

const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer = '';
const responses = [];

function send(message) {
  child.stdin.write(JSON.stringify(message) + '\n');
}

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newlineAt;
  while ((newlineAt = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newlineAt).trim();
    buffer = buffer.slice(newlineAt + 1);
    if (!line) continue;
    try {
      responses.push(JSON.parse(line));
    } catch {
      responses.push({ rawNonJson: line });
    }
  }
});

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.1' },
  },
});

setTimeout(() => {
  send({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
}, 300);

setTimeout(() => {
  console.log('=== Responses ===');
  for (const r of responses) {
    console.log(JSON.stringify(r, null, 2));
  }
  child.kill();
  process.exit(responses.length >= 2 ? 0 : 1);
}, 1200);
