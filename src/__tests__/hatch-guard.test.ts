import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { initDb, db, repairDuplicateCompanions } from '../db/schema.js';
import {
  companionExists,
  createCompanion,
  rescueCompanion,
  loadCompanion,
} from '../lib/companion.js';

// Fresh, isolated DB state before each test. Child tables are cleared before
// companions because foreign_keys is ON (initReasoningSchema enables it).
beforeEach(() => {
  initDb();
  db.prepare('DELETE FROM xp_events').run();
  db.prepare('DELETE FROM memories').run();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM evolution_history').run();
  db.prepare('DELETE FROM companions').run();
});

function countCompanions(): number {
  return (db.prepare('SELECT count(*) AS n FROM companions').get() as any).n;
}

function addXpEvent(companionId: string): void {
  db.prepare(
    "INSERT INTO xp_events (id, companion_id, event_type, xp_gained) VALUES (?, ?, 'observe', 5)"
  ).run(randomUUID(), companionId);
}

describe('repairDuplicateCompanions', () => {
  it('is a no-op with zero companions', () => {
    expect(repairDuplicateCompanions()).toBe(0);
    expect(companionExists()).toBeNull();
  });

  it('is a no-op with a single companion', () => {
    const { id } = createCompanion({ userId: 'solo', name: 'Solo' });
    expect(repairDuplicateCompanions()).toBe(0);
    expect(countCompanions()).toBe(1);
    expect((companionExists() as any).id).toBe(id);
  });

  it('collapses several rows down to the highest-XP companion', () => {
    const { id: a } = createCompanion({ userId: 'a', name: 'Ayy' });
    const { id: b } = createCompanion({ userId: 'b', name: 'Bee' });
    const { id: c } = createCompanion({ userId: 'c', name: 'Cee' });
    db.prepare('UPDATE companions SET xp = ? WHERE id = ?').run(10, a);
    db.prepare('UPDATE companions SET xp = ? WHERE id = ?').run(500, b); // most progressed
    db.prepare('UPDATE companions SET xp = ? WHERE id = ?').run(0, c);

    expect(repairDuplicateCompanions()).toBe(2);
    expect(countCompanions()).toBe(1);
    expect((db.prepare('SELECT id FROM companions').get() as any).id).toBe(b);
  });

  it('deletes orphaned child rows of removed companions but keeps the survivor\'s', () => {
    const { id: keep } = createCompanion({ userId: 'keep', name: 'Keeper' });
    const { id: drop } = createCompanion({ userId: 'drop', name: 'Dropped' });
    db.prepare('UPDATE companions SET xp = ? WHERE id = ?').run(100, keep);

    addXpEvent(keep);
    addXpEvent(drop);
    addXpEvent(drop);

    repairDuplicateCompanions();

    expect((db.prepare('SELECT count(*) AS n FROM xp_events WHERE companion_id = ?').get(drop) as any).n).toBe(0);
    expect((db.prepare('SELECT count(*) AS n FROM xp_events WHERE companion_id = ?').get(keep) as any).n).toBe(1);
  });

  it('breaks XP ties toward the earliest-inserted row', () => {
    const { id: first } = createCompanion({ userId: 'first', name: 'First' });
    createCompanion({ userId: 'second', name: 'Second' }); // both default xp = 0

    repairDuplicateCompanions();

    expect(countCompanions()).toBe(1);
    expect((db.prepare('SELECT id FROM companions').get() as any).id).toBe(first);
  });

  it('runs automatically as part of initDb()', () => {
    createCompanion({ userId: 'x1', name: 'One' });
    createCompanion({ userId: 'x2', name: 'Two' });
    expect(countCompanions()).toBe(2);

    initDb(); // migration pass repairs duplicates

    expect(countCompanions()).toBe(1);
  });
});

describe('rescue-then-hatch guard', () => {
  it('a rescued buddy makes companionExists() truthy, so buddy_hatch refuses', () => {
    const { id } = rescueCompanion({ name: 'Fernsquire', species: 'Shell Turtle' });

    // The buddy_hatch handler returns early whenever companionExists() is truthy,
    // so the rescued buddy is never overwritten by a follow-up hatch.
    const existing = companionExists();
    expect(existing).not.toBeNull();
    expect((existing as any).id).toBe(id);
    expect(loadCompanion(existing)!.name).toBe('Fernsquire');
  });

  it('leaves the rescued buddy intact (row + data still present)', () => {
    rescueCompanion({ name: 'Fernsquire', species: 'Shell Turtle', personality: 'a wise, unflappable turtle' });

    const row = db.prepare('SELECT * FROM companions LIMIT 1').get() as any;
    expect(countCompanions()).toBe(1);
    expect(row.name).toBe('Fernsquire');
    expect(row.species).toBe('Shell Turtle');
    expect(row.personality_bio).toBe('a wise, unflappable turtle');
  });
});
