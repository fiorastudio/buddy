import { describe, it, expect } from 'vitest';
import { clampXpDelta, XP_PER_HOUR_CAP } from '../../lib/world/antiabuse.js';
import { makeSlug, isNameClean } from '../../lib/world/identity.js';
import { pickDistrict, DISTRICT_CAPACITY } from '../../lib/world/districts.js';

describe('clampXpDelta', () => {
  it('allows xp gains within the hourly budget', () => {
    const r = clampXpDelta(1000, 1200, 60 * 60 * 1000); // +200 over 1h
    expect(r.xp).toBe(1200);
    expect(r.flagged).toBe(false);
  });

  it('clamps impossible gains and flags them', () => {
    const r = clampXpDelta(1000, 6000, 10 * 60 * 1000); // +5000 in 10min
    expect(r.xp).toBeLessThan(6000);
    expect(r.flagged).toBe(true);
  });

  it('never lowers xp below the previous value', () => {
    const r = clampXpDelta(1000, 400, 60 * 60 * 1000);
    expect(r.xp).toBe(1000);
    expect(r.flagged).toBe(true);
  });

  it('exports a sane hourly cap derived from max event rate', () => {
    expect(XP_PER_HOUR_CAP).toBeGreaterThanOrEqual(400);
    expect(XP_PER_HOUR_CAP).toBeLessThanOrEqual(1000);
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
