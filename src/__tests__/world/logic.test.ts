import { describe, it, expect } from 'vitest';
import { spendXpBudget, XP_PER_HOUR_CAP, XP_BURST_CAP } from '../../lib/world/antiabuse.js';
import { makeSlug, isNameClean } from '../../lib/world/identity.js';
import { pickDistrict, DISTRICT_CAPACITY } from '../../lib/world/districts.js';

describe('spendXpBudget (persisted token bucket)', () => {
  it('grants a legitimate steady gain in full', () => {
    const r = spendXpBudget(0, 60 * 60 * 1000, 200); // empty bucket, 1h refill, +200
    expect(r.granted).toBe(200);
    expect(r.flagged).toBe(false);
  });

  it('grants a legitimate burst after idle time from the stored budget', () => {
    const r = spendXpBudget(XP_BURST_CAP, 60 * 1000, 150); // full bucket, 1min later
    expect(r.granted).toBe(150);
    expect(r.flagged).toBe(false);
  });

  it('caps refill at the burst ceiling no matter how long the idle', () => {
    const r = spendXpBudget(0, 1000 * 60 * 60 * 1000, 5000); // ~41 days idle
    expect(r.granted).toBeLessThanOrEqual(XP_BURST_CAP);
    expect(r.flagged).toBe(true);
  });

  it('bounds ANY request pattern to cap*time + burst (the grace-amplification exploit)', () => {
    // Adversary: 120 requests of +26 XP each, spaced 30s apart over 1 hour.
    // The old per-request grace granted ~1500-2000 XP/hr; the bucket must
    // hold the line at 500 (refill) + 200 (initial burst) = 700.
    let budget = XP_BURST_CAP;
    let total = 0;
    for (let i = 0; i < 120; i++) {
      const r = spendXpBudget(budget, 30_000, 26);
      budget = r.budget;
      total += r.granted;
    }
    expect(total).toBeLessThanOrEqual(XP_PER_HOUR_CAP + XP_BURST_CAP);
    expect(total).toBeGreaterThan(XP_PER_HOUR_CAP * 0.8); // legit-rate work still mostly flows
  });

  it('exports sane constants', () => {
    expect(XP_PER_HOUR_CAP).toBeGreaterThanOrEqual(400);
    expect(XP_PER_HOUR_CAP).toBeLessThanOrEqual(1000);
    expect(XP_BURST_CAP).toBeGreaterThanOrEqual(100);
    expect(XP_BURST_CAP).toBeLessThanOrEqual(XP_PER_HOUR_CAP);
  });
});

describe('makeSlug', () => {
  it('builds a url-safe slug from name plus suffix', () => {
    expect(makeSlug('Shadowpaw', () => 'x7f2')).toBe('shadowpaw-x7f2');
  });

  it('sanitizes spaces, punctuation, and unicode', () => {
    const slug = makeSlug('Señor Quack!', () => 'ab12');
    expect(slug).toMatch(/^[a-z0-9-]+-ab12$/);
    expect(slug).not.toContain(' ');
  });

  it('falls back to buddy when nothing sanitizable remains', () => {
    expect(makeSlug('!!!', () => 'zz99')).toBe('buddy-zz99');
  });

  it('generates distinct suffixes by default', () => {
    const a = makeSlug('Twin');
    const b = makeSlug('Twin');
    expect(a).not.toBe(b);
  });
});

describe('isNameClean', () => {
  it('accepts normal buddy names', () => {
    expect(isNameClean('Shadowpaw')).toBe(true);
    expect(isNameClean('Sir Quacks-a-lot')).toBe(true);
  });

  it('rejects profanity including basic leetspeak', () => {
    expect(isNameClean('fuck')).toBe(false);
    expect(isNameClean('Sh1tLord')).toBe(false);
  });
});

describe('pickDistrict', () => {
  it('places citizens in plaza-1 when empty', () => {
    expect(pickDistrict({})).toBe('plaza-1');
  });

  it('fills a district to capacity before opening the next', () => {
    expect(pickDistrict({ 'plaza-1': DISTRICT_CAPACITY - 1 })).toBe('plaza-1');
    expect(pickDistrict({ 'plaza-1': DISTRICT_CAPACITY })).toBe('plaza-2');
  });

  it('reuses earlier districts when residents recall', () => {
    expect(pickDistrict({ 'plaza-1': 40, 'plaza-2': 80 })).toBe('plaza-1');
  });
});
