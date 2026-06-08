import type { IncidentState } from '@sre-sentinel/shared';

const STATE_STYLES: Record<IncidentState, { label: string; classes: string; dot: string }> = {
  RECEIVED: {
    label: 'Received',
    classes:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400 dark:bg-slate-400',
  },
  TRIAGING: {
    label: 'Triaging',
    classes:
      'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
    dot: 'bg-blue-500 animate-pulse-slow dark:bg-blue-400',
  },
  DIAGNOSED: {
    label: 'Diagnosed',
    classes:
      'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
    dot: 'bg-indigo-500 dark:bg-indigo-400',
  },
  AWAITING_APPROVAL: {
    label: 'Awaiting approval',
    classes:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    dot: 'bg-amber-500 animate-pulse-slow dark:bg-amber-400',
  },
  EXECUTING: {
    label: 'Executing',
    classes:
      'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
    dot: 'bg-purple-500 animate-pulse-slow dark:bg-purple-400',
  },
  RESOLVED: {
    label: 'Resolved',
    classes:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
  },
  FAILED: {
    label: 'Failed',
    classes:
      'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300',
    dot: 'bg-red-500 dark:bg-red-400',
  },
  REJECTED: {
    label: 'Rejected',
    classes:
      'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
    dot: 'bg-slate-400 dark:bg-slate-500',
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
  critical:
    'border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-300',
  high:
    'border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  medium:
    'border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  low:
    'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
};

export function SeverityBadge({ severity }: { severity: string }) {
  const cls =
    SEVERITY_STYLES[severity] ??
    'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {severity}
    </span>
  );
}
