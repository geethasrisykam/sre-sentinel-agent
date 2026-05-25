import { z } from 'zod';
import type { RemediationToolResult } from '@sre-sentinel/shared';
import { jitter, log, type RemediationConfig } from '../config.js';

export const scaleServiceInput = {
  serviceName: z
    .string()
    .min(1)
    .describe('Name of the service to scale.'),
  targetReplicas: z
    .number()
    .int()
    .min(0)
    .max(50)
    .describe('Desired replica count. Use 0 only if intentionally taking the service offline.'),
  reason: z
    .string()
    .min(10)
    .describe('Concise justification for the scaling action, written for the audit log.'),
};

const inputSchema = z.object(scaleServiceInput);

export async function scaleServiceHandler(
  args: z.infer<typeof inputSchema>,
  config: RemediationConfig,
): Promise<RemediationToolResult> {
  const started = Date.now();
  log('scaleService.start', { mode: config.scaleMode, ...args });

  await jitter(1200, 2400);

  const currentReplicas = simulateCurrentReplicas(args.serviceName);
  const result: RemediationToolResult = {
    ok: true,
    durationMs: Date.now() - started,
    details: {
      mode: config.scaleMode === 'REAL' ? 'REAL_PENDING' : 'MOCK',
      service: args.serviceName,
      replicas: { before: currentReplicas, after: args.targetReplicas },
      stabilizationSec: Math.abs(args.targetReplicas - currentReplicas) * 6 + 4,
      autoscaler: {
        wasOverridden: true,
        previousBoundaries: { min: 2, max: 8 },
      },
    },
    message: `Scaled ${args.serviceName} from ${currentReplicas} to ${args.targetReplicas} replicas. Reason: ${args.reason}`,
  };
  log('scaleService.success', result);
  return result;
}

function simulateCurrentReplicas(serviceName: string): number {
  // Deterministic per-service stub so repeated calls in a demo look stable.
  let hash = 0;
  for (let i = 0; i < serviceName.length; i++) {
    hash = (hash * 31 + serviceName.charCodeAt(i)) | 0;
  }
  return 2 + Math.abs(hash % 4); // 2..5
}
