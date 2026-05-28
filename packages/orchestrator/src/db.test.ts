import { describe, expect, it, beforeEach } from 'vitest';
import type { IncidentRecord } from '@sre-sentinel/shared';
import { IncidentRepository } from './db.js';
import type { IncidentEvent } from './events.js';

function makeIncident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  const now = new Date('2026-05-27T00:00:00.000Z').toISOString();
  return {
    id: 'inc-1',
    receivedAt: now,
    updatedAt: now,
    state: 'TRIAGING',
    problemId: 'P-1',
    problemTitle: 'Test problem',
    affectedEntity: 'svc',
    severity: 'high',
    agentTurns: [],
    ...overrides,
  };
}

describe('IncidentRepository', () => {
  let repo: IncidentRepository;
  let captured: IncidentEvent[];

  beforeEach(() => {
    repo = new IncidentRepository(':memory:');
    captured = [];
    repo.events.subscribe((e) => captured.push(e));
  });

  it('inserts a record and publishes a created event', () => {
    const inc = makeIncident();
    repo.insert(inc);
    expect(repo.findById('inc-1')).toEqual(inc);
    expect(captured).toHaveLength(1);
    const first = captured[0];
    expect(first?.kind).toBe('created');
    if (first?.kind !== 'reset') {
      expect(first?.incident.id).toBe('inc-1');
    }
  });

  it('updates an existing record and publishes an updated event', () => {
    repo.insert(makeIncident());
    const updated = makeIncident({ state: 'AWAITING_APPROVAL', updatedAt: '2026-05-27T00:00:05.000Z' });
    repo.update(updated);

    expect(repo.findById('inc-1')?.state).toBe('AWAITING_APPROVAL');
    expect(captured.map((e) => e.kind)).toEqual(['created', 'updated']);
  });

  it('throws when updating a missing record', () => {
    expect(() => repo.update(makeIncident({ id: 'never-existed' }))).toThrow(/No incident with id=never-existed/);
  });

  it('returns null for findById on a missing record', () => {
    expect(repo.findById('not-here')).toBeNull();
  });

  it('orders listRecent by receivedAt descending', () => {
    repo.insert(makeIncident({ id: 'a', receivedAt: '2026-05-27T01:00:00.000Z' }));
    repo.insert(makeIncident({ id: 'b', receivedAt: '2026-05-27T03:00:00.000Z' }));
    repo.insert(makeIncident({ id: 'c', receivedAt: '2026-05-27T02:00:00.000Z' }));

    const ids = repo.listRecent(10).map((r) => r.id);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('limits listRecent to the requested count', () => {
    for (let i = 0; i < 5; i++) {
      repo.insert(makeIncident({ id: `i-${i}`, receivedAt: `2026-05-27T00:0${i}:00.000Z` }));
    }
    expect(repo.listRecent(2)).toHaveLength(2);
  });

  it('counts records by state', () => {
    repo.insert(makeIncident({ id: 'a', state: 'TRIAGING' }));
    repo.insert(makeIncident({ id: 'b', state: 'TRIAGING' }));
    repo.insert(makeIncident({ id: 'c', state: 'RESOLVED' }));

    expect(repo.countByState('TRIAGING')).toBe(2);
    expect(repo.countByState('RESOLVED')).toBe(1);
    expect(repo.countByState('FAILED')).toBe(0);
  });

  it('clearAll deletes every row and publishes a reset event', () => {
    repo.insert(makeIncident({ id: 'a' }));
    repo.insert(makeIncident({ id: 'b' }));
    // Drop the two 'created' events recorded by beforeEach's subscriber so the
    // assertion below sees only what clearAll publishes.
    captured.length = 0;

    const deleted = repo.clearAll();
    expect(deleted).toBe(2);
    expect(repo.listRecent(10)).toEqual([]);
    expect(captured.map((e) => e.kind)).toEqual(['reset']);
  });
});
