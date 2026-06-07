import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { setLogLevel, log } from './logger.js';
import { IncidentRepository } from './db.js';
import { GeminiClient } from './agent/gemini.js';
import { AgentRunner } from './agent/runner.js';
import { MockDiagnosisAdapter } from './agent/mock-diagnosis.js';
import { DynatraceMcpAdapter } from './agent/dynatrace-mcp-adapter.js';
import type { DiagnosisAdapter } from './agent/diagnosis-adapter.js';
import { RemediationMcpClient } from './remediation.js';
import { registerAuth } from './auth.js';
import { registerRoutes } from './routes.js';

async function main(): Promise<void> {
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

  const repo = new IncidentRepository(config.databasePath);
  const gemini = new GeminiClient(config.geminiApiKey, config.geminiModel);

  const diagnosis: DiagnosisAdapter =
    config.diagnosisAdapter === 'dynatrace'
      ? new DynatraceMcpAdapter({
          environmentUrl: config.dynatraceEnvironmentUrl,
          apiToken: config.dynatraceApiToken,
        })
      : new MockDiagnosisAdapter();
  if (diagnosis.connect) await diagnosis.connect();
  log.info('diagnosis.adapter.ready', { kind: config.diagnosisAdapter });

  const agent = new AgentRunner(gemini, diagnosis);
  const remediation = new RemediationMcpClient(
    config.remediationMcpCommand,
    config.remediationMcpArgs,
    config.remediationMcpCwd,
  );
  await remediation.connect();

  const app = Fastify({ logger: false });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(sensible);

  registerAuth(app, {
    sessionSecret: config.sessionSecret,
    demoPassword: config.demoPassword,
    cookieSecure: config.cookieSecure,
  });
  registerRoutes(app, {
    repo,
    agent,
    remediation,
    sessionSecret: config.sessionSecret,
    webhookToken: config.webhookToken,
  });

  // Combined-deploy mode (Fly.io path): if DASHBOARD_DIST_PATH points to a
  // built dashboard, serve it as static files behind the API routes. This is
  // how we ship a single-container hosted demo without needing a separate
  // CDN. The Cloud Run + Firebase Hosting path leaves this env var unset and
  // serves the dashboard from Firebase instead.
  const dashboardDist = process.env.DASHBOARD_DIST_PATH?.trim();
  if (dashboardDist) {
    const dashboardAbs = resolve(dashboardDist);
    if (!existsSync(dashboardAbs)) {
      log.warn('dashboard.dist.missing', { path: dashboardAbs });
    } else {
      await app.register(fastifyStatic, { root: dashboardAbs, prefix: '/' });
      // SPA fallback: any route the API didn't claim and that isn't an asset
      // gets the dashboard's index.html so React Router (or future routing)
      // works on hard refresh.
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith('/api/') || request.url === '/healthz') {
          return reply.code(404).send({ error: 'not found' });
        }
        return reply.sendFile('index.html');
      });
      log.info('dashboard.static.ready', { root: dashboardAbs });
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

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info('orchestrator.ready', { port: config.port, model: config.geminiModel });
}

main().catch((err) => {
  log.error('orchestrator.fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
