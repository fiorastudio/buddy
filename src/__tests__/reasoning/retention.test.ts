import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import { writeClaims } from '../../lib/reasoning/writer.js';
import { pruneOldSessions, purge } from '../../lib/reasoning/retention.js';
import { deriveSessionId } from '../../lib/reasoning/session.js';
import { REASONING_CONFIG } from '../../lib/reasoning/config.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  // Seed a "comp" row because some tests insert findings_log entries
  // with companion_id='comp' (FK-cascade constraint).
  db.prepare(`INSERT INTO companions (id, name) VALUES ('comp', 't')`).run();
  return db;
}

function seedClaim(db: Database.Database, sessionId: string, text: string) {
  writeClaims(db, sessionId, [{
    text, basis: 'assumption', speaker: 'user', confidence: 'medium', external_id: 'c1',
  }], []);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('pruneOldSessions', () => {
  it('drops sessions older than retention window; keeps fresh ones', () => {
    const db = memDb();
    const now = Date.UTC(2026, 3, 22, 12, 0, 0);
    const retention = REASONING_CONFIG.SESSION_RETENTION_DAYS;

    const oldSid = deriveSessionId('/old-ws', now - (retention + 5) * MS_PER_DAY);
    const freshSid = deriveSessionId('/fresh-ws', now - 1 * MS_PER_DAY);
    seedClaim(db, oldSid, 'old claim');
    seedClaim(db, freshSid, 'fresh claim');

    const res = pruneOldSessions(db, now);
    expect(res.claims).toBe(1);

    const remaining = db.prepare('SELECT session_id FROM reasoning_claims').all() as Array<{ session_id: string }>;
    expect(remaining.length).toBe(1);
    expect(remaining[0].session_id).toBe(freshSid);
  });

  it('is idempotent — second call is a no-op when nothing to prune', () => {
    const db = memDb();
    const now = Date.UTC(2026, 3, 22);
    const sid = deriveSessionId('/ws', now - 1 * MS_PER_DAY);
    seedClaim(db, sid, 'fresh');
    const first = pruneOldSessions(db, now);
    const second = pruneOldSessions(db, now);
    expect(first.claims).toBe(0);
    expect(second.claims).toBe(0);
  });

  it('also drops edges and findings_log rows tied to pruned sessions', () => {
    const db = memDb();
    const now = Date.UTC(2026, 3, 22);
    const oldSid = deriveSessionId('/old', now - 45 * MS_PER_DAY);
    writeClaims(db, oldSid,
      [
        { text: 'a', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' },
        { text: 'b', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'c2' },
      ],
      [{ from: 'c2', to: 'c1', type: 'supports' }],
    );
    db.prepare(`
      INSERT INTO reasoning_findings_log (companion_id, session_id, finding_type, anchor_claim_id, observe_seq, created_at)
      VALUES ('comp', ?, 'load_bearing_vibes', 'x', 1, ?)
    `).run(oldSid, now - 45 * MS_PER_DAY);

    const res = pruneOldSessions(db, now);
    expect(res.claims).toBe(2);
    expect(res.edges).toBe(1);
    expect(res.findings).toBe(1);

    expect((db.prepare('SELECT count(*) as n FROM reasoning_edges').get() as any).n).toBe(0);
    expect((db.prepare('SELECT count(*) as n FROM reasoning_findings_log').get() as any).n).toBe(0);
  });
});

describe('purge', () => {
  it("scope='session' only drops that session", () => {
    const db = memDb();
    const a = deriveSessionId('/a', Date.UTC(2026, 3, 22));
    const b = deriveSessionId('/b', Date.UTC(2026, 3, 22));
    seedClaim(db, a, 'a');
    seedClaim(db, b, 'b');
    const res = purge(db, 'session', a);
    expect(res.claims).toBe(1);
    const remaining = db.prepare('SELECT session_id FROM reasoning_claims').all() as any[];
    expect(remaining.map(r => r.session_id)).toEqual([b]);
  });

  it("scope='all' drops everything", () => {
    const db = memDb();
    const a = deriveSessionId('/a', Date.UTC(2026, 3, 22));
    const b = deriveSessionId('/b', Date.UTC(2026, 3, 22));
    seedClaim(db, a, 'a');
    seedClaim(db, b, 'b');
    const res = purge(db, 'all');
    expect(res.claims).toBe(2);
    expect((db.prepare('SELECT count(*) as n FROM reasoning_claims').get() as any).n).toBe(0);
  });

  it("scope='session' without sessionId is a no-op", () => {
    const db = memDb();
    seedClaim(db, 'any-session', 'x');
    const res = purge(db, 'session');
    expect(res.claims).toBe(0);
  });

  it("scope='all' also clears the hook-driven extraction state and stats", () => {
    // Prevents the silent-misbehaviour bug where buddy_forget all leaves
    // the per-host-session cursor pointing at "already extracted N turns"
    // while the underlying graph is empty — next Stop hook would skip
    // those turns even though they need re-extraction.
    const db = memDb();
    const a = deriveSessionId('/a', Date.UTC(2026, 3, 22));
    seedClaim(db, a, 'a');
    db.prepare(`INSERT INTO reasoning_extraction_state (host_session_id, last_extracted_turn_count, updated_at) VALUES (?, ?, ?)`)
      .run('host-1', 42, Date.now());
    db.prepare(`INSERT INTO reasoning_extraction_stats (companion_id, attempts_total, succeeded_total) VALUES (?, ?, ?)`)
      .run('comp', 5, 4);

    purge(db, 'all');

    expect((db.prepare('SELECT count(*) as n FROM reasoning_extraction_state').get() as any).n).toBe(0);
    expect((db.prepare('SELECT count(*) as n FROM reasoning_extraction_stats').get() as any).n).toBe(0);
  });

  it("scope='session' does NOT clear cursor / stats — those are not session-scoped", () => {
    // The cursor is keyed by host (Claude Code) session, not buddy session.
    // Stats are per-companion. Neither maps to a buddy session id, so
    // a session-scoped purge shouldn't touch them. The user is asking to
    // forget a workspace's claims, not throw away their extraction history.
    const db = memDb();
    const a = deriveSessionId('/a', Date.UTC(2026, 3, 22));
    seedClaim(db, a, 'a');
    db.prepare(`INSERT INTO reasoning_extraction_state (host_session_id, last_extracted_turn_count, updated_at) VALUES (?, ?, ?)`)
      .run('host-1', 42, Date.now());
    db.prepare(`INSERT INTO reasoning_extraction_stats (companion_id, attempts_total) VALUES (?, ?)`)
      .run('comp', 3);

    purge(db, 'session', a);

    expect((db.prepare('SELECT count(*) as n FROM reasoning_extraction_state').get() as any).n).toBe(1);
    expect((db.prepare('SELECT count(*) as n FROM reasoning_extraction_stats').get() as any).n).toBe(1);
  });
});
