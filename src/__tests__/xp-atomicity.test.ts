import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, initDb } from '../db/schema.js';

/**
 * awardXp used to do a read-modify-write:
 *
 *   SELECT xp FROM companions   -> newXp = xp + reward
 *   UPDATE companions SET xp = ?
 *
 * Two Claude Code sessions run two server processes against the same
 * ~/.buddy/buddy.db. Both read the same total, both write their own sum, and
 * one award is lost. The xp_events row is still inserted, so companions.xp
 * drifts permanently below sum(xp_events.xp_gained).
 *
 * awardXp itself lives in src/server/index.ts, which starts a stdio server on
 * import and so cannot be imported here. These tests pin the storage invariant
 * and contrast the two UPDATE strategies directly.
 */

const ID = 'xp-test-companion';
const REWARD = 5;

function seed() {
  db.prepare('DELETE FROM xp_events').run();
  db.prepare('DELETE FROM companions').run();
  db.prepare(
    `INSERT INTO companions (id, name, species, level, xp, mood, user_id)
     VALUES (?, 'Testy', 'Owl', 1, 0, 'happy', 'anon')`,
  ).run(ID);
}

const xp = () => (db.prepare('SELECT xp FROM companions WHERE id = ?').get(ID) as { xp: number }).xp;
const eventSum = () =>
  (db.prepare('SELECT COALESCE(sum(xp_gained), 0) AS s FROM xp_events WHERE companion_id = ?').get(ID) as { s: number }).s;

let seq = 0;
function insertEvent() {
  db.prepare('INSERT INTO xp_events (id, companion_id, event_type, xp_gained) VALUES (?, ?, ?, ?)')
    .run(`xp-evt-${seq++}`, ID, 'observe', REWARD);
}

/** The old strategy: read the total, then write an absolute value back. */
function awardReadModifyWrite() {
  insertEvent();
  const row = db.prepare('SELECT xp FROM companions WHERE id = ?').get(ID) as { xp: number };
  const newXp = row.xp + REWARD;
  db.prepare('UPDATE companions SET xp = ? WHERE id = ?').run(newXp, ID);
}

/** The fixed strategy: let SQLite do the addition. */
const awardSelfReferential = db.transaction(() => {
  insertEvent();
  db.prepare('UPDATE companions SET xp = xp + ? WHERE id = ?').run(REWARD, ID);
});

beforeEach(() => {
  initDb();
  seed();
});

afterAll(() => {
  db.prepare('DELETE FROM xp_events').run();
  db.prepare('DELETE FROM companions').run();
});

describe('XP award atomicity', () => {
  it('read-modify-write loses an award when two sessions interleave', () => {
    // Session A and session B both read 0 before either writes.
    insertEvent();
    const readA = (db.prepare('SELECT xp FROM companions WHERE id = ?').get(ID) as { xp: number }).xp;
    insertEvent();
    const readB = (db.prepare('SELECT xp FROM companions WHERE id = ?').get(ID) as { xp: number }).xp;

    db.prepare('UPDATE companions SET xp = ? WHERE id = ?').run(readA + REWARD, ID);
    db.prepare('UPDATE companions SET xp = ? WHERE id = ?').run(readB + REWARD, ID);

    expect(eventSum()).toBe(2 * REWARD);
    expect(xp()).toBe(REWARD);
    expect(xp()).toBeLessThan(eventSum()); // the drift this fix removes
  });

  it('self-referential update survives the same interleaving', () => {
    insertEvent();
    db.prepare('UPDATE companions SET xp = xp + ? WHERE id = ?').run(REWARD, ID);
    insertEvent();
    db.prepare('UPDATE companions SET xp = xp + ? WHERE id = ?').run(REWARD, ID);

    expect(xp()).toBe(eventSum());
  });

  it('keeps companions.xp equal to sum(xp_events) across many awards', () => {
    for (let i = 0; i < 50; i++) awardSelfReferential();
    expect(xp()).toBe(50 * REWARD);
    expect(xp()).toBe(eventSum());
  });

  it('drifts under the old strategy only when reads interleave, never under the new one', () => {
    for (let i = 0; i < 10; i++) awardReadModifyWrite();
    // Sequential calls are fine; the bug needs concurrency. Documented so the
    // absence of drift here is not mistaken for the bug being absent.
    expect(xp()).toBe(eventSum());

    seed();
    for (let i = 0; i < 10; i++) awardSelfReferential();
    expect(xp()).toBe(eventSum());
  });

  it('never lets xp go backwards', () => {
    let last = xp();
    for (let i = 0; i < 20; i++) {
      awardSelfReferential();
      const now = xp();
      expect(now).toBeGreaterThan(last);
      last = now;
    }
  });
});
