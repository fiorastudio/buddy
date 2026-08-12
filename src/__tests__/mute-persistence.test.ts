import { existsSync, rmSync, writeFileSync } from 'fs';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, initDb } from '../db/schema.js';
import { calculateMood } from '../lib/species.js';
import { writeBuddyStatus } from '../lib/companion.js';
import { BUDDY_STATUS_PATH } from '../lib/constants.js';

/**
 * Regression tests for mute being stored in the `mood` column.
 *
 * calculateMood can only return happy/content/neutral/curious/grumpy, so every
 * mood recompute overwrote 'muted'. Because clients call buddy_status at the
 * start of every conversation, mute never survived a single session.
 */

const ID = 'mute-test-companion';

function seed(muted = 0) {
  db.prepare('DELETE FROM companions').run();
  db.prepare(
    `INSERT INTO companions (id, name, species, level, xp, mood, muted, user_id)
     VALUES (?, 'Testy', 'Owl', 1, 0, 'happy', ?, 'anon')`,
  ).run(ID, muted);
}

function muted(): number {
  const row = db.prepare('SELECT muted FROM companions WHERE id = ?').get(ID) as { muted: number };
  return row.muted;
}

beforeEach(() => {
  initDb();
  seed();
  rmSync(BUDDY_STATUS_PATH, { force: true });
});

afterAll(() => {
  db.prepare('DELETE FROM companions').run();
  rmSync(BUDDY_STATUS_PATH, { force: true });
});

describe('mute is not representable as a mood', () => {
  it('calculateMood never returns "muted" for any interaction count', () => {
    for (const n of [0, 1, 4, 6, 11, 500]) {
      expect(calculateMood(new Array(n), 0)).not.toBe('muted');
    }
  });
});

describe('mute persistence', () => {
  it('stores mute in its own column, not in mood', () => {
    db.prepare('UPDATE companions SET muted = 1 WHERE id = ?').run(ID);
    expect(muted()).toBe(1);

    // A mood recompute — what buddy_status does on every conversation start.
    const recomputed = calculateMood([], 0);
    db.prepare('UPDATE companions SET mood = ? WHERE id = ?').run(recomputed, ID);

    expect(muted()).toBe(1);
  });

  it('migration backfills anyone muted under the old scheme', () => {
    db.prepare("UPDATE companions SET mood = 'muted', muted = 0 WHERE id = ?").run(ID);
    db.exec("UPDATE companions SET muted = 1 WHERE mood = 'muted'");
    expect(muted()).toBe(1);
  });

  it('a muted companion defaults to muted = 0, not null', () => {
    const row = db.prepare('SELECT muted FROM companions WHERE id = ?').get(ID) as { muted: number };
    expect(row.muted).toBe(0);
  });
});

describe('writeBuddyStatus respects the mute flag', () => {
  const companion = {
    name: 'Testy',
    species: 'Owl',
    level: 1,
    xp: 0,
    mood: 'happy',
    rarity: 'common',
    shiny: false,
    eye: '.',
    hat: '',
    stats: { DEBUGGING: 1, PATIENCE: 1, CHAOS: 1, WISDOM: 1, SNARK: 1 },
    personalityBio: '',
    hatchedAt: Date.now(),
  } as any;

  it('writes the statusline file when not muted', () => {
    writeBuddyStatus(companion);
    expect(existsSync(BUDDY_STATUS_PATH)).toBe(true);
  });

  it('does not write the statusline file while muted', () => {
    db.prepare('UPDATE companions SET muted = 1 WHERE id = ?').run(ID);
    writeBuddyStatus(companion);
    expect(existsSync(BUDDY_STATUS_PATH)).toBe(false);
  });

  it('does not resurrect a status file deleted by buddy_mute', () => {
    db.prepare('UPDATE companions SET muted = 1 WHERE id = ?').run(ID);
    writeFileSync(BUDDY_STATUS_PATH, '{}');
    rmSync(BUDDY_STATUS_PATH, { force: true });

    // Several observes in a row, as a working session would produce.
    writeBuddyStatus(companion);
    writeBuddyStatus(companion, {
      state: 'excited', text: 'nice', expires: Date.now() + 1000,
    });
    expect(existsSync(BUDDY_STATUS_PATH)).toBe(false);
  });

  it('writes again once unmuted', () => {
    db.prepare('UPDATE companions SET muted = 1 WHERE id = ?').run(ID);
    writeBuddyStatus(companion);
    expect(existsSync(BUDDY_STATUS_PATH)).toBe(false);

    db.prepare('UPDATE companions SET muted = 0 WHERE id = ?').run(ID);
    writeBuddyStatus(companion);
    expect(existsSync(BUDDY_STATUS_PATH)).toBe(true);
  });
});
