import { describe, it, expect } from 'vitest';
import { renderCard } from '../lib/card.js';
import { colorFor } from '../lib/color.js';
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
