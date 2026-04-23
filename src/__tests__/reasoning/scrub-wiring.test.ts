import { describe, it, expect } from 'vitest';
import { buildObserverPrompt } from '../../lib/observer.js';
import type { Companion } from '../../lib/types.js';
import type { Finding } from '../../lib/reasoning/index.js';

// Guard the wiring between buildObserverPrompt and scrubReactionText.
// The unit tests on scrub.ts verify the scrubber's own behavior. This
// test catches the case where a future refactor removes the scrub call
// inside buildObserverPrompt — templateFallback would silently start
// carrying mechanism/scold vocabulary again.

const mock: Companion = {
  name: 'Test',
  species: 'Mushroom',
  personalityBio: 'test',
  rarity: 'common',
  eye: '.',
  hat: 'none',
  shiny: false,
  stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
  level: 1,
  xp: 0,
  mood: 'happy',
  hatchedAt: Date.now(),
};

function findingWithText(text: string): Finding {
  return {
    type: 'load_bearing_vibes',
    anchor_claim_id: 'anchor-x',
    claim_text: text,
    downstream_count: 3,
  };
}

describe('buildObserverPrompt — scrubber is wired into templateFallback', () => {
  it('mechanism vocab in the claim text does not reach templateFallback verbatim', () => {
    const r = buildObserverPrompt(mock, 'both', 'wrote code', {
      finding: findingWithText('using the graph correctly'),
      stressedVoice: 'stressed',
      extractionInstruction: '[max mode]',
    });
    // 'the graph' appears in the claim text; scrub rewrites it to 'the reasoning'.
    expect(r.templateFallback).not.toMatch(/\bthe graph\b/);
    expect(r.templateFallback).toMatch(/the reasoning/);
  });

  it('scold phrasing in claim text is softened in templateFallback', () => {
    const r = buildObserverPrompt(mock, 'both', 'wrote code', {
      finding: findingWithText(`you're wrong about the cache`),
      stressedVoice: 'stressed',
      extractionInstruction: '[max mode]',
    });
    expect(r.templateFallback).not.toMatch(/you'?re wrong/i);
  });

  it('no-op on benign text (no false edits)', () => {
    const r = buildObserverPrompt(mock, 'backseat', 'refactored the module');
    // Baseline templates have no mechanism/scold vocab, so scrubber
    // should leave them untouched in full.
    expect(r.templateFallback).toContain('Test'); // {name} substitution
    expect(r.templateFallback.length).toBeGreaterThan(0);
  });

  it('prompt (not templateFallback) is NOT scrubbed — it needs to contain [max mode] for the host', () => {
    const r = buildObserverPrompt(mock, 'both', 'wrote code', {
      finding: findingWithText('a claim'),
      stressedVoice: 'stressed',
      extractionInstruction: '[max mode]\nextraction rules here',
    });
    // The extraction instruction is for the host LLM to read; it must
    // keep the [max mode] label so the model recognizes the block.
    // Only templateFallback (what buddy emits directly) is scrubbed.
    expect(r.prompt).toContain('[max mode]');
  });
});
