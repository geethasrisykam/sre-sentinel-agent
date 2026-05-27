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
  cookieSecure: boolean;
  webhookToken: string | undefined;
  diagnosisAdapter: 'mock' | 'dynatrace';
  dynatraceEnvironmentUrl: string;
  dynatraceApiToken: string;
  remediationMcpCommand: string;
  remediationMcpArgs: string[];
  remediationMcpCwd: string;
}

export function loadConfig(): Config {
  // Cloud Run injects PORT; honour it as a fallback for our specific var.
  const rawPort = process.env.ORCHESTRATOR_PORT ?? process.env.PORT ?? '8080';
  const port = Number(rawPort);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`ORCHESTRATOR_PORT/PORT must be a valid port number (got ${rawPort})`);
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

  // Cookie security: required behind HTTPS (Cloud Run, Firebase Hosting), but
  // breaks local dev over http://localhost. Default tracks NODE_ENV; allow an
  // explicit override for the rare case where the defaults are wrong.
  const cookieSecureEnv = process.env.COOKIE_SECURE?.trim().toLowerCase();
  const cookieSecure =
    cookieSecureEnv === 'true'
      ? true
      : cookieSecureEnv === 'false'
        ? false
        : process.env.NODE_ENV === 'production';

  // Webhook bearer token for /api/webhooks/dynatrace. Optional — if unset, the
  // webhook endpoint refuses every request with 503 so a misconfigured deploy
  // doesn't silently accept anonymous traffic.
  const webhookToken = process.env.WEBHOOK_TOKEN?.trim() || undefined;
  if (webhookToken && webhookToken.length < 16) {
    throw new Error('WEBHOOK_TOKEN must be at least 16 characters when set.');
  }

  // Diagnosis adapter selection. Defaults to the in-process mock until both
  // DYNATRACE_ENVIRONMENT_URL and DYNATRACE_API_TOKEN are configured; setting
  // either one without the other is an error rather than a silent fallback.
  const dynatraceEnvironmentUrl = process.env.DYNATRACE_ENVIRONMENT_URL?.trim() ?? '';
  const dynatraceApiToken = process.env.DYNATRACE_API_TOKEN?.trim() ?? '';
  const dtHasUrl = dynatraceEnvironmentUrl.length > 0;
  const dtHasToken = dynatraceApiToken.length > 0;
  if (dtHasUrl !== dtHasToken) {
    throw new Error(
      'DYNATRACE_ENVIRONMENT_URL and DYNATRACE_API_TOKEN must be set together (or both unset to use the mock adapter).',
    );
  }
  const diagnosisAdapter: 'mock' | 'dynatrace' = dtHasUrl && dtHasToken ? 'dynatrace' : 'mock';

  return {
    port,
    logLevel: (process.env.ORCHESTRATOR_LOG_LEVEL as Config['logLevel']) || 'info',
    geminiApiKey,
    geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-pro',
    databasePath: resolve(dataDir, 'sentinel.db'),
    sessionSecret,
    demoPassword,
    cookieSecure,
    webhookToken,
    diagnosisAdapter,
    dynatraceEnvironmentUrl,
    dynatraceApiToken,
    remediationMcpCommand: process.execPath,
    remediationMcpArgs: [resolve(remediationMcpDir, 'dist', 'index.js')],
    remediationMcpCwd: remediationMcpDir,
  };
}
