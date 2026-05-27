import { beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import type { IncidentRecord, ProposedRemediation, RemediationToolResult } from '@sre-sentinel/shared';
import { IncidentRepository } from './db.js';
import { registerAuth } from './auth.js';
import { registerRoutes } from './routes.js';
import { AgentRunner } from './agent/runner.js';
import { RemediationMcpClient } from './remediation.js';

const SESSION_SECRET = 'a'.repeat(64);
const PASSWORD = 'pw-for-tests-123';

const FAKE_PROPOSAL: ProposedRemediation = {
  tool: 'restartPod',
  args: { serviceName: 'checkout-api', reason: 'pool exhausted' },
  rationale: 'Connection pool exhaustion right after deploy.',
  riskAssessment: 'low',
  estimatedBlastRadius: 'One pod replaced.',
};

class FakeAgent {
  proposal: ProposedRemediation | null = FAKE_PROPOSAL;
  diagnoseCalls = 0;
  shouldThrow = false;

  // Contract with the runner: when a proposal is produced, the agent
  // mutates the incident so subscribers see the complete record in one
  // event. The real AgentRunner does this in agent/runner.ts.
  async diagnose(
    incident: IncidentRecord,
    onTurn: (incident: IncidentRecord) => void = () => undefined,
  ): Promise<ProposedRemediation | null> {
    this.diagnoseCalls += 1;
    if (this.shouldThrow) throw new Error('agent failed');
    incident.agentTurns.push({
      at: new Date().toISOString(),
      thought: 'fake diagnosis turn',
    });
    if (this.proposal) {
      incident.proposedRemediation = this.proposal;
    }
    onTurn(incident);
    return this.proposal;
  }
}

class FakeRemediation {
  result: RemediationToolResult = {
    ok: true,
    durationMs: 42,
    details: {},
    message: 'pod restarted',
  };
  callCount = 0;
  lastCall: { toolName: string; args: Record<string, unknown> } | null = null;

  async call(toolName: string, args: Record<string, unknown>): Promise<RemediationToolResult> {
    this.callCount += 1;
    this.lastCall = { toolName, args };
    return this.result;
  }
}

async function buildApp(opts: {
  agent?: FakeAgent;
  remediation?: FakeRemediation;
  repo?: IncidentRepository;
} = {}): Promise<{
  app: FastifyInstance;
  agent: FakeAgent;
  remediation: FakeRemediation;
  repo: IncidentRepository;
}> {
  const repo = opts.repo ?? new IncidentRepository(':memory:');
  const agent = opts.agent ?? new FakeAgent();
  const remediation = opts.remediation ?? new FakeRemediation();

  const app = Fastify({ logger: false });
  await app.register(cookie, { secret: SESSION_SECRET });
  await app.register(sensible);
  registerAuth(app, { sessionSecret: SESSION_SECRET, demoPassword: PASSWORD });
  registerRoutes(app, {
    repo,
    agent: agent as unknown as AgentRunner,
    remediation: remediation as unknown as RemediationMcpClient,
    sessionSecret: SESSION_SECRET,
  });
  await app.ready();
  return { app, agent, remediation, repo };
}

async function login(app: FastifyInstance, password = PASSWORD): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (cookieHeader as string).split(';')[0] ?? '';
}

// Poll the in-memory repo until the incident reaches the target state, or
// throw after a short timeout. Routes runDiagnosis fires-and-forgets, so we
// can't await it directly.
async function waitForState(
  repo: IncidentRepository,
  id: string,
  state: IncidentRecord['state'],
  timeoutMs = 1000,
): Promise<IncidentRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inc = repo.findById(id);
    if (inc?.state === state) return inc;
    await new Promise((r) => setTimeout(r, 20));
  }
  const last = repo.findById(id);
  throw new Error(`Timed out waiting for state=${state}; last=${last?.state}`);
}

