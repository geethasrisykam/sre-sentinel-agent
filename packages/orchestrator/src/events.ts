import type { IncidentRecord } from '@sre-sentinel/shared';
import { log } from './logger.js';

export type IncidentEvent =
  | { kind: 'created' | 'updated'; incident: IncidentRecord; at: string }
  | { kind: 'reset'; at: string };

export type IncidentEventHandler = (event: IncidentEvent) => void;

export class IncidentEventBus {
  private readonly handlers = new Set<IncidentEventHandler>();

  subscribe(handler: IncidentEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(kind: 'created' | 'updated', incident: IncidentRecord): void {
    this.dispatch({ kind, incident, at: new Date().toISOString() });
  }

  // Broadcast that the incident store has been wiped (operator hit the demo
  // reset). Dashboards drop their cached state and re-snapshot from empty.
  publishReset(): void {
    this.dispatch({ kind: 'reset', at: new Date().toISOString() });
  }

  private dispatch(event: IncidentEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        // A bad subscriber must not break sibling subscribers or the writer,
        // but it must not vanish without a trace either.
        log.warn('events.subscriber.threw', {
          kind: event.kind,
          incidentId: event.kind === 'reset' ? undefined : event.incident.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  size(): number {
    return this.handlers.size;
  }
}
