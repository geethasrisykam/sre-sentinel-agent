import type { RemediationMode } from '@sre-sentinel/shared';

function readMode(name: string): RemediationMode {
  const raw = process.env[name]?.toUpperCase();
  return raw === 'REAL' ? 'REAL' : 'MOCK';
}

export interface RemediationConfig {
  restartPodMode: RemediationMode;
  rollbackMode: RemediationMode;
  scaleMode: RemediationMode;
  victimAppServiceName: string | undefined;
  victimAppRegion: string;
}

export function loadConfig(): RemediationConfig {
  return {
    restartPodMode: readMode('REMEDIATION_RESTART_POD_MODE'),
    rollbackMode: readMode('REMEDIATION_ROLLBACK_MODE'),
    scaleMode: readMode('REMEDIATION_SCALE_MODE'),
    victimAppServiceName: process.env.VICTIM_APP_SERVICE_NAME?.trim() || undefined,
    victimAppRegion: process.env.VICTIM_APP_REGION?.trim() || 'us-central1',
  };
}

export function log(event: string, fields: object = {}): void {
  const payload = {
    at: new Date().toISOString(),
    service: 'remediation-mcp',
    event,
    ...(fields as Record<string, unknown>),
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

export function jitter(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((resolve) => setTimeout(resolve, delay));
}
