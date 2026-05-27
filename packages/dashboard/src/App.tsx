import { useCallback, useEffect, useState } from 'react';
import { api, AuthRequiredError } from './api/client';
import { IncidentStreamProvider } from './hooks/useIncidentStream';
import { LoginScreen } from './components/LoginScreen';
import { IncidentList } from './components/IncidentList';
import { IncidentDetail } from './components/IncidentDetail';

type AuthState = 'unknown' | 'authed' | 'anon';

export default function App() {
  const [auth, setAuth] = useState<AuthState>('unknown');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // On mount, probe an authenticated endpoint to determine auth status.
  useEffect(() => {
    let cancelled = false;
    api
      .listIncidents()
      .then(() => !cancelled && setAuth('authed'))
      .catch((err) => {
        if (cancelled) return;
        setAuth(err instanceof AuthRequiredError ? 'anon' : 'authed'); // network error: assume server side handles
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthLost = useCallback(() => {
    setAuth('anon');
    setSelectedId(null);
  }, []);

  async function logout() {
    try {
      await api.logout();
    } finally {
      handleAuthLost();
    }
  }

  if (auth === 'unknown') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Connecting to orchestrator…
      </div>
    );
  }
  if (auth === 'anon') {
    return <LoginScreen onSuccess={() => setAuth('authed')} />;
  }

  return (
    <IncidentStreamProvider onAuthLost={handleAuthLost}>
      <div className="min-h-screen">
        <header className="scanline sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-gradient-to-br from-cyan-500 to-blue-600 shadow-md shadow-cyan-900/40" />
              <div>
                <div className="text-sm font-semibold text-slate-100">SRE Sentinel</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">
                  Autonomous incident triage
                </div>
              </div>
            </div>
            <button onClick={logout} className="btn-secondary text-xs">Sign out</button>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-8">
          {selectedId ? (
            <IncidentDetail
              incidentId={selectedId}
              onBack={() => setSelectedId(null)}
              onAuthLost={handleAuthLost}
            />
          ) : (
            <IncidentList onOpen={setSelectedId} onAuthLost={handleAuthLost} />
          )}
        </main>

        <footer className="mx-auto max-w-6xl px-6 pb-8 pt-4 text-center font-mono text-[10px] text-slate-700">
          sre-sentinel · gemini agent + dynatrace mcp · hackathon build
        </footer>
      </div>
    </IncidentStreamProvider>
  );
}
