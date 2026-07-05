// src/lib/world/schema-sql.ts
// Single source of truth for the Buddy World schema. Used by the local
// SqliteWorldStore (tests, dev) and the D1 migration (deploy) — D1 is
// SQLite, so these statements run unchanged in both.

export const WORLD_EVENT_TYPES = [
  'observe',
  'session',
  'commit',
  'tests_passed',
  'bug_fix',
  'deploy',
  'level_up',
  'streak_7',
] as const;

export type WorldEventType = (typeof WORLD_EVENT_TYPES)[number];

// Celebration-class events skip the client's sync debounce so plaza VFX
// land within one poll of the real moment. Lives with the type definitions:
// adding a new celebration event means touching this file, not the client.
export const INSTANT_WORLD_EVENTS: ReadonlySet<WorldEventType> = new Set(['deploy', 'level_up', 'streak_7']);

export const WORLD_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS citizens (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  species TEXT NOT NULL,
  level INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  mood TEXT NOT NULL,
  stats TEXT NOT NULL,
  rarity TEXT NOT NULL,
  shiny INTEGER NOT NULL DEFAULT 0,
  hat TEXT NOT NULL DEFAULT 'none',
  eye TEXT NOT NULL DEFAULT '·',
  anon INTEGER NOT NULL DEFAULT 0,
  skin TEXT NOT NULL DEFAULT 'ascii',
  avatar TEXT,
  district TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  xp_bucket REAL NOT NULL DEFAULT 300,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_citizens_district ON citizens(district) WHERE hidden = 0;

CREATE TABLE IF NOT EXISTS world_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citizen_id TEXT NOT NULL,
  type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  FOREIGN KEY (citizen_id) REFERENCES citizens(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_citizen_ts ON world_events(citizen_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_ts ON world_events(ts);

CREATE TABLE IF NOT EXISTS daily_rollups (
  date TEXT NOT NULL,
  citizen_id TEXT NOT NULL,
  event_counts TEXT NOT NULL,
  xp_gained INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, citizen_id)
);
`;
