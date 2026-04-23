import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import { runMaxModePipeline } from '../../lib/reasoning/pipeline.js';
import { resetGraphCache, telemetry } from '../../lib/reasoning/index.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name) VALUES ('c1', 't')`).run();
  return db;
}

describe('pipeline cwd override — workspace isolation', () => {
  beforeEach(() => { resetGraphCache(); telemetry.reset(); });
  it('different cwds land claims in different session_ids, even on the same day', () => {
    const db = memDb();
    const today = Date.UTC(2026, 3, 22, 10, 0, 0);
    const a = runMaxModePipeline(db, {
      companionId: 'c1', cwd: '/project-a', claims: [], edges: [],
    }, { now: () => today });
    const b = runMaxModePipeline(db, {
      companionId: 'c1', cwd: '/project-b', claims: [], edges: [],
    }, { now: () => today });
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('claims from project A are not visible in project B`s graph', () => {
    const db = memDb();
    const today = Date.UTC(2026, 3, 22);
    const payload = {
      claims: [
        { text: 'project-scoped claim', basis: 'vibes', speaker: 'user', confidence: 'medium', external_id: 'c' },
      ],
      edges: [],
    };
    const a = runMaxModePipeline(db, {
      companionId: 'c1', cwd: '/project-a', ...payload,
    }, { now: () => today });
    const b = runMaxModePipeline(db, {
      companionId: 'c1', cwd: '/project-b', claims: [], edges: [],
    }, { now: () => today });

    const aRows = db.prepare('SELECT count(*) as n FROM reasoning_claims WHERE session_id = ?').get(a.sessionId) as any;
    const bRows = db.prepare('SELECT count(*) as n FROM reasoning_claims WHERE session_id = ?').get(b.sessionId) as any;
    expect(aRows.n).toBe(1);
    expect(bRows.n).toBe(0);
  });

  it('same cwd + same day = same session_id, regardless of time-of-day', () => {
    const db = memDb();
    const morning = Date.UTC(2026, 3, 22, 6, 0, 0);
    const evening = Date.UTC(2026, 3, 22, 20, 0, 0);
    const a = runMaxModePipeline(db, { companionId: 'c1', cwd: '/p', claims: [], edges: [] }, { now: () => morning });
    const b = runMaxModePipeline(db, { companionId: 'c1', cwd: '/p', claims: [], edges: [] }, { now: () => evening });
    expect(a.sessionId).toBe(b.sessionId);
  });
});
