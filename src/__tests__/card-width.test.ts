import { describe, it, expect } from 'vitest';
import { renderCard } from '../lib/card.js';
import { displayWidth, padEndWidth, truncateToWidth } from '../lib/display-width.js';
import { stripAnsi } from '../lib/ansi.js';
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

describe('displayWidth', () => {
  it('counts ASCII as one column each', () => {
    expect(displayWidth('hello')).toBe(5);
    expect(displayWidth('')).toBe(0);
  });

  it('counts CJK as two columns', () => {
    expect(displayWidth('漢字')).toBe(4);
    expect(displayWidth('ひらがな')).toBe(8);
  });

  it('counts emoji as two columns, including VS16 and ZWJ sequences', () => {
    expect(displayWidth('🐛')).toBe(2);
    expect(displayWidth('🛡️')).toBe(2); // 3 UTF-16 units
    expect(displayWidth('⚔️')).toBe(2);
    expect(displayWidth('👩‍💻')).toBe(2); // ZWJ sequence
    expect(displayWidth('🇯🇵')).toBe(2); // flag
  });

  it('counts combining marks as zero columns', () => {
    expect(displayWidth('é')).toBe(1);
  });

  it('padEndWidth pads to display width, not length', () => {
    expect(displayWidth(padEndWidth('🛡️', 6))).toBe(6);
    expect(displayWidth(padEndWidth('漢字', 6))).toBe(6);
  });

  it('truncateToWidth never exceeds the width and never splits an emoji', () => {
    const out = truncateToWidth('🛡️'.repeat(30), 10);
    expect(displayWidth(out)).toBeLessThanOrEqual(10);
    expect(out.endsWith('…')).toBe(true);
    expect(truncateToWidth('short', 10)).toBe('short');
  });
});

describe('renderCard border alignment', () => {
  const widths = (card: string) => stripAnsi(card).split('\n').map(displayWidth);

  function expectAligned(companion: Companion) {
    const lines = stripAnsi(renderCard(companion)).split('\n');
    const w = lines.map(displayWidth);
    expect(new Set(w), lines.join('\n')).toEqual(new Set([44]));
  }

  it('aligns a plain card', () => {
    expectAligned(makeCompanion());
  });

  it('aligns cards whose collection line carries VS16 emoji (⚔️ at Lv10, 🛡️ at Lv25)', () => {
    for (const level of [1, 5, 10, 25, 45, 50]) {
      expectAligned(makeCompanion({ level, xp: 100000 }));
    }
  });

  it('aligns a card with a CJK name and bio', () => {
    expectAligned(makeCompanion({ name: '小さな友達', personalityBio: '静かで賢いデバッグの相棒です。いつも見守っています。' }));
  });

  it('aligns a card with an emoji name', () => {
    expectAligned(makeCompanion({ name: 'Sir 🛡️ Pip ⚔️' }));
  });

  it('clips an over-wide name instead of breaking the border', () => {
    expectAligned(makeCompanion({ name: '漢'.repeat(40) }));
  });

  it('keeps ASCII output unchanged in width', () => {
    expect(new Set(widths(renderCard(makeCompanion())))).toEqual(new Set([44]));
  });
});
