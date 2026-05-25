// Phase 3 mock for the Dynatrace MCP server. The function names and shapes match
// the real MCP tools so swapping to the live MCP in Phase 4 is just a transport
// change — the agent code does not see a difference.

export interface MockProblem {
  problemId: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedEntities: Array<{ entityId: string; name: string; type: string }>;
  detectionSignals: string[];
  firstSeenAt: string;
}

export interface MockDeployment {
  deploymentId: string;
  version: string;
  serviceName: string;
  deployedAt: string;
  deployedBy: string;
  commitSha: string;
  rolledOut: boolean;
}

export interface MockLogLine {
  at: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  service: string;
  message: string;
}

const PROBLEMS: Record<string, MockProblem> = {
  'P-2026-05-25-001': {
    problemId: 'P-2026-05-25-001',
    title: 'Response time degradation on checkout-api',
    severity: 'high',
    affectedEntities: [
      { entityId: 'SERVICE-CHECKOUT-API', name: 'checkout-api', type: 'SERVICE' },
    ],
    detectionSignals: [
      'p99 latency rose from 220ms to 4100ms over 6 minutes',
      'error rate climbed from 0.4% to 9.7% in the same window',
      'CPU saturation flat at 35%, ruling out load as the cause',
    ],
    firstSeenAt: new Date(Date.now() - 9 * 60_000).toISOString(),
  },
  'P-2026-05-25-002': {
    problemId: 'P-2026-05-25-002',
    title: 'Memory leak suspected on payment-gateway',
    severity: 'medium',
    affectedEntities: [
      { entityId: 'SERVICE-PAYMENT-GATEWAY', name: 'payment-gateway', type: 'SERVICE' },
    ],
    detectionSignals: [
      'Working-set memory grew linearly from 480MB to 1.7GB over 4 hours',
      'No recent deploys in the last 48 hours',
      'GC pause time climbing past 800ms — runtime is in trouble',
    ],
    firstSeenAt: new Date(Date.now() - 14 * 60_000).toISOString(),
  },
};

const DEPLOYMENTS: Record<string, MockDeployment[]> = {
  'SERVICE-CHECKOUT-API': [
    {
      deploymentId: 'dep-2026-05-25-a91',
      version: 'v2.14.0',
      serviceName: 'checkout-api',
      deployedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
      deployedBy: 'release-bot',
      commitSha: '9f4ac21',
      rolledOut: true,
    },
    {
      deploymentId: 'dep-2026-05-24-b03',
      version: 'v2.13.9',
      serviceName: 'checkout-api',
      deployedAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
      deployedBy: 'release-bot',
      commitSha: '7b1de80',
      rolledOut: true,
    },
  ],
  'SERVICE-PAYMENT-GATEWAY': [
    {
      deploymentId: 'dep-2026-05-23-c44',
      version: 'v4.2.1',
      serviceName: 'payment-gateway',
      deployedAt: new Date(Date.now() - 50 * 60 * 60_000).toISOString(),
      deployedBy: 'release-bot',
      commitSha: '3ee29f1',
      rolledOut: true,
    },
  ],
};

const LOGS: Record<string, MockLogLine[]> = {
  'SERVICE-CHECKOUT-API': [
    {
      at: new Date(Date.now() - 5 * 60_000).toISOString(),
      level: 'ERROR',
      service: 'checkout-api',
      message: 'Connection pool exhausted: 50/50 in use, 312 requests queued',
    },
    {
      at: new Date(Date.now() - 4 * 60_000).toISOString(),
      level: 'ERROR',
      service: 'checkout-api',
      message: 'PostgresAdapter: timeout after 5000ms waiting for available connection',
    },
    {
      at: new Date(Date.now() - 3 * 60_000).toISOString(),
      level: 'FATAL',
      service: 'checkout-api',
      message: 'Unhandled error in /api/checkout: Error: connection terminated unexpectedly',
    },
    {
      at: new Date(Date.now() - 2 * 60_000).toISOString(),
      level: 'WARN',
      service: 'checkout-api',
      message: 'Circuit breaker for postgres-primary opened (threshold: 50% failure rate)',
    },
  ],
  'SERVICE-PAYMENT-GATEWAY': [
    {
      at: new Date(Date.now() - 60 * 60_000).toISOString(),
      level: 'WARN',
      service: 'payment-gateway',
      message: 'GC pause 612ms (Young Gen, paused 3 worker threads)',
    },
    {
      at: new Date(Date.now() - 30 * 60_000).toISOString(),
      level: 'WARN',
      service: 'payment-gateway',
      message: 'GC pause 845ms (Old Gen, paused 8 worker threads)',
    },
  ],
};

export function getProblem(problemId: string): MockProblem {
  const p = PROBLEMS[problemId];
  if (!p) throw new Error(`No problem with problemId=${problemId}`);
  return p;
}

export function getDeployments(entityId: string, lookbackMinutes: number): MockDeployment[] {
  const all = DEPLOYMENTS[entityId] ?? [];
  const cutoff = Date.now() - lookbackMinutes * 60_000;
  return all.filter((d) => Date.parse(d.deployedAt) >= cutoff);
}

export function getLogs(entityId: string, sinceMinutes: number, limit: number): MockLogLine[] {
  const all = LOGS[entityId] ?? [];
  const cutoff = Date.now() - sinceMinutes * 60_000;
  return all.filter((l) => Date.parse(l.at) >= cutoff).slice(0, limit);
}

export function ensureProblemExists(problemId: string): void {
  if (!PROBLEMS[problemId]) {
    throw new Error(
      `Unknown problemId=${problemId}. Phase 3 supports the seeded demo problems: ${Object.keys(PROBLEMS).join(', ')}`,
    );
  }
}

export function listSeededProblems(): MockProblem[] {
  return Object.values(PROBLEMS);
}
