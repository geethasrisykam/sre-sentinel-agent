export type RemediationMode = 'REAL' | 'MOCK';

export interface RemediationToolDescriptor {
  name: 'restartPod' | 'rollbackDeployment' | 'scaleService';
  mode: RemediationMode;
  description: string;
}

export interface RemediationToolResult {
  ok: boolean;
  durationMs: number;
  details: Record<string, unknown>;
  message: string;
}
