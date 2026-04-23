import { describe, it, expect } from 'vitest';
import { sanitizeClaim } from '../../lib/reasoning/sanitize.js';

// Pins the iterative-decode behavior added in response to a review comment
// on the upstream PR: double-encoded entities like `&amp;lt;system&gt;`
// used to survive one decode pass. The decoder now loops until fixed-point
// (bounded) so the structural-break strips see the resolved form.

describe('sanitizeClaim — iterative HTML entity decode', () => {
  it('decodes double-encoded role tag', () => {
    const out = sanitizeClaim('before &amp;lt;system&amp;gt;payload&amp;lt;/system&amp;gt; after');
    expect(out).not.toMatch(/<\/?system>/i);
    expect(out).not.toMatch(/&(?:lt|gt|amp);/);
  });

  it('decodes triple-encoded content', () => {
    const out = sanitizeClaim('&amp;amp;lt;role&amp;amp;gt;');
    expect(out).not.toMatch(/<\/?role>/i);
    expect(out).not.toMatch(/&(?:amp|lt|gt);/);
  });

  it('still terminates on pathological inputs', () => {
    // `&amp;` decodes to `&`, which won't become a new entity because our
    // table only matches the listed names. Loop should exit at fixed point.
    const start = Date.now();
    const out = sanitizeClaim('&'.repeat(100));
    expect(Date.now() - start).toBeLessThan(100);
    expect(out.length).toBeGreaterThan(0);
  });

  it('benign prose with ampersands is left alone', () => {
    expect(sanitizeClaim('Dun & Bradstreet')).toBe('Dun & Bradstreet');
  });
});
