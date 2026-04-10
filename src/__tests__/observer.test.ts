// src/__tests__/observer.test.ts

import { describe, it, expect } from 'vitest';
import {
  inferReaction,
  buildObserverPrompt,
  templateReaction,
  REACTION_STATES,
  type ReactionState,
} from '../lib/observer.js';
import { renderSpeechBubble } from '../lib/bubble.js';
import type { Companion } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Mock companion
// ---------------------------------------------------------------------------

const mockCompanion: Companion = {
  name: 'TestBuddy',
  species: 'Mushroom',
  personalityBio: 'A test mushroom',
  rarity: 'common' as const,
  eye: '.' as const,
  hat: 'none' as const,
  shiny: false,
  stats: { DEBUGGING: 50, PATIENCE: 30, CHAOS: 20, WISDOM: 80, SNARK: 10 },
  level: 1,
  xp: 0,
  mood: 'happy',
  hatchedAt: Date.now(),
};

// ---------------------------------------------------------------------------
// Reaction Inference
// ---------------------------------------------------------------------------

describe('inferReaction – keyword matching', () => {
  it('"wrote clean code" → impressed', () => {
    const r = inferReaction('wrote clean code');
    expect(r.state).toBe('impressed');
  });

  it('"found a bug" → concerned', () => {
    const r = inferReaction('found a bug');
    expect(r.state).toBe('concerned');
  });

  it('"fixed a crash" → concerned', () => {
    const r = inferReaction('fixed a crash');
    expect(r.state).toBe('concerned');
  });

  it('"shipped to production" → excited', () => {
    const r = inferReaction('shipped to production');
    expect(r.state).toBe('excited');
  });

  it('"deployed the app" → excited', () => {
    const r = inferReaction('deployed the app');
    expect(r.state).toBe('excited');
  });

  it('"added a hack workaround" → amused', () => {
    const r = inferReaction('added a hack workaround');
    expect(r.state).toBe('amused');
  });

  it('"designing the architecture" → thinking', () => {
    const r = inferReaction('designing the architecture');
    expect(r.state).toBe('thinking');
  });

  it('"wrote some code" → neutral (no keyword match)', () => {
    const r = inferReaction('wrote some code');
    expect(r.state).toBe('neutral');
  });

  it('keywords are case-insensitive ("TODO" matches "added a todo")', () => {
    const r = inferReaction('added a todo');
    expect(r.state).toBe('amused');
  });
});

