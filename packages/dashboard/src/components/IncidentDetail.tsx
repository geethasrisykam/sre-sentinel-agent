import { useEffect, useState } from 'react';
import type { IncidentRecord } from '@sre-sentinel/shared';
import { api, AuthRequiredError } from '../api/client';
import { useIncidents } from '../hooks/useIncidentStream';
import { SeverityBadge, StateBadge } from './StateBadge';
import { ReasoningTimeline } from './ReasoningTimeline';
import { ApprovalPanel } from './ApprovalPanel';

interface Props {
  incidentId: string;
  onBack: () => void;
  onAuthLost: () => void;
}

export function IncidentDetail({ incidentId, onBack, onAuthLost }: Props) {
  const { incidents, ready } = useIncidents();
  const [fallback, setFallback] = useState<IncidentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamed = incidents.find((i) => i.id === incidentId);
  const incident = streamed ?? fallback;

  // If the stream snapshot is bounded (50 incidents) and this one is older,
  // fetch it directly once as a fallback.
  useEffect(() => {
    if (streamed || !ready) return;
    let cancelled = false;
    api
      .getIncident(incidentId)
      .then((inc) => !cancelled && setFallback(inc))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthRequiredError) onAuthLost();
        else setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [incidentId, ready, streamed, onAuthLost]);

  if (error) {
    return (
      <div className="glass-card p-5">
        <div className="text-sm text-red-300">{error}</div>
        <button onClick={onBack} className="btn-secondary mt-4">← Back</button>
      </div>
    );
  }

  if (!incident) {
    return <div className="glass-card p-6 text-sm text-slate-500">Loading incident…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="btn-secondary text-xs">← All incidents</button>
        <code className="font-mono text-[11px] text-slate-600">{incident.id}</code>
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={incident.severity} />
          <StateBadge state={incident.state} />
        </div>
        <h1 className="mt-3 text-xl font-semibold text-slate-100">{incident.problemTitle}</h1>
        <div className="mt-1 font-mono text-xs text-slate-500">
          {incident.affectedEntity} · {incident.problemId} · received {new Date(incident.receivedAt).toLocaleString()}
        </div>
        {incident.outcome && (
          <div className={`mt-4 rounded border px-3 py-2 text-sm ${
            incident.outcome.success
              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
              : 'border-red-800 bg-red-950/40 text-red-200'
          }`}>
            <span className="font-semibold">{incident.outcome.success ? 'Resolved' : 'Failed'}</span> in {incident.outcome.durationMs}ms — {incident.outcome.summary}
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ReasoningTimeline turns={incident.agentTurns} />
        <ApprovalPanel incident={incident} onAuthLost={onAuthLost} />
      </div>
    </div>
  );
}
