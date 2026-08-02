import { describe, it, expect } from 'vitest';
import { zenyForEvent, formatZeny } from '../lib/zeny.js';

describe('zenyForEvent — RO currency from coding events', () => {
  it('pays more for richer events, RO-flavored amounts', () => {
    expect(zenyForEvent('observe')).toBeGreaterThan(0);
    expect(zenyForEvent('deploy')).toBeGreaterThan(zenyForEvent('commit'));
    expect(zenyForEvent('commit')).toBeGreaterThan(zenyForEvent('observe'));
    expect(zenyForEvent('bug_fix')).toBeGreaterThan(zenyForEvent('tests_passed'));
  });

  it('unknown events pay a small default, never negative', () => {
    expect(zenyForEvent('mystery')).toBeGreaterThanOrEqual(0);
    expect(zenyForEvent('level_up')).toBeGreaterThanOrEqual(0);
  });
});

describe('formatZeny — RO "z" suffix with thousands separators', () => {
  it('formats with commas and a trailing z', () => {
    expect(formatZeny(0)).toBe('0z');
    expect(formatZeny(1500)).toBe('1,500z');
    expect(formatZeny(1234567)).toBe('1,234,567z');
  });
});
