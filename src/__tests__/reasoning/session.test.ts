import { describe, it, expect } from 'vitest';
import { deriveSessionId, sessionDayStartMs } from '../../lib/reasoning/session.js';

describe('deriveSessionId', () => {
  it('is deterministic for same cwd + same day', () => {
    const t = Date.UTC(2026, 3, 22, 12, 0, 0); // 2026-04-22 12:00 UTC
    const a = deriveSessionId('/home/u/project', t);
    const b = deriveSessionId('/home/u/project', t);
    expect(a).toBe(b);
  });

  it('differs across cwds', () => {
    const t = Date.UTC(2026, 3, 22, 12, 0, 0);
    const a = deriveSessionId('/home/u/project-a', t);
    const b = deriveSessionId('/home/u/project-b', t);
    expect(a).not.toBe(b);
  });

  it('differs across days for same cwd', () => {
    const d1 = Date.UTC(2026, 3, 22, 12, 0, 0);
    const d2 = Date.UTC(2026, 3, 23, 12, 0, 0);
    const a = deriveSessionId('/home/u/project', d1);
    const b = deriveSessionId('/home/u/project', d2);
    expect(a).not.toBe(b);
  });

  it('uses UTC day boundary, not local', () => {
    // 2026-04-22 23:59 UTC and 2026-04-23 00:01 UTC cross the boundary
    const beforeMidnight = Date.UTC(2026, 3, 22, 23, 59);
    const afterMidnight = Date.UTC(2026, 3, 23, 0, 1);
    expect(deriveSessionId('/p', beforeMidnight)).not.toBe(deriveSessionId('/p', afterMidnight));
  });

  it('ends with 8-digit UTC day bucket', () => {
    const t = Date.UTC(2026, 3, 22);
    const id = deriveSessionId('/project', t);
    expect(id).toMatch(/-20260422$/);
  });
});

describe('sessionDayStartMs', () => {
  it('round-trips a derived session id back to its UTC midnight ms', () => {
    const t = Date.UTC(2026, 3, 22, 14, 30, 0);
    const id = deriveSessionId('/p', t);
    const start = sessionDayStartMs(id);
    expect(start).toBe(Date.UTC(2026, 3, 22));
  });

  it('returns null for malformed ids', () => {
    expect(sessionDayStartMs('garbage')).toBe(null);
    expect(sessionDayStartMs('abc-xyz')).toBe(null);
  });
});
