import { useState } from 'react';
import { api } from '../api/client';

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="glass-card w-full max-w-md p-8 space-y-6">
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-400">SRE Sentinel</div>
          <h1 className="text-2xl font-semibold">Operator sign-in</h1>
          <p className="text-sm text-slate-400">
            Demo credential required to view incidents and approve remediations.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="block text-xs font-medium uppercase tracking-wider text-slate-400">
            Demo password
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            placeholder=""
          />
        </div>
        {error && (
          <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={pending || password.length === 0}
          className="btn-primary w-full"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
