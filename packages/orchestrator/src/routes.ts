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

  app.get('/api/incidents/stream', guard, async (request, reply) => {
    // Tell Fastify we'll write the response ourselves and keep the socket open.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // disable nginx buffering if ever fronted by one
    });

    // Register cleanup BEFORE any subscribe/write so a TCP reset between
    // writeHead() and subscribe() can't leak the event-bus handler.
    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let keepalive: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (keepalive) clearInterval(keepalive);
      if (unsubscribe) unsubscribe();
      log.info('sse.subscriber.disconnected', { remaining: deps.repo.events.size() });
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    const send = (event: string, data: unknown) => {
      if (closed || reply.raw.destroyed) return;
      try {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ERR_STREAM_DESTROYED' || code === 'EPIPE' || code === 'ECONNRESET') {
          // Client disconnected mid-write; the 'close' handler will tear things down.
          cleanup();
          return;
        }
        // Real error (serialization bug, unexpected throw) — surface it.
        log.warn('sse.write.failed', {
          event,
          code: code ?? null,
          error: err instanceof Error ? err.message : String(err),
        });
        cleanup();
      }
    };

    // 1. Initial snapshot so a fresh subscriber sees what's already in flight.
    send('snapshot', { incidents: deps.repo.listRecent(50) });
    if (closed) return; // snapshot failed and torn down already

    // 2. Subsequent live events.
    unsubscribe = deps.repo.events.subscribe((event) => {
      send(event.kind === 'created' ? 'incident.created' : 'incident.updated', {
        incident: event.incident,
        at: event.at,
      });
    });

    // 3. Periodic comment frame keeps idle proxies from killing the connection.
    keepalive = setInterval(() => {
      if (closed || reply.raw.destroyed) {
        cleanup();
        return;
      }
      try {
        reply.raw.write(': keepalive\n\n');
      } catch {
        cleanup();
      }
    }, 25_000);

    log.info('sse.subscriber.connected', { total: deps.repo.events.size() });
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
  const started = Date.now();
  try {
    const proposal = await deps.agent.diagnose(incident, (i) => {
      i.updatedAt = new Date().toISOString();
      deps.repo.update(i);
    });
    if (!proposal) {
      // The runner appends a "Diagnosis aborted: <reason>" turn before returning
      // null. Surface that reason instead of a generic "couldn't produce".
      const lastTurn = incident.agentTurns.at(-1);
      const summary = lastTurn?.thought?.startsWith('Diagnosis aborted:')
        ? lastTurn.thought
        : 'Agent could not produce a structured remediation proposal.';
      incident.state = 'FAILED';
      incident.outcome = {
        success: false,
        summary,
        durationMs: Date.now() - started,
      };
    } else {
      // The runner has already attached proposedRemediation; we just transition state.
      incident.state = 'AWAITING_APPROVAL';
    }
    incident.updatedAt = new Date().toISOString();
    deps.repo.update(incident);
    log.info('incident.triage.done', { id: incident.id, state: incident.state });
  } catch (err) {
    log.error('incident.triage.error', { id: incident.id, error: String(err) });
    incident.state = 'FAILED';
    incident.outcome = {
      success: false,
      summary: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
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