describe('routes', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ctx = await buildApp();
  });

  it('healthz is open and returns ok', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('requires authentication for /api/incidents', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/incidents' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects login with the wrong password', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns an empty list immediately after login', async () => {
    const cookie = await login(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/incidents',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().incidents).toEqual([]);
  });

  it('lists seeded problems for use in the UI', async () => {
    const cookie = await login(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/seeded-problems',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().problems.map((p: { problemId: string }) => p.problemId);
    expect(ids).toContain('P-2026-05-25-001');
  });

  it('rejects unknown problemIds on the webhook', async () => {
    const cookie = await login(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers: { cookie },
      payload: { problemId: 'P-DOES-NOT-EXIST' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('runs the diagnosis flow and lands in AWAITING_APPROVAL', async () => {
    const cookie = await login(ctx.app);
    const fireRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers: { cookie },
      payload: { problemId: 'P-2026-05-25-001' },
    });
    expect(fireRes.statusCode).toBe(202);
    const { id } = fireRes.json();

    const incident = await waitForState(ctx.repo, id, 'AWAITING_APPROVAL');
    expect(incident.proposedRemediation?.tool).toBe('restartPod');
    expect(ctx.agent.diagnoseCalls).toBe(1);
  });

  it('marks the incident FAILED when the agent throws', async () => {
    ctx.agent.shouldThrow = true;
    const cookie = await login(ctx.app);
    const fireRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers: { cookie },
      payload: { problemId: 'P-2026-05-25-001' },
    });
    const { id } = fireRes.json();

    const incident = await waitForState(ctx.repo, id, 'FAILED');
    expect(incident.outcome?.success).toBe(false);
  });

  it('marks the incident FAILED when the agent returns no proposal', async () => {
    ctx.agent.proposal = null;
    const cookie = await login(ctx.app);
    const fireRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers: { cookie },
      payload: { problemId: 'P-2026-05-25-001' },
    });
    const { id } = fireRes.json();

    const incident = await waitForState(ctx.repo, id, 'FAILED');
    expect(incident.outcome?.summary).toMatch(/structured remediation proposal/i);
  });

  it('approval triggers remediation and resolves the incident', async () => {
    const cookie = await login(ctx.app);
    const fireRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers: { cookie },
      payload: { problemId: 'P-2026-05-25-001' },
    });
    const { id } = fireRes.json();
    await waitForState(ctx.repo, id, 'AWAITING_APPROVAL');

    const approveRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/incidents/${id}/approve`,
      headers: { cookie },
      payload: { decision: 'approve', decidedBy: 'tester' },
    });
    expect(approveRes.statusCode).toBe(200);

    const resolved = await waitForState(ctx.repo, id, 'RESOLVED');
    expect(resolved.outcome?.success).toBe(true);
    expect(ctx.remediation.callCount).toBe(1);
    expect(ctx.remediation.lastCall?.toolName).toBe('restartPod');
    expect(resolved.approval?.decidedBy).toBe('tester');
  });

  it('rejection skips remediation and lands in REJECTED', async () => {
    const cookie = await login(ctx.app);
    const fireRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers: { cookie },
      payload: { problemId: 'P-2026-05-25-001' },
    });
    const { id } = fireRes.json();
    await waitForState(ctx.repo, id, 'AWAITING_APPROVAL');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/incidents/${id}/approve`,
      headers: { cookie },
      payload: { decision: 'reject', decidedBy: 'tester' },
    });
    expect(res.statusCode).toBe(200);

    const rejected = ctx.repo.findById(id);
    expect(rejected?.state).toBe('REJECTED');
    expect(ctx.remediation.callCount).toBe(0);
  });

  it('refuses to approve an incident that is not awaiting approval', async () => {
    const cookie = await login(ctx.app);
    const fireRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers: { cookie },
      payload: { problemId: 'P-2026-05-25-001' },
    });
    const { id } = fireRes.json();
    await waitForState(ctx.repo, id, 'AWAITING_APPROVAL');

    // First approval moves it out of AWAITING_APPROVAL.
    await ctx.app.inject({
      method: 'POST',
      url: `/api/incidents/${id}/approve`,
      headers: { cookie },
      payload: { decision: 'approve', decidedBy: 'tester' },
    });
    await waitForState(ctx.repo, id, 'RESOLVED');

    // Second approval should be rejected with 409.
    const dup = await ctx.app.inject({
      method: 'POST',
      url: `/api/incidents/${id}/approve`,
      headers: { cookie },
      payload: { decision: 'approve', decidedBy: 'tester' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('uses modifiedArgs from approval payload when remediating', async () => {
    const cookie = await login(ctx.app);
    const fireRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers: { cookie },
      payload: { problemId: 'P-2026-05-25-001' },
    });
    const { id } = fireRes.json();
    await waitForState(ctx.repo, id, 'AWAITING_APPROVAL');

    const modified = { serviceName: 'checkout-api', reason: 'manual override' };
    await ctx.app.inject({
      method: 'POST',
      url: `/api/incidents/${id}/approve`,
      headers: { cookie },
      payload: { decision: 'approve', decidedBy: 'tester', modifiedArgs: modified },
    });
    await waitForState(ctx.repo, id, 'RESOLVED');

    expect(ctx.remediation.lastCall?.args).toEqual(modified);
  });

  it('returns 404 for a missing incident id', async () => {
    const cookie = await login(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/incidents/not-a-real-id',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
