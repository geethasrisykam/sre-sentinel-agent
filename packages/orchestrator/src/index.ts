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
