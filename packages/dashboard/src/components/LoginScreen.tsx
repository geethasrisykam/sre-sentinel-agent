import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ThemeToggle } from './ThemeToggle';

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // Subtle entrance: a tick after mount so the form scales in from a slight
  // offset. Pure cosmetic — improves "this feels polished" on the demo's
  // very first frame.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 16);
    return () => clearTimeout(t);
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.login(password);
      onSuccess();
    } catch {
      setError('Wrong password. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Animated aurora backdrop. */}
      <div className="absolute inset-0 aurora" aria-hidden />
      <div className="absolute inset-0 dot-grid opacity-60" aria-hidden />

      {/* Theme toggle floating in the corner so the very first impression
       * lets the user pick their preferred mode. */}
      <div className="absolute right-6 top-6 z-10">
        <ThemeToggle />
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1.1fr_1fr]">
        {/* ─── Left: hero / pitch ────────────────────────────── */}
        <div
          className={`space-y-8 transition-all duration-500 ${
            mounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="relative h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/25 dark:shadow-cyan-900/40">
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-cyan-400/0 to-cyan-400/30 animate-pulse-slow" />
            </div>
            <div>
              <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                SRE Sentinel
              </div>
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-400">
                Autonomous incident triage
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h1 className="text-3xl font-semibold leading-tight text-slate-900 dark:text-slate-100 sm:text-4xl">
              Turn 2 a.m. alerts into <br />
              <span className="bg-gradient-to-r from-cyan-500 to-blue-500 bg-clip-text text-transparent">
                90-second resolutions
              </span>
            </h1>
            <p className="max-w-md text-base leading-relaxed text-slate-600 dark:text-slate-400">
              Sentinel is a Gemini-powered agent that diagnoses Dynatrace problems, cites the
              evidence, and proposes a remediation. You keep the final yes-or-no.
            </p>
          </div>

          <ul className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
            <BulletPoint>
              Built with Gemini 2.5 + Google Cloud Agent Development Kit
            </BulletPoint>
            <BulletPoint>
              Dynatrace MCP server provides the observability superpowers
            </BulletPoint>
            <BulletPoint>
              Human-in-the-loop: every action behind an explicit approval
            </BulletPoint>
            <BulletPoint>Live SSE reasoning stream — watch the agent think</BulletPoint>
          </ul>

          <div className="hidden sm:flex flex-wrap gap-2 pt-2 text-[11px]">
            <Tag>Gemini 2.5 Flash</Tag>
            <Tag>ADK TypeScript</Tag>
            <Tag>MCP</Tag>
            <Tag>Fastify + SQLite</Tag>
            <Tag>React 18 + Vite</Tag>
          </div>
        </div>

        {/* ─── Right: sign-in card ───────────────────────────── */}
        <div
          className={`transition-all duration-500 ${
            mounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
          }`}
          style={{ transitionDelay: '120ms' }}
        >
          <form
            onSubmit={handleSubmit}
            className="glass-card w-full space-y-5 p-8 sm:p-9"
          >
            <div className="space-y-1.5">
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-400">
                Operator sign-in
              </div>
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Welcome back
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Enter your password to access the operator console.
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={revealed ? 'text' : 'password'}
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border bg-white px-3 py-2.5 pr-10 font-mono text-sm outline-none transition border-slate-300 text-slate-900 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-500/30"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
                  tabIndex={-1}
                  aria-label={revealed ? 'Hide password' : 'Show password'}
                >
                  {revealed ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border px-3 py-2 text-sm border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={pending || password.length === 0}
              className="btn-primary w-full text-sm shadow-md shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-cyan-500/30 disabled:transform-none disabled:shadow-none"
            >
              {pending ? 'Signing in…' : 'Sign in'}
            </button>

            <p className="pt-1 text-center text-[11px] text-slate-500 dark:text-slate-500">
              SRE Sentinel — Autonomous Incident Triage
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function BulletPoint({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-600 dark:text-cyan-400"
        aria-hidden
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border px-2.5 py-0.5 font-mono border-slate-300 bg-white/50 text-slate-600 backdrop-blur dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
      {children}
    </span>
  );
}
