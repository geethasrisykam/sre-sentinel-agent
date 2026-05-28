import type { AgentTurn } from '@sre-sentinel/shared';

export function ReasoningTimeline({ turns }: { turns: AgentTurn[] }) {
  if (turns.length === 0) {
    return (
      <div className="glass-card p-5">
        <div className="text-sm font-semibold uppercase tracking-wider text-slate-400">Reasoning timeline</div>
        <div className="mt-3 text-sm text-slate-500">Waiting for the agent to begin…</div>
      </div>
    );
  }
  return (
    <div className="glass-card p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold uppercase tracking-wider text-slate-400">Reasoning timeline</div>
        <div className="font-mono text-[10px] text-slate-600">{turns.length} step{turns.length === 1 ? '' : 's'}</div>
      </div>
      <ol className="mt-4 space-y-3">
        {turns.map((turn, idx) => (
          <li key={idx} className="relative pl-6">
            <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-cyan-500" />
            {idx < turns.length - 1 && <span className="absolute left-[3px] top-3.5 h-full w-px bg-slate-800" />}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-slate-500">{formatTime(turn.at)}</span>
              {turn.toolCall && (
                <span className="rounded bg-cyan-950/60 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                  {turn.toolCall.name}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-slate-200">{turn.thought}</div>
            {turn.toolCall && <ArgsRow args={turn.toolCall.args} />}
            {turn.toolResult && <ResultDetails result={turn.toolResult} />}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Args from a single tool call. Most calls have 1–3 simple key/value pairs
// (problemId, entityId, lookbackMinutes), so render them inline as
// "key: value" pills rather than a JSON blob.
function ArgsRow({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex items-center gap-1.5 rounded border border-slate-800 bg-slate-950/40 px-2 py-0.5 font-mono text-[11px]"
        >
          <span className="text-slate-500">{key}</span>
          <span className="text-slate-300">{renderArgValue(value)}</span>
        </div>
      ))}
    </div>
  );
}

function renderArgValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '∅';
  return JSON.stringify(value);
}

// Tool result is variable-shape (problem, deployments array, log lines, or
// {error}). Add a short headline and keep the raw payload in a collapsible.
function ResultDetails({ result }: { result: { ok: boolean; data: unknown } }) {
  const summary = summariseResult(result);
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
        <span className={result.ok ? 'text-slate-400' : 'text-red-400'}>
          {result.ok ? '✓' : '✗'} {summary}
        </span>
      </summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded border border-slate-800 bg-slate-950/50 p-2 font-mono text-[11px] text-slate-400">
        {JSON.stringify(result.data, null, 2)}
      </pre>
    </details>
  );
}

function summariseResult(result: { ok: boolean; data: unknown }): string {
  if (!result.ok) {
    const err = (result.data as { error?: string })?.error;
    return err ? `error: ${err}` : 'error';
  }
  const data = result.data;
  if (Array.isArray(data)) {
    return `${data.length} item${data.length === 1 ? '' : 's'}`;
  }
  if (data && typeof data === 'object') {
    const keyCount = Object.keys(data).length;
    return `object · ${keyCount} field${keyCount === 1 ? '' : 's'}`;
  }
  return 'result';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
