import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// ARCHITECTURE NOTES
// ──────────────────
// The tour highlights a target element by CUTTING A HOLE in a darkened
// overlay rather than placing a scrim ON TOP of the target (which was the
// previous bug — the target disappeared behind the scrim in dark mode).
//
// The cutout is done with a CSS box-shadow trick: a transparent div sized
// to the target's bounding rect gets `box-shadow: 0 0 0 9999px <dim>`.
// The shadow extends outward to flood the rest of the viewport, while
// the box itself stays empty — the target shines through unobstructed.
//
// The whole overlay renders via React.createPortal into document.body so
// z-index and position contexts from ancestor components can't interfere.
// A glowing ring is rendered as a separate sibling element above the
// cutout box so it appears around the target.
//
// Tooltip placement: we ask for a preferred side per step, but if that
// side doesn't have room we fall back to whichever side has the most
// space, then clamp the final position into the viewport with a margin.
// This is more robust than the previous "respect placement, clamp at end"
// approach when targets sit near a viewport edge.

interface TourStep {
  id: string;
  /** data-tour attribute value to target. null = centred intro/outro card. */
  target: string | null;
  title: string;
  body: string;
  /** Where to put the tooltip if there's room. Otherwise we auto-pick. */
  preferredPlacement?: 'bottom' | 'top' | 'left' | 'right';
}

const STEPS: TourStep[] = [
  {
    id: 'intro',
    target: null,
    title: 'Welcome to SRE Sentinel',
    body:
      "This is the operator console for an autonomous incident-triage agent. Quick 5-step tour so you know where everything is — skip anytime.",
  },
  {
    id: 'simulate',
    target: 'simulate',
    title: 'Fire a simulated alert',
    body:
      "Each card models a real Dynatrace problem shape — bad deploys, load spikes, leaks. Click one to fire it at the agent and watch the reasoning timeline fill in.",
    preferredPlacement: 'bottom',
  },
  {
    id: 'status-pill',
    target: 'status-pill',
    title: 'Live link to the orchestrator',
    body:
      "A green dot means the dashboard is on a live Server-Sent Events connection. Every step the agent takes streams in here in real time.",
    preferredPlacement: 'left',
  },
  {
    id: 'timeline',
    target: 'timeline',
    title: 'Reasoning timeline',
    body:
      "Each tool the agent calls — and the evidence it found — lands here. No black box. Visible on the incident detail page.",
    preferredPlacement: 'right',
  },
  {
    id: 'approval',
    target: 'approval',
    title: 'You decide',
    body:
      "The agent's proposal comes with rationale and a blast-radius estimate. Edit args if you want, then Approve or Reject. Nothing executes without your one click.",
    preferredPlacement: 'left',
  },
  {
    id: 'outro',
    target: null,
    title: "You're set",
    body:
      "Fire a problem, watch the timeline, approve. Replay this tour anytime from the header icon. Happy triage.",
  },
];

const STORAGE_KEY = 'sentinel.tour.seen';
const TOOLTIP_WIDTH = 360;
const TOOLTIP_GAP = 18;
const VIEWPORT_MARGIN = 16;

interface TourContextValue {
  active: boolean;
  start: () => void;
  stop: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const seen = window.localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      const t = setTimeout(() => setActive(true), 700);
      return () => clearTimeout(t);
    }
  }, []);

  const start = useCallback(() => setActive(true), []);
  const stop = useCallback(() => {
    setActive(false);
    window.localStorage.setItem(STORAGE_KEY, '1');
  }, []);

  return <TourContext.Provider value={{ active, start, stop }}>{children}</TourContext.Provider>;
}

function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be inside <TourProvider>');
  return ctx;
}

