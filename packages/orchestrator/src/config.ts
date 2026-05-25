import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export interface Config {
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  geminiApiKey: string;
  geminiModel: string;
  databasePath: string;
  sessionSecret: string;
  demoPassword: string;
  remediationMcpCommand: string;
  remediationMcpArgs: string[];
  remediationMcpCwd: string;
}

export function loadConfig(): Config {
  const port = Number(process.env.ORCHESTRATOR_PORT ?? 8080);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`ORCHESTRATOR_PORT must be a valid port number (got ${process.env.ORCHESTRATOR_PORT})`);
  }

  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiApiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com and put it in .env.local.',
    );
  }

  const demoPassword = process.env.DASHBOARD_DEMO_PASSWORD?.trim();
  if (!demoPassword || demoPassword === 'changeme-pick-something-strong') {
    throw new Error(
      'DASHBOARD_DEMO_PASSWORD is not set or still has the placeholder value. Pick a real password in .env.local.',
    );
  }

  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET?.trim();
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error(
      'DASHBOARD_SESSION_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  const dataDir = resolve(here, '..', 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Locate the remediation MCP package so we can spawn it as a child process.
  const remediationMcpDir = resolve(here, '..', '..', 'remediation-mcp');

  return {
    port,
    logLevel: (process.env.ORCHESTRATOR_LOG_LEVEL as Config['logLevel']) || 'info',
    geminiApiKey,
    geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-pro',
    databasePath: resolve(dataDir, 'sentinel.db'),
    sessionSecret,
    demoPassword,
    remediationMcpCommand: process.execPath,
    remediationMcpArgs: [resolve(remediationMcpDir, 'dist', 'index.js')],
    remediationMcpCwd: remediationMcpDir,
  };
}