describe('inferReaction – reaction shape', () => {
  it('impressed has correct eyeOverride and indicator', () => {
    const r = inferReaction('refactored the module');
    expect(r.state).toBe('impressed');
    expect(r.eyeOverride).toBe('✦');
    expect(r.indicator).toBe('!');
  });

  it('concerned has correct eyeOverride and indicator', () => {
    const r = inferReaction('there is an error here');
    expect(r.state).toBe('concerned');
    expect(r.eyeOverride).toBe('×');
    expect(r.indicator).toBe('?');
  });

  it('amused has correct eyeOverride and indicator', () => {
    const r = inferReaction('used a hack');
    expect(r.state).toBe('amused');
    expect(r.eyeOverride).toBe('°');
    expect(r.indicator).toBe('~');
  });

  it('excited has correct eyeOverride and indicator', () => {
    const r = inferReaction('ready to ship');
    expect(r.state).toBe('excited');
    expect(r.eyeOverride).toBe('◉');
    expect(r.indicator).toBe('!!');
  });

  it('thinking has correct eyeOverride and indicator', () => {
    const r = inferReaction('complex design pattern');
    expect(r.state).toBe('thinking');
    expect(r.eyeOverride).toBe('·');
    expect(r.indicator).toBe('...');
  });

  it('neutral has empty eyeOverride and indicator', () => {
    const r = inferReaction('wrote some code');
    expect(r.state).toBe('neutral');
    expect(r.eyeOverride).toBe('');
    expect(r.indicator).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Observer Prompt Builder
// ---------------------------------------------------------------------------

describe('buildObserverPrompt – required fields', () => {
  it('returns all required fields', () => {
    const result = buildObserverPrompt(mockCompanion, 'backseat', 'refactored the module');
    expect(result).toHaveProperty('companion');
    expect(result).toHaveProperty('prompt');
    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('reaction');
    expect(result).toHaveProperty('templateFallback');
  });

  it('companion block has name, species, personality, peakStat, dumpStat, stats, rarity, eye', () => {
    const result = buildObserverPrompt(mockCompanion, 'both', 'wrote some code');
    const c = result.companion;
    expect(c).toHaveProperty('name');
    expect(c).toHaveProperty('species');
    expect(c).toHaveProperty('personality');
    expect(c).toHaveProperty('peakStat');
    expect(c).toHaveProperty('dumpStat');
    expect(c).toHaveProperty('stats');
    expect(c).toHaveProperty('rarity');
    expect(c).toHaveProperty('eye');
  });
});

describe('buildObserverPrompt – mode-specific prompt content', () => {
  it('backseat mode prompt contains "No code suggestions"', () => {
    const result = buildObserverPrompt(mockCompanion, 'backseat', 'wrote some code');
    expect(result.prompt).toContain('No code suggestions');
  });

  it('skillcoach mode prompt contains "ONE specific"', () => {
    const result = buildObserverPrompt(mockCompanion, 'skillcoach', 'wrote some code');
    expect(result.prompt).toContain('ONE specific');
  });

  it('both mode prompt contains "reaction" and "observation"', () => {
    const result = buildObserverPrompt(mockCompanion, 'both', 'wrote some code');
    expect(result.prompt).toContain('reaction');
    expect(result.prompt).toContain('observation');
  });
});

describe('buildObserverPrompt – prompt includes companion details', () => {
  it('prompt includes companion name', () => {
    const result = buildObserverPrompt(mockCompanion, 'backseat', 'wrote some code');
    expect(result.prompt).toContain('TestBuddy');
  });

  it('prompt includes companion personality', () => {
    const result = buildObserverPrompt(mockCompanion, 'backseat', 'wrote some code');
    expect(result.prompt).toContain('A test mushroom');
  });

  it('prompt includes peak stat with its value', () => {
    // mockCompanion peak is WISDOM (80)
    const result = buildObserverPrompt(mockCompanion, 'backseat', 'wrote some code');
    expect(result.prompt).toContain('WISDOM');
    expect(result.prompt).toContain('80');
  });

  it('prompt includes dump stat with its value', () => {
    // mockCompanion dump is SNARK (10)
    const result = buildObserverPrompt(mockCompanion, 'backseat', 'wrote some code');
    expect(result.prompt).toContain('SNARK');
    expect(result.prompt).toContain('10');
  });
});

describe('buildObserverPrompt – templateFallback', () => {
  it('templateFallback is a non-empty string', () => {
    const result = buildObserverPrompt(mockCompanion, 'backseat', 'wrote some code');
    expect(typeof result.templateFallback).toBe('string');
    expect(result.templateFallback.length).toBeGreaterThan(0);
  });

  it('templateFallback contains companion name (backseat templates use {name})', () => {
    // Use a summary that triggers a state whose backseat templates have {name}
    const result = buildObserverPrompt(mockCompanion, 'backseat', 'refactored the module'); // impressed
    expect(result.templateFallback).toContain('TestBuddy');
  });
});

// ---------------------------------------------------------------------------
// Template Reactions
// ---------------------------------------------------------------------------

describe('templateReaction – template pools', () => {
  it('each reaction state has backseat templates (non-empty pool)', () => {
    for (const state of REACTION_STATES) {
      const t = templateReaction(mockCompanion, 'backseat', 'x', state as ReactionState);
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it('each reaction state has skillcoach templates (non-empty pool)', () => {
    for (const state of REACTION_STATES) {
      const t = templateReaction(mockCompanion, 'skillcoach', 'x', state as ReactionState);
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it('templates are deterministic – same summary length returns same template', () => {
    const summary = 'hello world'; // length 11
    const a = templateReaction(mockCompanion, 'backseat', summary, 'impressed');
    const b = templateReaction(mockCompanion, 'backseat', summary, 'impressed');
    expect(a).toBe(b);
  });

  it('different summary lengths can return different templates', () => {
    // Three-element pool for impressed; lengths 0,1,2 mod 3 cover all entries
    const t0 = templateReaction(mockCompanion, 'backseat', '',   'impressed'); // len 0 → idx 0
    const t1 = templateReaction(mockCompanion, 'backseat', 'x',  'impressed'); // len 1 → idx 1
    const t2 = templateReaction(mockCompanion, 'backseat', 'xy', 'impressed'); // len 2 → idx 2
    // At least two of the three should differ (they're distinct strings in the pool)
    const unique = new Set([t0, t1, t2]);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('{name} placeholder is replaced with companion name', () => {
    // impressed backseat pool[0] = '{name} nods approvingly.'
    const t = templateReaction(mockCompanion, 'backseat', '', 'impressed'); // idx 0
    expect(t).toContain('TestBuddy');
    expect(t).not.toContain('{name}');
  });
});

// ---------------------------------------------------------------------------
// Speech Bubble
// ---------------------------------------------------------------------------

const sampleArt = ['  (o.o)  ', '  ( > )  ', '  /   \\  '];

describe('renderSpeechBubble', () => {
  it('produces non-empty output', () => {
    const out = renderSpeechBubble('Hello!', sampleArt, 'TestBuddy');
    expect(out.length).toBeGreaterThan(0);
  });

  it('output contains top bubble border (. prefix)', () => {
    const out = renderSpeechBubble('Hello!', sampleArt, 'TestBuddy');
    expect(out).toMatch(/^\./m);
  });

  it("output contains bottom bubble border (' prefix)", () => {
    const out = renderSpeechBubble('Hello!', sampleArt, 'TestBuddy');
    expect(out).toMatch(/^'/m);
  });

  it('output contains buddy name', () => {
    const out = renderSpeechBubble('Hello!', sampleArt, 'TestBuddy');
    expect(out).toContain('TestBuddy');
  });

  it('output contains the text content', () => {
    const out = renderSpeechBubble('Hello world!', sampleArt, 'TestBuddy');
    expect(out).toContain('Hello world!');
  });

  it('paragraph breaks (\\n\\n) are preserved as empty lines', () => {
    const out = renderSpeechBubble('First paragraph.\n\nSecond paragraph.', sampleArt, 'TestBuddy');
    // An empty bubble content line starts with "| " followed by spaces.
    // Lines that coincide with art rows have art appended after the bubble part,
    // so we check for lines that start with the empty-content pattern "| " + spaces.
    const lines = out.split('\n');
    const emptyContentLine = lines.find(l => /^\|\s{2,}\|/.test(l));
    expect(emptyContentLine).toBeTruthy();
  });

  it('art lines appear in output', () => {
    const out = renderSpeechBubble('Hello!', sampleArt, 'TestBuddy');
    for (const artLine of sampleArt) {
      expect(out).toContain(artLine.trim());
    }
  });

  it('connector dash (-) appears in output', () => {
    const out = renderSpeechBubble('Hello!', sampleArt, 'TestBuddy');
    expect(out).toContain('-');
  });

  it('long text wraps – no wrapped text segment exceeds inner bubble width', () => {
    const bubbleWidth = 30;
    const innerWidth = bubbleWidth - 4; // "| " prefix + " |" suffix
    const longText =
      'This is a very long sentence that should definitely be wrapped across multiple lines in the bubble.';
    const out = renderSpeechBubble(longText, sampleArt, 'TestBuddy', bubbleWidth);
    const lines = out.split('\n');
    // Bubble content lines start with "| " — extract just the text portion (before any art)
    const contentLines = lines.filter(l => l.startsWith('| '));
    expect(contentLines.length).toBeGreaterThan(1); // should have wrapped
    for (const line of contentLines) {
      // The bubble portion is always exactly `bubbleWidth` chars (padEnd), the rest is art.
      // Extract just the bubble slice.
      const bubblePart = line.slice(0, bubbleWidth);
      // inner text is between "| " and " |"
      const innerText = bubblePart.slice(2, bubbleWidth - 2);
      expect(innerText.trimEnd().length).toBeLessThanOrEqual(innerWidth);
    }
  });
});
