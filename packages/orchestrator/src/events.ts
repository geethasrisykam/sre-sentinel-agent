import type { IncidentRecord } from '@sre-sentinel/shared';
import { log } from './logger.js';

export type IncidentEventKind = 'created' | 'updated';

export interface IncidentEvent {
  kind: IncidentEventKind;
  incident: IncidentRecord;
  at: string;
}

export type IncidentEventHandler = (event: IncidentEvent) => void;

export class IncidentEventBus {
  private readonly handlers = new Set<IncidentEventHandler>();

  subscribe(handler: IncidentEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(kind: IncidentEventKind, incident: IncidentRecord): void {
    const event: IncidentEvent = {
      kind,
      incident,
      at: new Date().toISOString(),
    };
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        // A bad subscriber must not break sibling subscribers or the writer,
        // but it must not vanish without a trace either.
        log.warn('events.subscriber.threw', {
          kind: event.kind,
          incidentId: event.incident.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  size(): number {
    return this.handlers.size;
  }
}
