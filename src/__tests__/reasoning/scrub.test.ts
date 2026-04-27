import { describe, it, expect } from 'vitest';
import { scrubReactionText, detectLeaks } from '../../lib/reasoning/scrub.js';

describe('scrubReactionText', () => {
  it('is idempotent on benign text', () => {
    expect(scrubReactionText('a clean sentence')).toBe('a clean sentence');
    expect(scrubReactionText('')).toBe('');
  });

  it('rewrites mechanism vocabulary', () => {
    expect(scrubReactionText('my reasoning-watch says so')).not.toMatch(/reasoning[- ]watch/i);
    expect(scrubReactionText('I detected a problem')).not.toMatch(/detected/i);
    expect(scrubReactionText('the graph shows it')).not.toMatch(/the graph/i);
    expect(scrubReactionText('[max mode] kicking in')).not.toMatch(/\[max mode\]/i);
    expect(scrubReactionText('[insight mode] kicking in')).not.toMatch(/\[insight mode\]/i);
  });

  it('rewrites scold phrasings', () => {
    expect(scrubReactionText("you're wrong about that")).not.toMatch(/you'?re wrong/i);
    expect(scrubReactionText("you made an error")).not.toMatch(/made an error/i);
    expect(scrubReactionText("fix this now please")).not.toMatch(/fix this now/i);
    expect(scrubReactionText("you should have seen it")).not.toMatch(/should have/i);
  });

  it('collapses double-spaces introduced by replacement', () => {
    const out = scrubReactionText('before [insight mode] after');
    expect(out).not.toMatch(/\s{2,}/);
  });

  it('handles multiple matches in one string', () => {
    const out = scrubReactionText("I detected you're wrong in the graph");
    expect(out).not.toMatch(/detected/i);
    expect(out).not.toMatch(/you'?re wrong/i);
    expect(out).not.toMatch(/the graph/i);
  });
});

describe('detectLeaks', () => {
  it('reports what matched without mutating', () => {
    const { mechanism, scold } = detectLeaks("the graph says you're wrong");
    expect(mechanism.length).toBeGreaterThan(0);
    expect(scold.length).toBeGreaterThan(0);
  });

  it('returns empty arrays on clean text', () => {
    const { mechanism, scold } = detectLeaks('hello there');
    expect(mechanism).toEqual([]);
    expect(scold).toEqual([]);
  });
});
