import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { IncidentRecord } from '@sre-sentinel/shared';
import { apiUrl } from '../api/client';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

interface IncidentStreamValue {
  incidents: IncidentRecord[];
  status: StreamStatus;
  ready: boolean;
}

const IncidentStreamContext = createContext<IncidentStreamValue | null>(null);

// Re-probe auth this many milliseconds after EventSource enters 'reconnecting'.
// Anything < ~5s catches typical session-expiry mid-stream; anything > 10s
// makes the operator wait too long during real network blips.
const AUTH_REPROBE_AFTER_MS = 6000;

// IncidentStreamProvider opens a single EventSource for the entire app and
// fans incidents/status out via context. Mounting this once at the App level
// means navigating between list and detail views does not churn the stream.
export function IncidentStreamProvider({
  onAuthLost,
  children,
}: {
  onAuthLost: () => void;
  children: ReactNode;
}) {
  const [incidents, setIncidents] = useState<Map<string, IncidentRecord>>(new Map());
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [ready, setReady] = useState(false);
  const authLostRef = useRef(onAuthLost);
  authLostRef.current = onAuthLost;

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let reprobeTimer: ReturnType<typeof setTimeout> | null = null;

    const merge = (incident: IncidentRecord) => {
      setIncidents((prev) => {
        const next = new Map(prev);
        next.set(incident.id, incident);
        return next;
      });
    };

    const safeParse = <T,>(raw: string, label: string): T | null => {
      try {
        return JSON.parse(raw) as T;
      } catch (err) {
        // EventSource swallows listener exceptions; surface the bad frame here.
        console.warn(`[stream] failed to parse ${label} frame`, err, raw);
        return null;
      }
    };

    const probeAuth = async (): Promise<'ok' | 'unauth' | 'unknown'> => {
      try {
        const res = await fetch(apiUrl('/api/incidents'), { credentials: 'include' });
        if (res.status === 401) return 'unauth';
        if (res.ok) return 'ok';
        return 'unknown';
      } catch {
        return 'unknown';
      }
    };

    const scheduleReprobe = () => {
      if (reprobeTimer) return; // already pending
      reprobeTimer = setTimeout(async () => {
        reprobeTimer = null;
        if (cancelled) return;
        const verdict = await probeAuth();
        if (cancelled) return;
        if (verdict === 'unauth') {
          source?.close();
          source = null;
          authLostRef.current();
        }
        // 'ok' or 'unknown': leave EventSource to keep retrying on its own.
      }, AUTH_REPROBE_AFTER_MS);
    };

    const cancelReprobe = () => {
      if (reprobeTimer) {
        clearTimeout(reprobeTimer);
        reprobeTimer = null;
      }
    };

    const connect = () => {
      source = new EventSource(apiUrl('/api/incidents/stream'), { withCredentials: true });

      source.addEventListener('snapshot', (event) => {
        if (cancelled) return;
        const data = safeParse<{ incidents: IncidentRecord[] }>((event as MessageEvent).data, 'snapshot');
        if (!data) return;
        setIncidents(new Map(data.incidents.map((i) => [i.id, i])));
        setReady(true);
        setStatus('live');
      });

      const handleIncidentFrame = (label: string) => (event: Event) => {
        if (cancelled) return;
        const data = safeParse<{ incident: IncidentRecord }>((event as MessageEvent).data, label);
        if (!data?.incident) return;
        merge(data.incident);
      };
      source.addEventListener('incident.created', handleIncidentFrame('incident.created'));
      source.addEventListener('incident.updated', handleIncidentFrame('incident.updated'));
      source.addEventListener('incidents.reset', () => {
        if (cancelled) return;
        setIncidents(new Map());
      });

      source.onerror = () => {
        if (cancelled) return;
        setStatus('reconnecting');
        scheduleReprobe();
      };
      source.onopen = () => {
        if (cancelled) return;
        setStatus('live');
        cancelReprobe();
      };
    };

    // Pre-flight: EventSource cannot surface a 401 to JS, so verify the
    // session before opening the long-lived stream.
    void (async () => {
      const verdict = await probeAuth();
      if (cancelled) return;
      if (verdict === 'unauth') {
        authLostRef.current();
        return;
      }
      // 'ok' or 'unknown' (transient network): try the stream regardless;
      // EventSource will keep retrying and the schedule-reprobe path will
      // surface a sustained 401 later.
      connect();
    })();

    return () => {
      cancelled = true;
      cancelReprobe();
      source?.close();
      setStatus('closed');
    };
  }, []);

  const ordered = useMemo(
    () =>
      Array.from(incidents.values()).sort(
        (a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt),
      ),
    [incidents],
  );

  const value: IncidentStreamValue = { incidents: ordered, status, ready };
  return <IncidentStreamContext.Provider value={value}>{children}</IncidentStreamContext.Provider>;
}

export function useIncidents(): IncidentStreamValue {
  const ctx = useContext(IncidentStreamContext);
  if (!ctx) {
    throw new Error('useIncidents must be used inside an <IncidentStreamProvider>');
  }
  return ctx;
}
