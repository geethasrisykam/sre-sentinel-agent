import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Approval, IncidentRecord } from '@sre-sentinel/shared';
import { AgentRunner } from './agent/runner.js';
import { listSeededProblems, ensureProblemExists, getProblem } from './agent/mock-diagnosis.js';
import { IncidentRepository } from './db.js';
import { log } from './logger.js';
import { RemediationMcpClient } from './remediation.js';
import { requireSession } from './auth.js';

const webhookBodySchema = z.object({
  problemId: z.string().min(1),
  // Real Dynatrace webhooks carry more fields; we accept and ignore them.
});

const approvalBodySchema = z.object({
  decision: z.enum(['approve', 'reject']),
  decidedBy: z.string().min(1).default('on-call'),
  modifiedArgs: z.record(z.unknown()).optional(),
});

interface Deps {
  repo: IncidentRepository;
  agent: AgentRunner;
  remediation: RemediationMcpClient;
  sessionSecret: string;
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const guard = { preHandler: requireSession(deps.sessionSecret) };

  app.get('/healthz', async () => ({ ok: true, at: new Date().toISOString() }));

  app.get('/api/seeded-problems', guard, async () => ({
    problems: listSeededProblems(),
  }));

  app.post('/api/incidents', guard, async (request, reply) => {
    const parsed = webhookBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { problemId } = parsed.data;
    try {
      ensureProblemExists(problemId);
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
    const seed = getProblem(problemId);
    const now = new Date().toISOString();
    const incident: IncidentRecord = {
      id: randomUUID(),
      receivedAt: now,
      updatedAt: now,
      state: 'TRIAGING',
      problemId,
      problemTitle: seed.title,
      affectedEntity: seed.affectedEntities[0]?.name ?? 'unknown',
      severity: seed.severity,
      agentTurns: [],
    };
    deps.repo.insert(incident);
    log.info('incident.received', { id: incident.id, problemId });

    // Kick off diagnosis asynchronously so the webhook returns fast.
    void runDiagnosis(deps, incident);

    return reply.code(202).send({ id: incident.id, state: incident.state });
  });

  app.get('/api/incidents', guard, async () => ({
    incidents: deps.repo.listRecent(50),
  }));

  app.get<{ Params: { id: string } }>('/api/incidents/:id', guard, async (request, reply) => {
    const incident = deps.repo.findById(request.params.id);
    if (!incident) return reply.code(404).send({ error: 'incident not found' });
    return incident;
  });

  app.post<{ Params: { id: string } }>(
    '/api/incidents/:id/approve',
    guard,
    async (request, reply) => {
      const incident = deps.repo.findById(request.params.id);
      if (!incident) return reply.code(404).send({ error: 'incident not found' });
      if (incident.state !== 'AWAITING_APPROVAL') {
        return reply.code(409).send({ error: `incident is in state ${incident.state}` });
      }
      const parsed = approvalBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const { decision, decidedBy, modifiedArgs } = parsed.data;
      const approval: Approval = {
        decision,
        decidedBy,
        decidedAt: new Date().toISOString(),
        modifiedArgs,
      };
      incident.approval = approval;
      incident.updatedAt = approval.decidedAt;

      if (decision === 'reject') {
        incident.state = 'REJECTED';
        deps.repo.update(incident);
        return { ok: true, state: incident.state };
      }

      incident.state = 'EXECUTING';
      deps.repo.update(incident);

      // Execute remediation asynchronously; respond to the operator immediately.
      void runRemediation(deps, incident);
      return { ok: true, state: incident.state };
    },
  );
}

async function runDiagnosis(deps: Deps, incident: IncidentRecord): Promise<void> {
  try {
    const proposal = await deps.agent.diagnose(incident);
    if (!proposal) {
      incident.state = 'FAILED';
      incident.outcome = {
        success: false,
        summary: 'Agent could not produce a structured remediation proposal.',
        durationMs: 0,
      };
    } else {
      incident.proposedRemediation = proposal;
      incident.state = 'AWAITING_APPROVAL';
    }
    incident.updatedAt = new Date().toISOString();
    deps.repo.update(incident);
    log.info('incident.triage.done', { id: incident.id, state: incident.state });
  } catch (err) {
    log.error('incident.triage.error', { id: incident.id, error: String(err) });
    incident.state = 'FAILED';
    incident.outcome = { success: false, summary: String(err), durationMs: 0 };
    incident.updatedAt = new Date().toISOString();
    deps.repo.update(incident);
  }
}

async function runRemediation(deps: Deps, incident: IncidentRecord): Promise<void> {
  const proposal = incident.proposedRemediation;
  if (!proposal) {
    incident.state = 'FAILED';
    incident.outcome = {
      success: false,
      summary: 'No proposal attached to incident at execution time.',
      durationMs: 0,
    };
    deps.repo.update(incident);
    return;
  }
  const args = incident.approval?.modifiedArgs ?? proposal.args;
  const started = Date.now();
  try {
    const result = await deps.remediation.call(proposal.tool, args);
    incident.outcome = {
      success: result.ok,
      summary: result.message,
      durationMs: Date.now() - started,
    };
    incident.state = result.ok ? 'RESOLVED' : 'FAILED';
  } catch (err) {
    incident.outcome = {
      success: false,
      summary: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
    incident.state = 'FAILED';
  }
  incident.updatedAt = new Date().toISOString();
  deps.repo.update(incident);
  log.info('incident.remediation.done', { id: incident.id, state: incident.state });
}
