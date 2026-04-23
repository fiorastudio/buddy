import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { phraseFinding } from '../../lib/reasoning/phrasings.js';
import { FINDING_TYPES } from '../../lib/reasoning/types.js';
import type { ReactionState } from '../../lib/observer.js';

// Tone guard. The DESIGN.md principle is "gain-framed, never scold." A
// future contributor could slip a scoldy phrasing into the file ("you made
// an error on X — fix it") and the existing tests wouldn't catch it. This
// test enforces an explicit blocklist of words that signal the wrong tone.
//
// Keep the list conservative — false positives here are worse than false
// negatives. Add a word only when a concrete scold-template almost shipped.

const BANNED = [
  /\byou made an error\b/i,
  /\byou messed up\b/i,
  /\byou're wrong\b/i,
  /\byou need to\b/i,           // prescriptive, not collaborative
  /\bthat's (wrong|bad)\b/i,
  /\b(fix|correct) (it|this)\b/i,
  /\bfailed\b/i,
  /\bstupid\b/i,
  /\bshould have\b/i,           // retrospective blame
  /\breasoning[- ]watch\b/i,    // mechanism leak
  /\bthe graph\b/i,             // mechanism leak
  /\bdetect(ed|ion)\b/i,        // mechanism leak
];

describe('phrasings tone — gain-framed, never scold, never name mechanism', () => {
  const thisFile = fileURLToPath(import.meta.url);
  const phrasingsSource = readFileSync(
    join(dirname(thisFile), '..', '..', 'lib', 'reasoning', 'phrasings.ts'),
    'utf-8',
  );

  // Extract only the template strings (quoted text between backticks /
  // single quotes) from the file so we don't match the doc-comment lines.
  // Crude but effective: grab every backtick-delimited string.
  const templates = phrasingsSource.match(/`[^`]+`/g) ?? [];

  it('has template strings to inspect', () => {
    expect(templates.length).toBeGreaterThan(20);
  });

  for (const re of BANNED) {
    it(`no template contains ${re}`, () => {
      for (const t of templates) {
        // Skip strings that are obviously comment content or imports.
        if (t.includes('import ') || t.includes('export ')) continue;
        expect(t, `banned phrase matched in template: ${t.slice(0, 80)}…`).not.toMatch(re);
      }
    });
  }

  it('every finding type × reaction state pair produces a non-empty, non-templated output', () => {
    const states: ReactionState[] = ['impressed', 'concerned', 'amused', 'excited', 'thinking', 'neutral'];
    for (const type of FINDING_TYPES) {
      for (const state of states) {
        const out = phraseFinding(type, state, 'test claim', 0);
        expect(out.length).toBeGreaterThan(0);
        expect(out).not.toContain('{claim}'); // substitution happened
      }
    }
  });
});
