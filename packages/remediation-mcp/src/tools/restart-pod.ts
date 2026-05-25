import { z } from 'zod';
import type { RemediationToolResult } from '@sre-sentinel/shared';
import { jitter, log, type RemediationConfig } from '../config.js';

export const restartPodInput = {
  serviceName: z
    .string()
    .min(1)
    .describe('Name of the service whose pod should be restarted (e.g. "checkout-api").'),
  podId: z
    .string()
    .optional()
    .describe('Specific pod identifier. If omitted, the unhealthiest pod is targeted.'),
  reason: z
    .string()
    .min(10)
    .describe('Concise justification for the restart, written for the audit log.'),
};

const inputSchema = z.object(restartPodInput);

export async function restartPodHandler(
  args: z.infer<typeof inputSchema>,
  config: RemediationConfig,
): Promise<RemediationToolResult> {
  const started = Date.now();
  log('restartPod.start', { mode: config.restartPodMode, ...args });

  if (config.restartPodMode === 'REAL') {
    if (!config.victimAppServiceName) {
      const message =
        'restartPod is configured for REAL mode but VICTIM_APP_SERVICE_NAME is not set. Falling back to MOCK so the demo stays unblocked.';
      log('restartPod.real.misconfigured', { message });
      // Fall through to MOCK to keep the demo working.
    } else {
      // Real implementation will arrive once GCP billing is active.
      // For now, mark the attempt clearly so it's obvious in audit logs.
      await jitter(800, 1800);
      const result: RemediationToolResult = {
        ok: false,
        durationMs: Date.now() - started,
        details: {
          mode: 'REAL',
          targetService: config.victimAppServiceName,
          region: config.victimAppRegion,
          implementation: 'pending',
        },
        message:
          'REAL mode reached but Cloud Run admin client is not wired up yet. See orchestrator deployment phase to enable.',
      };
      log('restartPod.real.placeholder', result);
      return result;
    }
  }

  await jitter(1800, 3600);

  const newPodId = `pod-${args.serviceName}-${randomShortId()}`;
  const previousPodId = args.podId ?? `pod-${args.serviceName}-${randomShortId()}`;
  const result: RemediationToolResult = {
    ok: true,
    durationMs: Date.now() - started,
    details: {
      mode: 'MOCK',
      service: args.serviceName,
      previousPodId,
      newPodId,
      restartedAt: new Date().toISOString(),
      healthCheckPassedAt: new Date(Date.now() + 4200).toISOString(),
      replicas: { before: 3, after: 3 },
    },
    message: `Pod ${previousPodId} on ${args.serviceName} was terminated; replacement ${newPodId} is healthy. Reason recorded: ${args.reason}`,
  };
  log('restartPod.success', result);
  return result;
}

function randomShortId(): string {
  return Math.random().toString(36).slice(2, 8);
}
