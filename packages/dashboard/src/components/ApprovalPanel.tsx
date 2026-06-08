import { useEffect, useState } from 'react';
import type { IncidentRecord } from '@sre-sentinel/shared';
import { api, AuthRequiredError, ConflictError } from '../api/client';

interface Props {
  incident: IncidentRecord;
  onAuthLost: () => void;
}

const RISK_STYLES: Record<string, string> = {
  low: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/60 dark:border-emerald-800',
  medium:
    'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/60 dark:border-amber-800',
  high: 'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950/60 dark:border-red-800',
};

export function ApprovalPanel({ incident, onAuthLost }: Props) {
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submittedDecision, setSubmittedDecision] = useState<'approve' | 'reject' | null>(null);
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

  // Once SSE confirms the state has moved past AWAITING_APPROVAL, the
  // "submitted" banner has done its job — drop it.
  useEffect(() => {
    if (incident.state !== 'AWAITING_APPROVAL' && submittedDecision !== null) {
      setSubmittedDecision(null);
      setInfo(null);
    }
  }, [incident.state, submittedDecision]);

  if (!proposal) {
    return (
      <div className="glass-card p-5">
        <div className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
          Proposed action
        </div>
        <div className="mt-3 text-sm text-slate-500 dark:text-slate-500">No proposal yet.</div>
      </div>
    );
  }

  const dirty = editing && argsText.trim() !== originalArgsText.trim();

  async function decide(decision: 'approve' | 'reject') {
    setError(null);
    setInfo(null);
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
      setSubmittedDecision(decision);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        onAuthLost();
      } else if (err instanceof ConflictError) {
        setInfo(
          err.serverState
            ? `This incident already moved to ${err.serverState.toLowerCase()} — likely a previous click landed first. Refreshing…`
            : 'This incident already moved past approval. Refreshing…',
        );
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPending(null);
    }
  }

  const riskCls =
    RISK_STYLES[proposal.riskAssessment] ??
    'text-slate-700 bg-slate-100 border-slate-200 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-700';
  const isAwaiting = incident.state === 'AWAITING_APPROVAL';

  return (
    <div className="glass-card p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
          Proposed action
        </div>
        <span
          className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${riskCls}`}
        >
          risk: {proposal.riskAssessment}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500">
            Tool
          </div>
          <div className="font-mono text-base font-medium text-cyan-700 dark:text-cyan-300">
            {proposal.tool}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500">
              Arguments
              {dirty && (
                <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  modified
                </span>
              )}
            </div>
            {isAwaiting && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] font-medium transition border-cyan-300 bg-cyan-50 text-cyan-700 hover:border-cyan-500 hover:bg-cyan-100 dark:border-cyan-700/60 dark:bg-cyan-950/40 dark:text-cyan-300 dark:hover:border-cyan-500 dark:hover:bg-cyan-900/60 dark:hover:text-cyan-200"
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
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] font-medium transition border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-slate-100"
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
              className="mt-1 w-full rounded border p-2 font-mono text-[11px] outline-none border-slate-300 bg-white text-slate-800 focus:border-cyan-600 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:focus:border-cyan-600"
            />
          ) : (
            <pre className="mt-1 overflow-x-auto rounded border p-2 font-mono text-[11px] border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300">
              {originalArgsText}
            </pre>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500">
            Rationale
          </div>
          <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">{proposal.rationale}</p>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500">
            Estimated blast radius
          </div>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
            {proposal.estimatedBlastRadius}
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border px-3 py-2 text-sm border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {info && (
        <div className="mt-4 rounded-md border px-3 py-2 text-sm border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {info}
        </div>
      )}

      {submittedDecision && !info && (
        <div className="mt-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-200">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-500 dark:bg-cyan-400" />
          {submittedDecision === 'approve'
            ? 'Submitted — orchestrator is executing remediation now…'
            : 'Submitted — rejection recorded.'}
        </div>
      )}

      {isAwaiting ? (
        <div className="mt-5 flex gap-3">
          <button
            onClick={() => decide('approve')}
            disabled={pending !== null || submittedDecision !== null}
            className="btn-success flex-1"
          >
            {pending === 'approve'
              ? 'Approving…'
              : submittedDecision === 'approve'
                ? 'Submitted'
                : dirty
                  ? 'Approve with edits'
                  : 'Approve & execute'}
          </button>
          <button
            onClick={() => decide('reject')}
            disabled={pending !== null || submittedDecision !== null}
            className="btn-danger flex-1"
          >
            {pending === 'reject'
              ? 'Rejecting…'
              : submittedDecision === 'reject'
                ? 'Submitted'
                : 'Reject'}
          </button>
        </div>
      ) : (
        <div className="mt-5 rounded border px-3 py-2 text-xs border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-500">
          Decision window closed (state: {incident.state.toLowerCase()}).
          {incident.approval && (
            <>
              {' '}
              {incident.approval.decision === 'approve' ? 'Approved' : 'Rejected'} by{' '}
              <span className="text-slate-800 dark:text-slate-300">
                {incident.approval.decidedBy}
              </span>
              .
              {incident.approval.modifiedArgs && (
                <span className="ml-2 rounded border px-1.5 py-0.5 font-mono text-[10px] border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
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
