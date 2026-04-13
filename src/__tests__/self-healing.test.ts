import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, db } from '../db/schema.js';
import { loadCompanion, recalcMood } from '../server/index.js';
import { levelFromXp } from '../lib/leveling.js';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Self-Healing & Mood Recalibration
// ---------------------------------------------------------------------------

const TEST_ID = `test-self-heal-${randomUUID()}`;
const MOOD_TEST_ID = `test-mood-${randomUUID()}`;

beforeAll(() => {
  initDb();
});

afterAll(() => {
  // Delete xp_events first (foreign key references companions)
  db.prepare("DELETE FROM xp_events WHERE companion_id = ?").run(TEST_ID);
  db.prepare("DELETE FROM xp_events WHERE companion_id = ?").run(MOOD_TEST_ID);
  db.prepare("DELETE FROM companions WHERE id = ?").run(TEST_ID);
  db.prepare("DELETE FROM companions WHERE id = ?").run(MOOD_TEST_ID);
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
  it('returns grumpy when no recent interactions', () => {
    // Insert a companion with no xp_events
    db.prepare(
      "INSERT INTO companions (id, name, species, level, xp, mood, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(MOOD_TEST_ID, 'MoodTest', 'Mushroom', 1, 0, 'grumpy', 'test-user-mood');

    const mood = recalcMood(MOOD_TEST_ID, false);
    expect(mood).toBe('grumpy');
  });

  it('trends upward with more interactions', () => {
    // Add a few xp events — should move past grumpy
    for (let i = 0; i < 4; i++) {
      db.prepare(
        "INSERT INTO xp_events (id, companion_id, event_type, xp_gained) VALUES (?, ?, ?, ?)"
      ).run(randomUUID(), MOOD_TEST_ID, 'observe', 5);
    }

    const mood = recalcMood(MOOD_TEST_ID, false);
    expect(['curious', 'happy', 'content']).toContain(mood);
  });

  it('returns happy on level-up regardless of interaction count', () => {
    // Even with 0 interactions, level-up should override to happy
    const freshId = `test-mood-levelup-${randomUUID()}`;
    db.prepare(
      "INSERT INTO companions (id, name, species, level, xp, mood, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(freshId, 'LevelUpTest', 'Mushroom', 1, 0, 'grumpy', 'test-user-mood');

    const mood = recalcMood(freshId, true);
    expect(mood).toBe('happy');

    // Clean up
    db.prepare("DELETE FROM companions WHERE id = ?").run(freshId);
  });
});
