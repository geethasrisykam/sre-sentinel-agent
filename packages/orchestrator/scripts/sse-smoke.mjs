// End-to-end SSE smoke test. Logs in, opens the incident stream, fires a
// webhook, and prints the first few stream events. Exits when an
// AWAITING_APPROVAL or terminal state is observed, or after a hard timeout.
//
// Run after starting the orchestrator:
//   node packages/orchestrator/dist/index.js   (in another terminal)
//   node packages/orchestrator/scripts/sse-smoke.mjs

const ORCH = process.env.ORCH_BASE_URL ?? 'http://localhost:8080';
const PASSWORD = process.env.DASHBOARD_DEMO_PASSWORD ?? 'hackathon-judges-2026';

function bail(message) {
  console.error('SMOKE FAIL:', message);
  process.exit(1);
}

// 1. Log in to get a session cookie.
const loginRes = await fetch(`${ORCH}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: PASSWORD }),
});
if (!loginRes.ok) bail(`login failed: ${loginRes.status}`);
const setCookie = loginRes.headers.get('set-cookie');
const sessionCookie = setCookie?.split(';')[0];
if (!sessionCookie) bail('no session cookie returned from login');
console.log('LOGIN ok:', sessionCookie.slice(0, 32) + '…');

// 2. Open the SSE stream. Native fetch returns a Response with a readable body;
//    we parse SSE frames manually so this works on Node without extra deps.
const streamRes = await fetch(`${ORCH}/api/incidents/stream`, {
  headers: { cookie: sessionCookie, accept: 'text/event-stream' },
});
if (!streamRes.ok) bail(`stream connect failed: ${streamRes.status}`);
console.log('STREAM ok, status', streamRes.status);

const events = [];
const decoder = new TextDecoder();
let buffer = '';

const drain = async () => {
  for await (const chunk of streamRes.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let frameEnd;
    while ((frameEnd = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const lines = frame.split('\n');
      let event = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (data === '') continue;
      const parsed = JSON.parse(data);
      events.push({ event, data: parsed });
      console.log(`EVENT ${event}`, summarize(event, parsed));
    }
  }
};

function summarize(event, data) {
  if (event === 'snapshot') return `incidents=${data.incidents.length}`;
  if (event.startsWith('incident.')) {
    const i = data.incident;
    return `id=${i.id.slice(0, 8)} state=${i.state} turns=${i.agentTurns.length}`;
  }
  return '';
}

// 3. After a brief settle, fire a webhook to kick off the agent.
const drainPromise = drain().catch((err) => console.error('drain error:', err));
await new Promise((r) => setTimeout(r, 300));

const fireRes = await fetch(`${ORCH}/api/incidents`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: sessionCookie },
  body: JSON.stringify({ problemId: 'P-2026-05-25-001' }),
});
if (!fireRes.ok) bail(`fire webhook failed: ${fireRes.status} ${await fireRes.text()}`);
const fired = await fireRes.json();
console.log('FIRED incident', fired);

// 4. Wait until we see the incident reach AWAITING_APPROVAL, FAILED, or RESOLVED.
const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  const final = events.find((e) =>
    e.event.startsWith('incident.') &&
    e.data.incident.id === fired.id &&
    ['AWAITING_APPROVAL', 'RESOLVED', 'FAILED', 'REJECTED'].includes(e.data.incident.state),
  );
  if (final) {
    console.log('TERMINAL state reached:', final.data.incident.state, 'turns:', final.data.incident.agentTurns.length);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}
bail('timed out waiting for terminal state');
void drainPromise;
