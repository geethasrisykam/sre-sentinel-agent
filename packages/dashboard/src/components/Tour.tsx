import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

// Each step targets a DOM element by its data-tour attribute. If the element
// isn't on the current page, the step is skipped automatically — the tour
// works on the list view; once the user opens an incident, they can replay
// the tour via the "Take a tour" header button and the detail-view steps
// (timeline, approval) light up.

interface TourStep {
  id: string;
  target: string | null; // data-tour attribute value, or null for a generic intro/outro card
  title: string;
  body: string;
  // Hint about which page the user needs to be on for this step to show.
  // The TourOverlay quietly skips steps whose target isn't in the DOM.
  page: 'any' | 'list' | 'detail';
  placement?: 'bottom' | 'top' | 'left' | 'right';
}

const STEPS: TourStep[] = [
  {
    id: 'intro',
    target: null,
    title: 'Welcome to SRE Sentinel',
    body:
      "This is the operator console for an autonomous incident-triage agent. Three things to know before you dive in — should take 30 seconds. You can skip anytime.",
    page: 'any',
  },
  {
    id: 'simulate',
    target: 'simulate',
    title: 'Fire a simulated alert',
    body:
      "These cards each model a real Dynatrace problem shape — bad deploys, load spikes, leaks. Click one to fire it into the agent and watch what happens.",
    page: 'list',
    placement: 'bottom',
  },
  {
    id: 'status-pill',
    target: 'status-pill',
    title: 'This is your live link',
    body:
      "A green dot means the dashboard is connected to the orchestrator over Server-Sent Events. Every agent step streams in here in real time — the reasoning timeline fills in as it happens.",
    page: 'list',
    placement: 'left',
  },
  {
    id: 'timeline',
    target: 'timeline',
    title: 'Reasoning timeline',
    body:
      "Each step the agent takes — every Dynatrace MCP call, every piece of evidence — lands here as the agent works. No black box.",
    page: 'detail',
    placement: 'right',
  },
  {
    id: 'approval',
    target: 'approval',
    title: 'You decide',
    body:
      "The agent's proposal lands here with rationale and blast radius. Edit the args if you want, then Approve or Reject. Nothing runs without your one-click consent.",
    page: 'detail',
    placement: 'left',
  },
  {
    id: 'outro',
    target: null,
    title: "That's it",
    body:
      "Fire a problem, watch the timeline, approve. Replay this tour anytime from the header. Happy triage.",
    page: 'any',
  },
];

const STORAGE_KEY = 'sentinel.tour.seen';

