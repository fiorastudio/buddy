import { describe, it, expect } from 'vitest';
import { renderShareHtml } from '../lib/share.js';
import { computeRGB } from '../lib/color.js';
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

describe('renderShareHtml color', () => {
  it('uses computeRGB output as inline sprite color', () => {
    const companion = makeCompanion({ species: 'Cactus', rarity: 'rare', xp: 0 });
    const html = renderShareHtml(companion);
    const [r, g, b] = computeRGB('Cactus', 'rare', 0);
    expect(html).toContain(`rgb(${r}, ${g}, ${b})`);
  });

  it('applies bold weight for Rare buddies', () => {
    const html = renderShareHtml(makeCompanion({ rarity: 'rare' }));
    expect(html).toMatch(/font-weight:\s*bold/);
  });

  it('applies bold weight for Epic buddies', () => {
    const html = renderShareHtml(makeCompanion({ rarity: 'epic' }));
    expect(html).toMatch(/font-weight:\s*bold/);
  });

  it('applies bold weight for Legendary buddies', () => {
    const html = renderShareHtml(makeCompanion({ rarity: 'legendary' }));
    expect(html).toMatch(/font-weight:\s*bold/);
  });

  it('does NOT apply bold weight for Common', () => {
    const html = renderShareHtml(makeCompanion({ rarity: 'common' }));
    expect(html).not.toMatch(/font-weight:\s*bold/);
  });

  it('does NOT apply bold weight for Uncommon', () => {
    const html = renderShareHtml(makeCompanion({ rarity: 'uncommon' }));
    expect(html).not.toMatch(/font-weight:\s*bold/);
  });

  it('Lv 1 and Lv 50 same buddy produce different inline colors', () => {
    const lv1 = renderShareHtml(makeCompanion({ species: 'Cactus', rarity: 'uncommon', level: 1, xp: 0 }));
    const lv50 = renderShareHtml(makeCompanion({ species: 'Cactus', rarity: 'uncommon', level: 50, xp: 100000 }));
    const matchColor = (html: string) => html.match(/rgb\(\d+,\s*\d+,\s*\d+\)/)?.[0];
    expect(matchColor(lv1)).not.toEqual(matchColor(lv50));
  });
});
