import { z } from 'zod';
import type { RemediationToolResult } from '@sre-sentinel/shared';
import { jitter, log, type RemediationConfig } from '../config.js';

export const rollbackDeploymentInput = {
  serviceName: z
    .string()
    .min(1)
    .describe('Name of the service to roll back.'),
  currentVersion: z
    .string()
    .min(1)
    .describe('Currently deployed version that is suspected to be faulty (e.g. "v2.14.0").'),
  targetVersion: z
    .string()
    .optional()
    .describe(
      'Optional explicit rollback target. If omitted, the agent should expect the last known-good version.',
    ),
  reason: z
    .string()
    .min(10)
    .describe('Concise justification for the rollback, written for the audit log.'),
};

const inputSchema = z.object(rollbackDeploymentInput);

export async function rollbackDeploymentHandler(
  args: z.infer<typeof inputSchema>,
  config: RemediationConfig,
): Promise<RemediationToolResult> {
  const started = Date.now();
  log('rollbackDeployment.start', { mode: config.rollbackMode, ...args });

  // rollback is mock-only by design — REAL would require a deploy provider integration
  // and a live registry of versions. The mock returns realistic structured data.
  await jitter(2400, 4800);

  const previousVersion = args.currentVersion;
  const newVersion = args.targetVersion ?? previousVersionGuess(previousVersion);

  const result: RemediationToolResult = {
    ok: true,
    durationMs: Date.now() - started,
    details: {
      mode: config.rollbackMode === 'REAL' ? 'REAL_PENDING' : 'MOCK',
      service: args.serviceName,
      previousVersion,
      newVersion,
      strategy: 'rolling-update',
      durationFromTriggerSec: Math.round((Date.now() - started) / 1000) + 18,
      healthChecks: {
        readiness: 'passed',
        liveness: 'passed',
        smokeTests: 'passed',
      },
      trafficShift: { startedAt: new Date().toISOString(), strategy: 'instant' },
    },
    message: `Rolled ${args.serviceName} from ${previousVersion} to ${newVersion}. Reason: ${args.reason}`,
  };
  log('rollbackDeployment.success', result);
  return result;
}

function previousVersionGuess(version: string): string {
  // Walk back one semver step. If patch > 0 decrement patch; if patch == 0 roll
  // back the minor (assuming a plausible last patch of 9); same idea for major.
  const semver = version.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!semver) return `${version}-prev`;

  const [, majorStr, minorStr, patchStr] = semver;
  const major = Number(majorStr);
  const minor = Number(minorStr);
  const patch = Number(patchStr);
  const prefix = version.startsWith('v') ? 'v' : '';

  if (patch > 0) return `${prefix}${major}.${minor}.${patch - 1}`;
  if (minor > 0) return `${prefix}${major}.${minor - 1}.9`;
  if (major > 0) return `${prefix}${major - 1}.9.9`;
  return version;
}
