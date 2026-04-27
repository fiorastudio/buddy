import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { initReasoningSchema } from '../lib/reasoning/schema.js';

// BUDDY_DB_PATH env var allows tests to use an isolated DB
// instead of the production ~/.buddy/buddy.db
const dbPath = process.env.BUDDY_DB_PATH || path.join(homedir(), '.buddy', 'buddy.db');
mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      species TEXT NOT NULL,
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      mood TEXT DEFAULT 'happy',
      personality_bio TEXT DEFAULT '',
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      companion_id TEXT,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 1,
      tag TEXT,
      metadata TEXT,
      is_consolidated INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(companion_id) REFERENCES companions(id)
    );

    CREATE TABLE IF NOT EXISTS xp_events (
      id TEXT PRIMARY KEY,
      companion_id TEXT,
      event_type TEXT NOT NULL,
      xp_gained INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(companion_id) REFERENCES companions(id)
    );

    CREATE TABLE IF NOT EXISTS evolution_history (
      id TEXT PRIMARY KEY,
      companion_id TEXT,
      from_level INTEGER NOT NULL,
      to_level INTEGER NOT NULL,
      from_species TEXT NOT NULL,
      to_species TEXT NOT NULL,
      is_shiny INTEGER DEFAULT 0,
      is_mutation INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(companion_id) REFERENCES companions(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      companion_id TEXT,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      context_summary TEXT,
      FOREIGN KEY(companion_id) REFERENCES companions(id)
    );
  `);

  // Migration: add observer_mode column (safe for existing DBs)
  try {
    db.exec(`ALTER TABLE companions ADD COLUMN observer_mode TEXT DEFAULT 'both'`);
  } catch { /* column already exists */ }

  // Migration: add cc_rescue flag for CC-imported buddies (uses Bun wyhash for stats)
  try {
    db.exec(`ALTER TABLE companions ADD COLUMN cc_rescue INTEGER DEFAULT 0`);
  } catch { /* column already exists */ }

  // Reasoning-layer migration (claims/edges tables + insight_mode column).
  initReasoningSchema(db);
}
