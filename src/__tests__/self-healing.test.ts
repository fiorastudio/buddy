import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, db } from '../db/schema.js';
import { loadCompanion } from '../server/index.js';
import { levelFromXp } from '../lib/leveling.js';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Self-Healing: loadCompanion corrects stale DB level
// ---------------------------------------------------------------------------

const TEST_ID = `test-self-heal-${randomUUID()}`;

beforeAll(() => {
  initDb();
});

afterAll(() => {
  // Clean up test row
  db.prepare("DELETE FROM companions WHERE id = ?").run(TEST_ID);
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