interface TourContextValue {
  active: boolean;
  start: () => void;
  stop: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);

  // Auto-fire on first visit (after login), once.
  useEffect(() => {
    const seen = window.localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      // Brief delay so the dashboard's first render settles before the
      // tooltip starts measuring elements.
      const t = setTimeout(() => setActive(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const start = useCallback(() => setActive(true), []);
  const stop = useCallback(() => {
    setActive(false);
    window.localStorage.setItem(STORAGE_KEY, '1');
  }, []);

  return (
    <TourContext.Provider value={{ active, start, stop }}>{children}</TourContext.Provider>
  );
}

function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be inside <TourProvider>');
  return ctx;
}

// Header button that replays the tour at any time.
export function TourButton() {
  const { start } = useTour();
  return (
    <button
      onClick={start}
      title="Take a guided tour of the UI"
      className="icon-btn"
      aria-label="Take a tour"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </button>
  );
}

// The actual overlay — fixed-position scrim + spotlight ring + tooltip card.
export function TourOverlay() {
  const { active, stop } = useTour();
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Reset to step 0 each time the tour is activated.
  useEffect(() => {
    if (active) setStepIndex(0);
  }, [active]);

  // Skip steps whose target isn't in the DOM (e.g. detail-view steps when
  // we're on the list view). Find the next renderable step.
  const visibleStep = active ? findNextVisibleStep(stepIndex) : null;

  // Re-measure the spotlight target on every step change, scroll, or resize.
  useEffect(() => {
    if (!visibleStep) {
      setRect(null);
      return;
    }
    const measure = () => {
      if (!visibleStep.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector<HTMLElement>(`[data-tour="${visibleStep.target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Wait a tick for scroll to settle, then measure.
      requestAnimationFrame(() => setRect(el.getBoundingClientRect()));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [visibleStep]);

  if (!active || !visibleStep) return null;

  const totalSteps = STEPS.length;
  const currentNumber = STEPS.indexOf(visibleStep) + 1;
  const isLast = currentNumber === totalSteps;

  const advance = () => {
    if (isLast) {
      stop();
      return;
    }
    setStepIndex(currentNumber); // move to the next index
  };
  const goBack = () => {
    setStepIndex(Math.max(0, currentNumber - 2));
  };

  // Choose a tooltip placement near the target rect, or center on screen if
  // there's no target (intro / outro cards).
  const tooltipPosition = rect
    ? computeTooltipPosition(rect, visibleStep.placement ?? 'bottom')
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="fixed inset-0 z-50 animate-fade-in">
      {/* Scrim. pointer-events: auto so clicking the scrim doesn't dismiss
       *   the tour by accident; use the Skip button instead. */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] dark:bg-black/60" />

      {/* Spotlight ring around the targeted element. */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-cyan-400 ring-offset-2 ring-offset-transparent shadow-[0_0_0_4px_rgba(34,211,238,0.18)]"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            transition: 'all 250ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      )}

      {/* Tooltip card. */}
      <div
        className="absolute w-[min(360px,calc(100vw-32px))] rounded-xl border bg-white p-5 shadow-2xl ring-1 ring-slate-900/5 border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10 animate-slide-up"
        style={tooltipPosition}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-400">
            Step {currentNumber} of {totalSteps}
          </span>
          <button
            onClick={stop}
            className="text-[11px] text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            Skip
          </button>
        </div>
        <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
          {visibleStep.title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {visibleStep.body}
        </p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            onClick={goBack}
            disabled={currentNumber === 1}
            className="rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-30 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Back
          </button>
          <div className="flex flex-1 items-center justify-center gap-1">
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 w-1.5 rounded-full transition ${
                  i === currentNumber - 1
                    ? 'w-4 bg-cyan-500 dark:bg-cyan-400'
                    : 'bg-slate-300 dark:bg-slate-700'
                }`}
              />
            ))}
          </div>
          <button
            onClick={advance}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Walk forward from `from` until we find a step whose target is either null
// (intro/outro) or in the DOM. Steps tied to pages the user isn't on get
// quietly skipped so the tour stays useful.
function findNextVisibleStep(from: number): TourStep | null {
  for (let i = from; i < STEPS.length; i++) {
    const step = STEPS[i]!;
    if (!step.target) return step;
    if (document.querySelector(`[data-tour="${step.target}"]`)) return step;
  }
  return null;
}

// Roughly place the tooltip near the spotlight rect. Falls back to a sane
// position if the target is near a screen edge.
function computeTooltipPosition(
  rect: DOMRect,
  placement: 'top' | 'bottom' | 'left' | 'right',
): React.CSSProperties {
  const MARGIN = 16;
  const tooltipW = 360;
  const tooltipH = 160; // estimate; actual height varies, fine for placement
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = 0;
  let top = 0;

  switch (placement) {
    case 'bottom':
      left = rect.left + rect.width / 2 - tooltipW / 2;
      top = rect.bottom + MARGIN;
      break;
    case 'top':
      left = rect.left + rect.width / 2 - tooltipW / 2;
      top = rect.top - tooltipH - MARGIN;
      break;
    case 'left':
      left = rect.left - tooltipW - MARGIN;
      top = rect.top + rect.height / 2 - tooltipH / 2;
      break;
    case 'right':
      left = rect.right + MARGIN;
      top = rect.top + rect.height / 2 - tooltipH / 2;
      break;
  }

  // Clamp into viewport.
  left = Math.max(MARGIN, Math.min(left, vw - tooltipW - MARGIN));
  top = Math.max(MARGIN, Math.min(top, vh - tooltipH - MARGIN));

  return { left: `${left}px`, top: `${top}px` };
}
