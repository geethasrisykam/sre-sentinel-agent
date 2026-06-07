import { useEffect, useState } from 'react';
import type { IncidentRecord } from '@sre-sentinel/shared';
import { api, AuthRequiredError } from '../api/client';

interface Props {
  incident: IncidentRecord;
  onAuthLost: () => void;
}

const RISK_STYLES: Record<string, string> = {
  low: 'text-emerald-300 bg-emerald-950/60 border-emerald-800',
  medium: 'text-amber-300 bg-amber-950/60 border-amber-800',
  high: 'text-red-300 bg-red-950/60 border-red-800',
};

export function ApprovalPanel({ incident, onAuthLost }: Props) {
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const proposal = incident.proposedRemediation;
  const originalArgsText = proposal ? JSON.stringify(proposal.args, null, 2) : '';
  const [argsText, setArgsText] = useState(originalArgsText);

  // Reset draft args whenever the underlying proposal changes (e.g. when
  // navigating to a different incident).
  useEffect(() => {
    setArgsText(originalArgsText);
    setEditing(false);
  }, [originalArgsText]);

  if (!proposal) {
    return (
      <div className="glass-card p-5">
        <div className="text-sm font-semibold uppercase tracking-wider text-slate-400">Proposed action</div>
        <div className="mt-3 text-sm text-slate-500">No proposal yet.</div>
      </div>
    );
  }

  const dirty = editing && argsText.trim() !== originalArgsText.trim();

  async function decide(decision: 'approve' | 'reject') {
    setError(null);
    let modifiedArgs: Record<string, unknown> | undefined;
    if (decision === 'approve' && dirty) {
      try {
        const parsed = JSON.parse(argsText);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Arguments must be a JSON object.');
        }
        modifiedArgs = parsed as Record<string, unknown>;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid JSON in args');
        return;
      }
    }
    setPending(decision);
    try {
      await api.decide(incident.id, decision, 'Geethaa', modifiedArgs);
    } catch (err) {
      if (err instanceof AuthRequiredError) onAuthLost();
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  const riskCls = RISK_STYLES[proposal.riskAssessment] ?? 'text-slate-300 bg-slate-800 border-slate-700';
  const isAwaiting = incident.state === 'AWAITING_APPROVAL';

  return (
    <div className="glass-card p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold uppercase tracking-wider text-slate-400">Proposed action</div>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${riskCls}`}>
          risk: {proposal.riskAssessment}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Tool</div>
          <div className="font-mono text-base text-cyan-300">{proposal.tool}</div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Arguments
              {dirty && (
                <span className="ml-2 rounded border border-amber-800 bg-amber-950/40 px-1.5 py-0.5 text-amber-300">
                  modified
                </span>
              )}
            </div>
            {isAwaiting && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-md border border-cyan-700/60 bg-cyan-950/40 px-2.5 py-1 font-mono text-[11px] font-medium text-cyan-300 transition hover:border-cyan-500 hover:bg-cyan-900/60 hover:text-cyan-200"
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
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
            )}
            {isAwaiting && editing && (
              <button
                onClick={() => {
                  setArgsText(originalArgsText);
                  setEditing(false);
                  setError(null);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800/60 px-2.5 py-1 font-mono text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60 hover:text-slate-100"
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
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                Reset
              </button>
            )}
          </div>
          {editing ? (
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={Math.max(4, argsText.split('\n').length)}
              spellCheck={false}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950/70 p-2 font-mono text-[11px] text-slate-200 outline-none focus:border-cyan-600"
            />
          ) : (
            <pre className="mt-1 overflow-x-auto rounded border border-slate-800 bg-slate-950/50 p-2 font-mono text-[11px] text-slate-300">
              {originalArgsText}
            </pre>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Rationale</div>
          <p className="mt-1 text-sm text-slate-200">{proposal.rationale}</p>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Estimated blast radius</div>
          <p className="mt-1 text-sm text-slate-300">{proposal.estimatedBlastRadius}</p>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {isAwaiting ? (
        <div className="mt-5 flex gap-3">
          <button
            onClick={() => decide('approve')}
            disabled={pending !== null}
            className="btn-success flex-1"
          >
            {pending === 'approve' ? 'Approving…' : dirty ? 'Approve with edits' : 'Approve & execute'}
          </button>
          <button
            onClick={() => decide('reject')}
            disabled={pending !== null}
            className="btn-danger flex-1"
          >
            {pending === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      ) : (
        <div className="mt-5 rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
          Decision window closed (state: {incident.state.toLowerCase()}).
          {incident.approval && (
            <>
              {' '}
              {incident.approval.decision === 'approve' ? 'Approved' : 'Rejected'} by{' '}
              <span className="text-slate-300">{incident.approval.decidedBy}</span>.
              {incident.approval.modifiedArgs && (
                <span className="ml-2 rounded border border-amber-800 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                  args edited
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
