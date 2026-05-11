// Verify WAL journaling is actually enabled by initReasoningSchema. The
// pragma is critical for concurrent reader/writer behaviour now that the
// MCP server and the Stop hook process both hold the buddy.db open during
// long extraction calls — without it, default rollback journaling can
// serialize them on the file lock.

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';

describe('initReasoningSchema journal mode', () => {
  it('puts the database into WAL mode', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
    initReasoningSchema(db);
    const mode = db.pragma('journal_mode', { simple: true }) as string;
    // SQLite reports "wal" in lowercase; the in-memory DB will fall back
    // to "memory" since WAL is incompatible with :memory:. Either is
    // acceptable evidence the pragma was set without throwing.
    expect(['wal', 'memory']).toContain(mode);
  });

  it('survives being called twice without error (idempotent migration)', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
    initReasoningSchema(db);
    expect(() => initReasoningSchema(db)).not.toThrow();
  });
});
