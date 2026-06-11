import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { setLogLevel, log } from './logger.js';
import { IncidentRepository } from './db.js';
import { AgentRunner } from './agent/runner.js';
import { MockDiagnosisAdapter } from './agent/mock-diagnosis.js';
import { DynatraceMcpAdapter } from './agent/dynatrace-mcp-adapter.js';
import type { DiagnosisAdapter } from './agent/diagnosis-adapter.js';
import { RemediationMcpClient } from './remediation.js';
import { registerAuth } from './auth.js';
import { registerRoutes } from './routes.js';

async function main(): Promise<void> {
  process.stdout.write('[startup:${process.pid}] loading config\n');
  const config = loadConfig();
  setLogLevel(config.logLevel);

  // Surface async failures that escape fire-and-forget call sites
  // (runDiagnosis, runRemediation, SSE handlers). Without these, a rejection
  // disappears under Node's default and a stuck incident has no log trail.
  process.on('unhandledRejection', (reason) => {
    log.error('process.unhandled.rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  process.on('uncaughtException', (err) => {
    log.error('process.uncaught.exception', {
      error: err.message,
      stack: err.stack,
    });
    // Uncaught exceptions leave the runtime in an undefined state — exit so the
    // platform (Cloud Run / supervisor) restarts us cleanly.
    process.exit(1);
  });

  process.stdout.write('[startup:${process.pid}] opening sqlite\n');
  const repo = new IncidentRepository(config.databasePath);
  process.stdout.write('[startup:${process.pid}] sqlite ready\n');

  let diagnosis: DiagnosisAdapter;
  if (config.diagnosisAdapter === 'dynatrace') {
    const adapter = new DynatraceMcpAdapter({
      environmentUrl: config.dynatraceEnvironmentUrl,
      apiToken: config.dynatraceApiToken,
    });
    try {
      if (adapter.connect) await adapter.connect();
      diagnosis = adapter;
      log.info('diagnosis.adapter.ready', { kind: 'dynatrace' });
    } catch (err) {
      log.warn('diagnosis.adapter.fallback', {
        reason: err instanceof Error ? err.message : String(err),
        fallback: 'mock',
      });
      diagnosis = new MockDiagnosisAdapter();
      log.info('diagnosis.adapter.ready', { kind: 'mock' });
    }
  } else {
    diagnosis = new MockDiagnosisAdapter();
    log.info('diagnosis.adapter.ready', { kind: 'mock' });
  }

  process.stdout.write('[startup:${process.pid}] creating agent\n');
  const agent = new AgentRunner(config.geminiApiKey, config.geminiModel, diagnosis);
  process.stdout.write('[startup:${process.pid}] agent ready\n');
  log.info('adk.agent.ready', { model: config.geminiModel });
  const remediation = new RemediationMcpClient(
    config.remediationMcpCommand,
    config.remediationMcpArgs,
    config.remediationMcpCwd,
  );
  process.stdout.write('[startup:${process.pid}] connecting remediation mcp\n');
  try {
    await remediation.connect();
    process.stdout.write('[startup:${process.pid}] remediation mcp ready\n');
  } catch (err) {
    process.stdout.write(`[startup:${process.pid}] remediation mcp failed: ${err instanceof Error ? err.message : String(err)}\n`);
    log.warn('remediation.mcp.connect.failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  process.stdout.write(`[startup:${process.pid}] creating fastify\n`);
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true, credentials: true });
  process.stdout.write(`[startup:${process.pid}] registering cookie\n`);
  await app.register(cookie, { secret: config.sessionSecret });
  process.stdout.write(`[startup:${process.pid}] registering sensible\n`);
  await app.register(sensible);
  process.stdout.write(`[startup:${process.pid}] registering auth\n`);
  registerAuth(app, {
    sessionSecret: config.sessionSecret,
    demoPassword: config.demoPassword,
    cookieSecure: config.cookieSecure,
  });
  process.stdout.write(`[startup:${process.pid}] registering routes\n`);
  registerRoutes(app, {
    repo,
    agent,
    remediation,
    sessionSecret: config.sessionSecret,
    webhookToken: config.webhookToken,
  });
  process.stdout.write(`[startup:${process.pid}] routes done\n`);

  // Combined-deploy mode (Fly.io path): if DASHBOARD_DIST_PATH points to a
  // built dashboard, serve it as static files behind the API routes. This is
  // how we ship a single-container hosted demo without needing a separate
  // CDN. The Cloud Run + Firebase Hosting path leaves this env var unset and
  // serves the dashboard from Firebase instead.
  const dashboardDist = process.env.DASHBOARD_DIST_PATH?.trim();
  process.stdout.write(`[startup:${process.pid}] dashboard dist path: ${dashboardDist ?? 'unset'}\n`);
  if (dashboardDist) {
    const dashboardAbs = resolve(dashboardDist);
    const dashboardExists = existsSync(dashboardAbs);
    process.stdout.write(`[startup:${process.pid}] dashboard abs: ${dashboardAbs} exists=${dashboardExists}\n`);
    if (!dashboardExists) {
      log.warn('dashboard.dist.missing', { path: dashboardAbs });
    } else {
      try {
        process.stdout.write(`[startup:${process.pid}] registering static\n`);
        const { default: fastifyStatic } = await import('@fastify/static');
        await app.register(fastifyStatic, { root: dashboardAbs, prefix: '/' });
        process.stdout.write(`[startup:${process.pid}] static registered\n`);
        app.setNotFoundHandler((request, reply) => {
          if (request.url.startsWith('/api/') || request.url === '/healthz') {
            return reply.code(404).send({ error: 'not found' });
          }
          return reply.sendFile('index.html');
        });
        log.info('dashboard.static.ready', { root: dashboardAbs });
      } catch (err) {
        process.stdout.write(`[startup:${process.pid}] static registration FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  const shutdown = async (signal: string) => {
    log.info('shutdown.start', { signal });
    await app.close();
    await remediation.close();
    if (diagnosis.close) await diagnosis.close();
    repo.close();
    log.info('shutdown.done');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.stdout.write(`[startup:${process.pid}] listening on port ${config.port}\n`);
  await app.listen({ port: config.port, host: '0.0.0.0' });
  process.stdout.write(`[startup:${process.pid}] orchestrator ready on port ${config.port}\n`);
  log.info('orchestrator.ready', { port: config.port, model: config.geminiModel });
}

main().catch((err) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  process.stderr.write(`[FATAL] orchestrator startup failed: ${msg}\n`);
  log.error('orchestrator.fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
