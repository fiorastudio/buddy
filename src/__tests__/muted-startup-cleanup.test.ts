import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

/**
 * X12: an upgraded user who muted on an older version can still have a stale
 * buddy-status.json. On server startup a muted buddy must have that file
 * removed. Uses a temp CLAUDE_CONFIG_DIR only — never the real ~/.claude.
 */

const ID = 'muted-startup-companion';
const configDir = mkdtempSync(join(tmpdir(), 'buddy-x12-'));
const prevConfigDir = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = configDir;

let db: any;
let initDb: () => void;
let sync: () => void;
let STATUS: string;

beforeAll(async () => {
  // Dynamic imports so constants.ts reads the temp CLAUDE_CONFIG_DIR above.
  ({ db, initDb } = await import('../db/schema.js'));
  ({ syncStatusFileOnStartup: sync } = await import('../lib/companion.js'));
  ({ BUDDY_STATUS_PATH: STATUS } = await import('../lib/constants.js'));
  expect(STATUS.startsWith(configDir)).toBe(true);
});

function seed(muted: number) {
  db.prepare('DELETE FROM companions').run();
  db.prepare(
    `INSERT INTO companions (id, name, species, level, xp, mood, muted, user_id)
     VALUES (?, 'Testy', 'Owl', 1, 0, 'happy', ?, 'anon')`,
  ).run(ID, muted);
}

beforeEach(() => {
  initDb();
  mkdirSync(configDir, { recursive: true });
  rmSync(STATUS, { force: true });
});

afterAll(() => {
  db?.prepare('DELETE FROM companions').run();
  rmSync(configDir, { recursive: true, force: true });
  if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prevConfigDir;
});

describe('syncStatusFileOnStartup', () => {
  it('removes a stale status file when the buddy is muted', () => {
    seed(1);
    writeFileSync(STATUS, '{"name":"stale"}');
    sync();
    expect(existsSync(STATUS)).toBe(false);
  });

  it('is a no-op when muted and no file exists', () => {
    seed(1);
    expect(() => sync()).not.toThrow();
    expect(existsSync(STATUS)).toBe(false);
  });

  it('writes the status file when the buddy is not muted', () => {
    seed(0);
    sync();
    expect(existsSync(STATUS)).toBe(true);
  });

  it('does nothing when there is no companion', () => {
    db.prepare('DELETE FROM companions').run();
    writeFileSync(STATUS, '{"name":"keep"}');
    sync();
    expect(existsSync(STATUS)).toBe(true);
  });
});
