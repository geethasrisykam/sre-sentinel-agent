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
            {turn.toolCall && (
              <pre className="mt-2 overflow-x-auto rounded border border-slate-800 bg-slate-950/50 p-2 font-mono text-[11px] text-slate-400">
                {JSON.stringify(turn.toolCall.args, null, 2)}
              </pre>
            )}
            {turn.toolResult && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
                  {turn.toolResult.ok ? 'tool result' : 'tool error'} (click to expand)
                </summary>
                <pre className="mt-1 max-h-64 overflow-auto rounded border border-slate-800 bg-slate-950/50 p-2 font-mono text-[11px] text-slate-400">
                  {JSON.stringify(turn.toolResult.data, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
