import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import {
  getCursor, bumpCursor,
  getStats, recordAttempt, recordSuccess, recordFailure, recordFindingsDelivered,
  shouldBackoff, BACKOFF,
  deriveHostKey,
  preciseModeActiveForObserve,
} from '../../lib/reasoning/extraction-state.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name) VALUES (?, ?)`).run('c1', 'Datao');
  return db;
}

describe('extraction cursor', () => {
  let db: Database.Database;
  beforeEach(() => { db = memDb(); });

  it('returns 0 for an unknown host session', () => {
    expect(getCursor(db, 'unknown').lastExtractedTurnCount).toBe(0);
  });

  it('persists and reads back', () => {
    bumpCursor(db, 's1', 12);
    expect(getCursor(db, 's1').lastExtractedTurnCount).toBe(12);
  });

  it('updates the same row on repeated bump', () => {
    bumpCursor(db, 's1', 5);
    bumpCursor(db, 's1', 10);
    bumpCursor(db, 's1', 17);
    expect(getCursor(db, 's1').lastExtractedTurnCount).toBe(17);
    const rows = db.prepare(`SELECT count(*) as n FROM reasoning_extraction_state WHERE host_session_id = 's1'`).get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('keys per host session — different sessions tracked independently', () => {
    bumpCursor(db, 's1', 5);
    bumpCursor(db, 's2', 9);
    expect(getCursor(db, 's1').lastExtractedTurnCount).toBe(5);
    expect(getCursor(db, 's2').lastExtractedTurnCount).toBe(9);
  });
});

describe('extraction stats', () => {
  let db: Database.Database;
  beforeEach(() => { db = memDb(); });

  it('returns zeroes for a fresh companion', () => {
    const s = getStats(db, 'c1');
    expect(s.attemptsTotal).toBe(0);
    expect(s.succeededTotal).toBe(0);
    expect(s.failedTotal).toBe(0);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.failureReasons).toEqual({});
  });

  it('records attempt + success', () => {
    recordAttempt(db, 'c1');
    recordSuccess(db, 'c1');
    const s = getStats(db, 'c1');
    expect(s.attemptsTotal).toBe(1);
    expect(s.succeededTotal).toBe(1);
    expect(s.lastSuccessAt).not.toBeNull();
    expect(s.lastAttemptAt).not.toBeNull();
  });

  it('records failure with bucketed reason', () => {
    recordAttempt(db, 'c1');
    recordFailure(db, 'c1', 'http_401', 'http 401: invalid x-api-key');
    const s = getStats(db, 'c1');
    expect(s.failedTotal).toBe(1);
    expect(s.consecutiveFailures).toBe(1);
    expect(s.failureReasons.http_401).toBe(1);
    expect(s.lastFailureReason).toMatch(/401/);
  });

  it('resets consecutive_failures on success', () => {
    recordAttempt(db, 'c1');
    recordFailure(db, 'c1', 'timeout', 'timeout');
    recordAttempt(db, 'c1');
    recordFailure(db, 'c1', 'timeout', 'timeout');
    expect(getStats(db, 'c1').consecutiveFailures).toBe(2);

    recordAttempt(db, 'c1');
    recordSuccess(db, 'c1');
    expect(getStats(db, 'c1').consecutiveFailures).toBe(0);
  });

  it('clears last_failure_reason on success so stale failure text does not outlive recovery', () => {
    recordAttempt(db, 'c1');
    recordFailure(db, 'c1', 'http_401', 'http 401: invalid x-api-key');
    expect(getStats(db, 'c1').lastFailureReason).toMatch(/401/);

    recordAttempt(db, 'c1');
    recordSuccess(db, 'c1');
    expect(getStats(db, 'c1').lastFailureReason).toBeNull();
    // Histogram of past failure buckets is preserved — only the current
    // "most recent failure" string clears.
    expect(getStats(db, 'c1').failureReasons.http_401).toBe(1);
  });

  it('accumulates failure-reason buckets across calls', () => {
    recordAttempt(db, 'c1'); recordFailure(db, 'c1', 'http_401', 'http 401');
    recordAttempt(db, 'c1'); recordFailure(db, 'c1', 'http_401', 'http 401');
    recordAttempt(db, 'c1'); recordFailure(db, 'c1', 'timeout', 'timeout');
    const s = getStats(db, 'c1');
    expect(s.failureReasons.http_401).toBe(2);
    expect(s.failureReasons.timeout).toBe(1);
    expect(s.failedTotal).toBe(3);
  });

  it('isolates by companion_id', () => {
    db.prepare(`INSERT INTO companions (id, name) VALUES (?, ?)`).run('c2', 'Other');
    recordAttempt(db, 'c1'); recordSuccess(db, 'c1');
    recordAttempt(db, 'c2'); recordFailure(db, 'c2', 'timeout', 'timeout');
    expect(getStats(db, 'c1').succeededTotal).toBe(1);
    expect(getStats(db, 'c1').failedTotal).toBe(0);
    expect(getStats(db, 'c2').failedTotal).toBe(1);
  });

  it('records findings delivered cumulatively', () => {
    recordFindingsDelivered(db, 'c1', 2);
    recordFindingsDelivered(db, 'c1', 3);
    expect(getStats(db, 'c1').findingsDeliveredTotal).toBe(5);
  });

  it('survives malformed failure_reasons_json', () => {
    db.prepare(`INSERT INTO reasoning_extraction_stats (companion_id, failure_reasons_json) VALUES (?, ?)`)
      .run('c1', '{ invalid json');
    const s = getStats(db, 'c1');
    expect(s.failureReasons).toEqual({});
  });

  it('recordFailure self-heals from corrupt failure_reasons_json via json_valid fallback', () => {
    // Plant a row with a malformed JSON blob — possible if the file was
    // edited by hand or hit some bizarre I/O failure. The atomic-SQL
    // recordFailure path uses json_valid() to detect and fall back to '{}'
    // before json_set/json_extract, so the next failure write should land
    // a clean { http_401: 1 } map and clear the corruption.
    db.prepare(`INSERT INTO reasoning_extraction_stats (companion_id, failure_reasons_json) VALUES (?, ?)`)
      .run('c1', '{this is not json');
    recordFailure(db, 'c1', 'http_401', 'http 401: nope');
    const s = getStats(db, 'c1');
    expect(s.failureReasons.http_401).toBe(1);
    expect(s.failedTotal).toBe(1);
  });

  it('recordFailure increments existing buckets atomically without read-modify-write', () => {
    // The atomic SQL increment must round-trip the same way as the prior
    // JS read-modify-write. Two failures with the same bucket and a
    // different bucket between them should land 2 + 1 = 3 entries.
    recordAttempt(db, 'c1');
    recordFailure(db, 'c1', 'http_401', 'r1');
    recordAttempt(db, 'c1');
    recordFailure(db, 'c1', 'timeout', 'r2');
    recordAttempt(db, 'c1');
    recordFailure(db, 'c1', 'http_401', 'r3');
    const s = getStats(db, 'c1');
    expect(s.failureReasons.http_401).toBe(2);
    expect(s.failureReasons.timeout).toBe(1);
    expect(s.failedTotal).toBe(3);
  });
});

describe('shouldBackoff', () => {
  it('does not back off below threshold', () => {
    const stats = { ...emptyStats(), consecutiveFailures: BACKOFF.FAILURE_THRESHOLD - 1, lastFailureAt: Date.now() };
    expect(shouldBackoff(stats)).toBe(false);
  });

  it('backs off at threshold within the window', () => {
    const stats = { ...emptyStats(), consecutiveFailures: BACKOFF.FAILURE_THRESHOLD, lastFailureAt: Date.now() };
    expect(shouldBackoff(stats)).toBe(true);
  });

  it('does not back off if last failure was outside the window', () => {
    const stats = { ...emptyStats(), consecutiveFailures: BACKOFF.FAILURE_THRESHOLD, lastFailureAt: Date.now() - BACKOFF.WINDOW_MS - 1 };
    expect(shouldBackoff(stats)).toBe(false);
  });

  it('does not back off when lastFailureAt is null', () => {
    const stats = { ...emptyStats(), consecutiveFailures: 99, lastFailureAt: null };
    expect(shouldBackoff(stats)).toBe(false);
  });
});

describe('preciseModeActiveForObserve', () => {
  it('returns false when no key is resolved', () => {
    expect(preciseModeActiveForObserve(emptyStats(), false)).toBe(false);
  });

  it('returns true when key resolved and hook is healthy (no failures)', () => {
    expect(preciseModeActiveForObserve(emptyStats(), true)).toBe(true);
  });

  it('returns true when key resolved and consecutive failures below threshold', () => {
    const stats = { ...emptyStats(), consecutiveFailures: BACKOFF.FAILURE_THRESHOLD - 1 };
    expect(preciseModeActiveForObserve(stats, true)).toBe(true);
  });

  it('returns false (graceful degradation) when hook is in backoff so model claims keep flowing', () => {
    // The whole point of this fix: without falling back here, suppressed
    // model claims + dead-from-backoff hook = silent graph.
    const stats = { ...emptyStats(), consecutiveFailures: BACKOFF.FAILURE_THRESHOLD };
    expect(preciseModeActiveForObserve(stats, true)).toBe(false);
  });

  it('returns to true once a successful extraction resets consecutive_failures', () => {
    // Simulates: hook was in backoff, then succeeded. Counter resets to 0.
    // Suppression should resume immediately on the next buddy_observe call.
    const stats = { ...emptyStats(), consecutiveFailures: 0 };
    expect(preciseModeActiveForObserve(stats, true)).toBe(true);
  });
});

describe('deriveHostKey', () => {
  it('uses session_id when non-empty string', () => {
    expect(deriveHostKey('abc-123', '/tmp/t.jsonl')).toBe('abc-123');
  });

  it('falls back to path:transcript when session_id is empty string', () => {
    // Real-world quirk: some host builds emit "" for unidentified sessions.
    // Using "" as a cursor key would collapse every such session into one row.
    expect(deriveHostKey('', '/tmp/t.jsonl')).toBe('path:/tmp/t.jsonl');
  });

  it('falls back to path:transcript when session_id is null', () => {
    expect(deriveHostKey(null, '/tmp/t.jsonl')).toBe('path:/tmp/t.jsonl');
  });

  it('falls back to path:transcript when session_id is undefined', () => {
    expect(deriveHostKey(undefined, '/tmp/t.jsonl')).toBe('path:/tmp/t.jsonl');
  });

  it('returns null when neither is usable', () => {
    expect(deriveHostKey(undefined, undefined)).toBeNull();
    expect(deriveHostKey('', '')).toBeNull();
    expect(deriveHostKey(null, null)).toBeNull();
  });
});

function emptyStats() {
  return {
    attemptsTotal: 0, succeededTotal: 0, failedTotal: 0, consecutiveFailures: 0,
    failureReasons: {}, lastAttemptAt: null, lastSuccessAt: null,
    lastFailureAt: null, lastFailureReason: null, findingsDeliveredTotal: 0,
  };
}
