import { describe, it, expect } from 'vitest';
import { renderCard } from '../lib/card.js';
import { colorFor, type TerminalCapabilities } from '../lib/color.js';
import type { Companion } from '../lib/types.js';

function makeCompanion(overrides: Partial<Companion> = {}): Companion {
  return {
    name: 'Testy',
    personalityBio: 'A test buddy.',
    rarity: 'rare',
    species: 'Cactus',
    eye: '·',
    hat: 'none',
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 40, CHAOS: 30, WISDOM: 20, SNARK: 10 },
    level: 1,
    xp: 0,
    mood: 'neutral',
    availablePoints: 0,
    hatchedAt: Date.now(),
    ...overrides,
  };
}

describe('renderCard color integration', () => {
  it('sprite lines are wrapped in colorFor escape', () => {
    const companion = makeCompanion({ species: 'Cactus', rarity: 'rare', xp: 0 });
    const card = renderCard(companion);
    const expectedColor = colorFor('Cactus', 'rare', 0);
    // Guard: under NO_COLOR, colorFor returns '' and toContain('') is vacuously true.
    // Fail loudly if the test env can't actually exercise the colorization path.
    expect(expectedColor).not.toBe('');
    expect(card).toContain(expectedColor);
  });

  it('different rarities produce different color codes in card output', () => {
    const common = renderCard(makeCompanion({ rarity: 'common' }));
    const legendary = renderCard(makeCompanion({ rarity: 'legendary' }));
    expect(common).not.toEqual(legendary);
  });

  it('Lv 1 vs Lv 50 same buddy produce different color codes', () => {
    const lv1 = renderCard(makeCompanion({ level: 1, xp: 0 }));
    const lv50 = renderCard(makeCompanion({ level: 50, xp: 100000 }));
    expect(lv1).not.toEqual(lv50);
  });
});

// End-to-end capability tier fallback. Steven's PR #126 review asked us to
// verify NO_COLOR / ANSI-16 / ANSI-256 / truecolor before merge: these tests
// drive renderCard with an explicit TerminalCapabilities and assert the *shape*
// of the escapes in the actual card output — closing the loop the unit tests
// in color.test.ts leave open (those only assert colorFor's return value, not
// what renderCard ultimately emits).
describe('renderCard capability tier fallback (end-to-end)', () => {
  const TRUECOLOR: TerminalCapabilities = { truecolor: true,  ansi256: false, ansi16: false, noColor: false };
  const ANSI256:   TerminalCapabilities = { truecolor: false, ansi256: true,  ansi16: false, noColor: false };
  const ANSI16:    TerminalCapabilities = { truecolor: false, ansi256: false, ansi16: true,  noColor: false };
  const NOCOLOR:   TerminalCapabilities = { truecolor: false, ansi256: false, ansi16: false, noColor: true  };

  it('NO_COLOR → card output contains zero ANSI escape sequences', () => {
    const card = renderCard(makeCompanion({ rarity: 'rare' }), NOCOLOR);
    expect(card).not.toMatch(/\x1b\[/);
  });

  it('ansi16 → emits only 16-color escapes (no 38;5 or 38;2 sequences)', () => {
    const card = renderCard(makeCompanion({ rarity: 'rare' }), ANSI16);
    expect(card).not.toContain('38;5');
    expect(card).not.toContain('38;2');
    expect(card).toMatch(/\x1b\[3[0-7]m/);
  });

  it('ansi256 → emits 256-color escapes and no truecolor 38;2 sequences', () => {
    const card = renderCard(makeCompanion({ rarity: 'rare' }), ANSI256);
    expect(card).toMatch(/\x1b\[38;5;\d+m/);
    expect(card).not.toContain('38;2');
  });

  it('truecolor → emits 24-bit truecolor escapes', () => {
    const card = renderCard(makeCompanion({ rarity: 'rare' }), TRUECOLOR);
    expect(card).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
  });
});
