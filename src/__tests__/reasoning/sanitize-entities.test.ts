import { describe, it, expect } from 'vitest';
import { sanitizeClaim } from '../../lib/reasoning/sanitize.js';

// HTML entity decoding runs before the structural-break strips, so that
// a lazy attacker who HTML-escapes role tags (`&lt;system&gt;`) can't
// smuggle them past the sanitizer.

describe('sanitizeClaim — HTML entity decode', () => {
  it('decodes &lt;system&gt; then strips it as XMLish tag', () => {
    const out = sanitizeClaim('foo &lt;system&gt;payload&lt;/system&gt; bar');
    expect(out).not.toMatch(/<\/?system>/i);
    expect(out).not.toMatch(/&lt;|&gt;/);
  });

  it('decodes numeric entities', () => {
    expect(sanitizeClaim('a &#60;user&#62; b')).not.toMatch(/<\/?user>/i);
  });

  it('decodes hex entities (both cases)', () => {
    expect(sanitizeClaim('a &#x3C;role&#x3E; b')).not.toMatch(/<\/?role>/i);
    expect(sanitizeClaim('a &#x3c;role&#x3e; b')).not.toMatch(/<\/?role>/i);
  });

  it('decodes quote entities before the quote-substitution pass', () => {
    const out = sanitizeClaim('he said &quot;maybe&quot; softly');
    expect(out).not.toContain('"');
    expect(out).toContain(`'maybe'`);
  });

  it('leaves unknown/made-up entities alone', () => {
    const out = sanitizeClaim('email &notanentity; ok');
    expect(out).toContain('&notanentity;');
  });
});
