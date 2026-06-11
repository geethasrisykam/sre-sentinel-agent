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
  const config = loadConfig();
  setLogLevel(config.logLevel);

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
    process.exit(1);
  });

  const repo = new IncidentRepository(config.databasePath);

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

  const agent = new AgentRunner(config.geminiApiKey, config.geminiModel, diagnosis);
  log.info('adk.agent.ready', { model: config.geminiModel });

  const remediation = new RemediationMcpClient(
    config.remediationMcpCommand,
    config.remediationMcpArgs,
    config.remediationMcpCwd,
  );
  try {
    await remediation.connect();
  } catch (err) {
    log.warn('remediation.mcp.connect.failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true, credentials: true });
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

  const dashboardDist = process.env.DASHBOARD_DIST_PATH?.trim();
  if (dashboardDist) {
    const dashboardAbs = resolve(dashboardDist);
    if (!existsSync(dashboardAbs)) {
      log.warn('dashboard.dist.missing', { path: dashboardAbs });
    } else {
      try {
        const { default: fastifyStatic } = await import('@fastify/static');
        await app.register(fastifyStatic, { root: dashboardAbs, prefix: '/' });
        app.setNotFoundHandler((request, reply) => {
          if (request.url.startsWith('/api/') || request.url === '/healthz') {
            return reply.code(404).send({ error: 'not found' });
          }
          return reply.sendFile('index.html');
        });
        log.info('dashboard.static.ready', { root: dashboardAbs });
      } catch (err) {
        log.warn('dashboard.static.failed', {
          reason: err instanceof Error ? err.message : String(err),
        });
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

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info('orchestrator.ready', { port: config.port, model: config.geminiModel });
}

main().catch((err) => {
  log.error('orchestrator.fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
