import { useEffect, useState } from 'react';
import { api, AuthRequiredError, type SeededProblem } from '../api/client';
import { useIncidents, type StreamStatus } from '../hooks/useIncidentStream';
import { SeverityBadge, StateBadge } from './StateBadge';

interface Props {
  onOpen: (id: string) => void;
  onAuthLost: () => void;
}

const STATUS_LABEL: Record<StreamStatus, string> = {
  connecting: 'connecting…',
  live: 'live',
  reconnecting: 'reconnecting…',
  closed: 'closed',
};

const STATUS_DOT: Record<StreamStatus, string> = {
  connecting: 'bg-amber-500 dark:bg-amber-400 animate-pulse',
  live: 'bg-emerald-500 dark:bg-emerald-400',
  reconnecting: 'bg-amber-500 dark:bg-amber-400 animate-pulse',
  closed: 'bg-slate-400 dark:bg-slate-600',
};

export function IncidentList({ onOpen, onAuthLost }: Props) {
  const { incidents, status, ready } = useIncidents();
  const [problems, setProblems] = useState<SeededProblem[]>([]);
  const [firing, setFiring] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    api.listSeededProblems().then(setProblems).catch(() => undefined);
  }, []);

  async function fire(problemId: string) {
    setFiring(true);
    try {
      await api.fireWebhook(problemId);
    } catch (err) {
      if (err instanceof AuthRequiredError) onAuthLost();
    } finally {
      setFiring(false);
    }
  }

  async function clearAll() {
    if (incidents.length === 0) return;
    if (!window.confirm(`Clear all ${incidents.length} incidents? This cannot be undone.`)) return;
    setClearing(true);
    try {
      await api.clearAllIncidents();
      // SSE 'incidents.reset' event drops local state in lockstep.
    } catch (err) {
      if (err instanceof AuthRequiredError) onAuthLost();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="glass-card p-5" data-tour="simulate">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
          Simulate a Dynatrace alert
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-500">
          Pick a seeded problem and fire it into the agent.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {problems.map((p) => (
            <button
              key={p.problemId}
              onClick={() => fire(p.problemId)}
              disabled={firing}
              className="group rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-500 hover:shadow-md hover:shadow-cyan-500/10 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-cyan-700 dark:hover:bg-slate-900 dark:hover:shadow-cyan-900/20"
            >
              <div className="flex items-center gap-2">
                <SeverityBadge severity={p.severity} />
                <code className="font-mono text-[10px] text-slate-500 dark:text-slate-500">{p.problemId}</code>
              </div>
              <div className="mt-2 text-sm font-medium text-slate-800 group-hover:text-cyan-700 dark:text-slate-200 dark:group-hover:text-cyan-300">
                {p.title}
              </div>
            </button>
          ))}
          {problems.length === 0 && (
            <div className="text-sm text-slate-500 dark:text-slate-500">Loading seeded problems…</div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Incidents{' '}
            <span className="ml-2 text-slate-400 dark:text-slate-600">({incidents.length})</span>
          </h2>
          <div className="flex items-center gap-3">
            {incidents.length > 0 && (
              <button
                onClick={clearAll}
                disabled={clearing}
                title="Wipe all incidents for a clean demo replay"
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                  aria-hidden
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                {clearing ? 'Clearing…' : 'Clear all'}
              </button>
            )}
            <div
              className="flex items-center gap-2 font-mono text-xs text-slate-600 dark:text-slate-500"
              data-tour="status-pill"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
              {STATUS_LABEL[status]}
            </div>
          </div>
        </div>
        {!ready ? (
          <div className="glass-card p-6 text-sm text-slate-500">Loading…</div>
        ) : incidents.length === 0 ? (
          <div className="glass-card p-6 text-sm text-slate-500">
            No incidents yet. Fire a seeded problem above to see the agent work.
          </div>
        ) : (
          <ul className="space-y-2">
            {incidents.map((inc) => (
              <li key={inc.id}>
                <button
                  onClick={() => onOpen(inc.id)}
                  className="glass-card flex w-full items-start gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-500 hover:shadow-md hover:shadow-cyan-500/10 dark:hover:border-cyan-700 dark:hover:bg-slate-900 dark:hover:shadow-cyan-900/20"
                >
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <SeverityBadge severity={inc.severity} />
                      <StateBadge state={inc.state} />
                      <span className="text-xs text-slate-500 dark:text-slate-500">
                        {timeAgo(inc.receivedAt)}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {inc.problemTitle}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-500">
                      {inc.affectedEntity} · {inc.problemId}
                    </div>
                  </div>
                  {inc.proposedRemediation && (
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500">
                        Proposed
                      </div>
                      <div className="font-mono text-xs font-medium text-cyan-700 dark:text-cyan-300">
                        {inc.proposedRemediation.tool}
                      </div>
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
