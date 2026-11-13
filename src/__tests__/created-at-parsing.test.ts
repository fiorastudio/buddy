import { describe, it, expect } from 'vitest';
import { parseCreatedAt } from '../lib/companion.js';

/**
 * SQLite's DEFAULT CURRENT_TIMESTAMP writes 'YYYY-MM-DD HH:MM:SS' in UTC with
 * no zone designator. `new Date(...)` on that string parses it as local time,
 * so a normally-hatched companion's age was off by the UTC offset — and read
 * as negative for the first N hours after hatching west of Greenwich.
 *
 * Rescued buddies were unaffected because createCompanionFromImport writes an
 * explicit ISO 8601 'Z' string; both shapes must keep working.
 */
describe('parseCreatedAt', () => {
  it('treats a bare SQLite timestamp as UTC', () => {
    expect(parseCreatedAt('2026-04-12 21:48:08')).toBe(Date.parse('2026-04-12T21:48:08Z'));
  });

  it('agrees with the old parse only when the machine is on UTC', () => {
    const raw = '2026-04-12 21:48:08';
    const offsetMs = new Date(Date.parse('2026-04-12T21:48:08Z')).getTimezoneOffset() * 60_000;
    expect(parseCreatedAt(raw) - new Date(raw).getTime()).toBe(-offsetMs);
  });

  it('round-trips the ISO form written by the rescue importer', () => {
    const hatchedAt = 1775629556015;
    const stored = new Date(hatchedAt).toISOString();
    expect(parseCreatedAt(stored)).toBe(hatchedAt);
  });

  it('handles an explicit numeric offset', () => {
    expect(parseCreatedAt('2026-04-12T21:48:08+02:00')).toBe(Date.parse('2026-04-12T21:48:08+02:00'));
  });

  it('passes through an epoch number unchanged', () => {
    expect(parseCreatedAt(1775629556015)).toBe(1775629556015);
  });

  it('never returns NaN for junk, null or undefined', () => {
    for (const bad of [undefined, null, '', 'not a date', {}, []]) {
      expect(Number.isFinite(parseCreatedAt(bad as unknown))).toBe(true);
    }
  });

  it('never reports a companion as hatched in the future', () => {
    // A buddy created "now" by SQLite must not read as ahead of the clock.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const sqliteNow =
      `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ` +
      `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    expect(parseCreatedAt(sqliteNow)).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
