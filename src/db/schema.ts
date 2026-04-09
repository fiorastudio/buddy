import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../buddy.db');

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
      rarity TEXT DEFAULT 'common',
      is_shiny INTEGER DEFAULT 0,
      accessories TEXT DEFAULT '{}', -- JSON blob for items
      personality TEXT, -- JSON blob of stats
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      companion_id TEXT,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 1,
      tag TEXT, -- e.g., 'pattern', 'insight', 'raw'
      metadata TEXT, -- JSON blob for pattern data
      is_consolidated INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(companion_id) REFERENCES companions(id)
    );

    CREATE TABLE IF NOT EXISTS xp_events (
      id TEXT PRIMARY KEY,
      companion_id TEXT,
      event_type TEXT NOT NULL, -- 'load', 'bug_caught', 'suggestion_accepted', 'commit', 'active_session'
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
}