// Header replay button.
export function TourButton() {
  const { start } = useTour();
  return (
    <button
      onClick={start}
      title="Take a guided tour"
      aria-label="Take a tour"
      className="icon-btn"
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

export function TourOverlay() {
  const { active, stop } = useTour();
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [tooltipSize, setTooltipSize] = useState<{ width: number; height: number }>({
    width: TOOLTIP_WIDTH,
    height: 220,
  });
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Reset to step 0 each time the tour is activated.
  useEffect(() => {
    if (active) setStepIndex(0);
  }, [active]);

  // Pick the next step whose target either is null (centered card) or
  // currently exists in the DOM.
  const visibleStep = active ? findNextVisibleStep(stepIndex) : null;

  // Re-measure the spotlight on every step / scroll / resize.
  useEffect(() => {
    if (!visibleStep) {
      setRect(null);
      return;
    }
    let lastMeasure = 0;
    const measure = () => {
      // Throttle to ~60fps; cheap getBoundingClientRect but the listener
      // fires on every scroll pixel without this.
      const now = performance.now();
      if (now - lastMeasure < 16) return;
      lastMeasure = now;

      if (!visibleStep.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector<HTMLElement>(`[data-tour="${visibleStep.target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      setRect(el.getBoundingClientRect());
    };

    // Scroll the target into view first; once that completes, measure.
    const el = visibleStep.target
      ? document.querySelector<HTMLElement>(`[data-tour="${visibleStep.target}"]`)
      : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      // Allow the smooth-scroll a moment to settle before initial measure.
      const settle = setTimeout(measure, 350);
      window.addEventListener('resize', measure);
      window.addEventListener('scroll', measure, { passive: true });
      return () => {
        clearTimeout(settle);
        window.removeEventListener('resize', measure);
        window.removeEventListener('scroll', measure);
      };
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [visibleStep]);

  // Measure the actual tooltip size so placement math is accurate.
  useEffect(() => {
    if (!tooltipRef.current) return;
    const update = () => {
      if (!tooltipRef.current) return;
      const { width, height } = tooltipRef.current.getBoundingClientRect();
      setTooltipSize({ width, height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(tooltipRef.current);
    return () => ro.disconnect();
  }, [visibleStep]);

  // Keyboard navigation: Esc to skip, Enter / ArrowRight for Next,
  // ArrowLeft for Back.
  useEffect(() => {
    if (!active) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stop();
      } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        advance();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, visibleStep]);

  if (!active || !visibleStep) return null;

  const totalSteps = STEPS.length;
  const currentNumber = STEPS.indexOf(visibleStep) + 1;
  const isLast = currentNumber === totalSteps;

  const advance = () => {
    if (isLast) {
      stop();
      return;
    }
    setStepIndex(currentNumber);
  };
  const goBack = () => {
    setStepIndex(Math.max(0, currentNumber - 2));
  };

  const tooltipPos = rect
    ? pickTooltipPosition(rect, visibleStep.preferredPlacement ?? 'bottom', tooltipSize)
    : centeredPosition(tooltipSize);

  return createPortal(
    <div className="fixed inset-0 z-50 animate-fade-in" aria-modal="true" role="dialog">
      {/* Cutout layer. When `rect` is present we render a transparent box
       *   sized to the target with a huge box-shadow forming the dim. When
       *   `rect` is null (intro/outro), we render a uniform dim. */}
      {rect ? (
        <div
          className="pointer-events-auto absolute rounded-lg"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            // The shadow is what makes the dim. Pick a tone that reads in both
            // themes — slightly bluish for warmth in light mode, darker in dark.
            boxShadow: '0 0 0 9999px var(--tour-dim, rgba(15, 23, 42, 0.55))',
            transition:
              'left 280ms cubic-bezier(0.16, 1, 0.3, 1), top 280ms cubic-bezier(0.16, 1, 0.3, 1), width 280ms cubic-bezier(0.16, 1, 0.3, 1), height 280ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onClick={(e) => {
            // Block clicks on the dim area so the user can't accidentally
            // close panels behind it while the tour is up.
            e.preventDefault();
          }}
        />
      ) : (
        <div className="pointer-events-auto absolute inset-0 bg-slate-900/55 dark:bg-black/70" />
      )}

      {/* Glow ring around the target. Sits above the cutout. */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-cyan-400 dark:ring-cyan-400"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow:
              '0 0 0 4px rgba(34, 211, 238, 0.25), 0 0 28px rgba(34, 211, 238, 0.45)',
            transition:
              'left 280ms cubic-bezier(0.16, 1, 0.3, 1), top 280ms cubic-bezier(0.16, 1, 0.3, 1), width 280ms cubic-bezier(0.16, 1, 0.3, 1), height 280ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      )}

      {/* Tooltip card. Solid surface for max readability against the dim. */}
      <div
        ref={tooltipRef}
        className="absolute w-[min(360px,calc(100vw-32px))] rounded-xl border bg-white p-5 shadow-2xl border-slate-200 ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10"
        style={{
          left: tooltipPos.left,
          top: tooltipPos.top,
          transition: 'left 280ms cubic-bezier(0.16, 1, 0.3, 1), top 280ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-400">
            Step {currentNumber} of {totalSteps}
          </span>
          <button
            onClick={stop}
            className="text-[11px] text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            Skip · Esc
          </button>
        </div>
        <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
          {visibleStep.title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {visibleStep.body}
        </p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            onClick={goBack}
            disabled={currentNumber === 1}
            className="rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-30 border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            ← Back
          </button>
          <div className="flex flex-1 items-center justify-center gap-1">
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentNumber - 1
                    ? 'w-5 bg-cyan-500 dark:bg-cyan-400'
                    : 'w-1.5 bg-slate-300 dark:bg-slate-700'
                }`}
              />
            ))}
          </div>
          <button
            onClick={advance}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500"
          >
            {isLast ? 'Done' : 'Next →'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function findNextVisibleStep(from: number): TourStep | null {
  for (let i = from; i < STEPS.length; i++) {
    const step = STEPS[i]!;
    if (!step.target) return step;
    if (document.querySelector(`[data-tour="${step.target}"]`)) return step;
  }
  return null;
}

interface PlacementSize {
  width: number;
  height: number;
}

// Pick the tooltip placement that actually fits. Try the preferred side first,
// then whichever direction has the most room, then clamp into the viewport
// with a margin. Returns final left/top in viewport coords.
function pickTooltipPosition(
  rect: DOMRect,
  preferred: 'top' | 'bottom' | 'left' | 'right',
  size: PlacementSize,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const roomAround = {
    top: rect.top - TOOLTIP_GAP,
    bottom: vh - rect.bottom - TOOLTIP_GAP,
    left: rect.left - TOOLTIP_GAP,
    right: vw - rect.right - TOOLTIP_GAP,
  };
  const sideFits = {
    top: roomAround.top >= size.height,
    bottom: roomAround.bottom >= size.height,
    left: roomAround.left >= size.width,
    right: roomAround.right >= size.width,
  };

  // Try preferred, then fall back to whichever side fits and has the
  // most remaining space.
  const order: Array<'top' | 'bottom' | 'left' | 'right'> = sideFits[preferred]
    ? [preferred]
    : (['bottom', 'top', 'right', 'left'] as const)
        .filter((s) => sideFits[s])
        .sort((a, b) => roomAround[b] - roomAround[a]);

  // If literally nothing fits, fall through to "center on screen"
  if (order.length === 0) return centeredPosition(size);

  const placement = order[0]!;
  let left = 0;
  let top = 0;
  switch (placement) {
    case 'bottom':
      left = rect.left + rect.width / 2 - size.width / 2;
      top = rect.bottom + TOOLTIP_GAP;
      break;
    case 'top':
      left = rect.left + rect.width / 2 - size.width / 2;
      top = rect.top - size.height - TOOLTIP_GAP;
      break;
    case 'left':
      left = rect.left - size.width - TOOLTIP_GAP;
      top = rect.top + rect.height / 2 - size.height / 2;
      break;
    case 'right':
      left = rect.right + TOOLTIP_GAP;
      top = rect.top + rect.height / 2 - size.height / 2;
      break;
  }

  // Final clamp into viewport.
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - size.width - VIEWPORT_MARGIN));
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - size.height - VIEWPORT_MARGIN));
  return { left, top };
}

function centeredPosition(size: PlacementSize): { left: number; top: number } {
  return {
    left: window.innerWidth / 2 - size.width / 2,
    top: window.innerHeight / 2 - size.height / 2,
  };
}
