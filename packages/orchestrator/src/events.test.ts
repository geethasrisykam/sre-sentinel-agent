import { describe, expect, it, vi } from 'vitest';
import type { IncidentRecord } from '@sre-sentinel/shared';
import { IncidentEventBus, type IncidentEvent } from './events.js';

function makeIncident(id = 'inc-1'): IncidentRecord {
  return {
    id,
    receivedAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    state: 'TRIAGING',
    problemId: 'P-1',
    problemTitle: 'Test problem',
    affectedEntity: 'svc',
    severity: 'high',
    agentTurns: [],
  };
}

describe('IncidentEventBus', () => {
  it('delivers published events to a subscriber', () => {
    const bus = new IncidentEventBus();
    const events: IncidentEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const inc = makeIncident();
    bus.publish('created', inc);
    bus.publish('updated', inc);

    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe('created');
    expect(events[1]?.kind).toBe('updated');
    const first = events[0];
    if (first?.kind !== 'reset') {
      expect(first?.incident.id).toBe('inc-1');
      expect(first?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('publishes a reset event with no incident payload', () => {
    const bus = new IncidentEventBus();
    const events: IncidentEvent[] = [];
    bus.subscribe((e) => events.push(e));

    bus.publishReset();

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('reset');
    // Reset events deliberately have no incident attached.
    expect((events[0] as { incident?: unknown }).incident).toBeUndefined();
  });

  it('fans events out to every subscriber', () => {
    const bus = new IncidentEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);

    bus.publish('created', makeIncident());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes cleanly when the returned function is called', () => {
    const bus = new IncidentEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(handler);
    expect(bus.size()).toBe(1);

    unsubscribe();
    expect(bus.size()).toBe(0);

    bus.publish('created', makeIncident());
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps delivering when a single subscriber throws', () => {
    const bus = new IncidentEventBus();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    bus.subscribe(bad);
    bus.subscribe(good);

    expect(() => bus.publish('created', makeIncident())).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });
});
