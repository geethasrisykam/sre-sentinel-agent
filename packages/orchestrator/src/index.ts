import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import { loadConfig } from './config.js';
import { setLogLevel, log } from './logger.js';
import { IncidentRepository } from './db.js';
import { GeminiClient } from './agent/gemini.js';
import { AgentRunner } from './agent/runner.js';
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
  const agent = new AgentRunner(gemini);
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
  });

  const shutdown = async (signal: string) => {
    log.info('shutdown.start', { signal });
    await app.close();
    await remediation.close();
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
