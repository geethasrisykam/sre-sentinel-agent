import type { IncidentState } from '@sre-sentinel/shared';

const STATE_STYLES: Record<IncidentState, { label: string; classes: string; dot: string }> = {
  RECEIVED: {
    label: 'Received',
    classes: 'bg-slate-800 text-slate-300 border-slate-700',
    dot: 'bg-slate-400',
  },
  TRIAGING: {
    label: 'Triaging',
    classes: 'bg-blue-950/60 text-blue-300 border-blue-800',
    dot: 'bg-blue-400 animate-pulse-slow',
  },
  DIAGNOSED: {
    label: 'Diagnosed',
    classes: 'bg-indigo-950/60 text-indigo-300 border-indigo-800',
    dot: 'bg-indigo-400',
  },
  AWAITING_APPROVAL: {
    label: 'Awaiting approval',
    classes: 'bg-amber-950/60 text-amber-300 border-amber-800',
    dot: 'bg-amber-400 animate-pulse-slow',
  },
  EXECUTING: {
    label: 'Executing',
    classes: 'bg-purple-950/60 text-purple-300 border-purple-800',
    dot: 'bg-purple-400 animate-pulse-slow',
  },
  RESOLVED: {
    label: 'Resolved',
    classes: 'bg-emerald-950/60 text-emerald-300 border-emerald-800',
    dot: 'bg-emerald-400',
  },
  FAILED: {
    label: 'Failed',
    classes: 'bg-red-950/60 text-red-300 border-red-800',
    dot: 'bg-red-400',
  },
  REJECTED: {
    label: 'Rejected',
    classes: 'bg-slate-800 text-slate-400 border-slate-700',
    dot: 'bg-slate-500',
  },
};

export function StateBadge({ state }: { state: IncidentState }) {
  const style = STATE_STYLES[state];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.classes}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
      {style.label}
    </span>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-900/40 text-red-300 border-red-800',
  high: 'bg-orange-900/40 text-orange-300 border-orange-800',
  medium: 'bg-yellow-900/40 text-yellow-300 border-yellow-800',
  low: 'bg-blue-900/40 text-blue-300 border-blue-800',
};

export function SeverityBadge({ severity }: { severity: string }) {
  const cls = SEVERITY_STYLES[severity] ?? 'bg-slate-800 text-slate-300 border-slate-700';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}>
      {severity}
    </span>
  );
}
