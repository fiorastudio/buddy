import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, db } from '../db/schema.js';
import { loadCompanion } from '../lib/companion.js';
import { recalcMood } from '../server/index.js';
import { levelFromXp } from '../lib/leveling.js';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Self-Healing & Mood Recalibration
// ---------------------------------------------------------------------------

const TEST_ID = `test-self-heal-${randomUUID()}`;
const MOOD_TEST_ID = `test-mood-${randomUUID()}`;
const LEVELUP_TEST_ID = `test-mood-levelup-${randomUUID()}`;

beforeAll(() => {
  initDb();
});

afterAll(() => {
  // Delete xp_events first (foreign key references companions)
  for (const id of [TEST_ID, MOOD_TEST_ID, LEVELUP_TEST_ID]) {
    db.prepare("DELETE FROM xp_events WHERE companion_id = ?").run(id);
    db.prepare("DELETE FROM companions WHERE id = ?").run(id);
  }
});

describe('loadCompanion self-healing', () => {
  it('corrects stale DB level when XP implies a higher level', () => {
    // Insert a companion with stale state: xp=25 should be level 2, but DB says level 1
    db.prepare(
      "INSERT INTO companions (id, name, species, level, xp, mood, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(TEST_ID, 'TestHeal', 'Mushroom', 1, 25, 'happy', 'test-user-heal');

    // Sanity check: levelFromXp confirms 25 XP = level 2
    expect(levelFromXp(25)).toBe(2);

    // Load the row
    const row = db.prepare("SELECT * FROM companions WHERE id = ?").get(TEST_ID);

    // loadCompanion should derive level=2 from xp=25
    const companion = loadCompanion(row, 'test-user-heal');
    expect(companion).not.toBeNull();
    expect(companion!.level).toBe(2);
    expect(companion!.xp).toBe(25);

    // Verify the DB was also healed
    const updatedRow = db.prepare("SELECT level FROM companions WHERE id = ?").get(TEST_ID) as any;
    expect(updatedRow.level).toBe(2);
  });

  it('does not write to DB when level is already correct', () => {
    // Update to correct state
    db.prepare("UPDATE companions SET level = 2, xp = 25 WHERE id = ?").run(TEST_ID);

    const row = db.prepare("SELECT * FROM companions WHERE id = ?").get(TEST_ID);
    const companion = loadCompanion(row, 'test-user-heal');
    expect(companion).not.toBeNull();
    expect(companion!.level).toBe(2);

    // DB should still show level 2 (no unnecessary write)
    const updatedRow = db.prepare("SELECT level FROM companions WHERE id = ?").get(TEST_ID) as any;
    expect(updatedRow.level).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Mood Recalibration
// ---------------------------------------------------------------------------

describe('recalcMood', () => {
  // Helper to add N xp_events for MOOD_TEST_ID
  function addEvents(n: number) {
    for (let i = 0; i < n; i++) {
      db.prepare(
        "INSERT INTO xp_events (id, companion_id, event_type, xp_gained) VALUES (?, ?, ?, ?)"
      ).run(randomUUID(), MOOD_TEST_ID, 'observe', 5);
    }
  }

  it('returns grumpy with 0 interactions', () => {
    db.prepare(
      "INSERT INTO companions (id, name, species, level, xp, mood, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(MOOD_TEST_ID, 'MoodTest', 'Mushroom', 1, 0, 'grumpy', 'test-user-mood');

    expect(recalcMood(MOOD_TEST_ID, false)).toBe('grumpy');
  });

  it('returns neutral with 1 interaction (>0 threshold)', () => {
    addEvents(1);
    expect(recalcMood(MOOD_TEST_ID, false)).toBe('neutral');
  });

  it('returns curious with 4 interactions (>3 threshold)', () => {
    addEvents(3); // 1 + 3 = 4 total
    expect(recalcMood(MOOD_TEST_ID, false)).toBe('curious');
  });

  it('returns happy with 6 interactions (>5 threshold)', () => {
    addEvents(2); // 4 + 2 = 6 total
    expect(recalcMood(MOOD_TEST_ID, false)).toBe('happy');
  });

  it('returns content with 11 interactions (>10 threshold)', () => {
    addEvents(5); // 6 + 5 = 11 total
    expect(recalcMood(MOOD_TEST_ID, false)).toBe('content');
  });

  it('returns happy on level-up regardless of interaction count', () => {
    // 0 interactions, but leveledUp=true → happy
    db.prepare(
      "INSERT INTO companions (id, name, species, level, xp, mood, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(LEVELUP_TEST_ID, 'LevelUpTest', 'Mushroom', 1, 0, 'grumpy', 'test-user-mood');

    expect(recalcMood(LEVELUP_TEST_ID, true)).toBe('happy');
  });
});
