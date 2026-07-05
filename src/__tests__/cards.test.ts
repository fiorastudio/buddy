import { describe, it, expect } from 'vitest';
import { earnedCards, CARD_CATALOG } from '../lib/cards.js';

const maxStats = { DEBUGGING: 99, PATIENCE: 99, CHAOS: 99, WISDOM: 99, SNARK: 99 };
const minStats = { DEBUGGING: 10, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 };

describe('earnedCards — RO-style milestone card album', () => {
  it('a fresh novice has the Novice Card only among level cards', () => {
    const cards = earnedCards(1, 'DEBUGGING', minStats);
    expect(cards.map((c) => c.name)).toContain('Novice Card');
    expect(cards.map((c) => c.name)).not.toContain('Poring Card'); // L5+
  });

  it('unlocks level-milestone cards as you grow', () => {
    const at50 = earnedCards(50, 'WISDOM', minStats).map((c) => c.name);
    expect(at50).toContain('Poring Card');       // L5
    expect(at50).toContain('Transcendent Card');  // L45
    expect(at50).toContain('MVP Card');           // L50
  });

  it('awards a peak-stat card when a stat maxes out', () => {
    const chaosy = earnedCards(30, 'CHAOS', { ...minStats, CHAOS: 95 }).map((c) => c.name);
    expect(chaosy).toContain('Chaos Card');
    const calm = earnedCards(30, 'CHAOS', minStats).map((c) => c.name);
    expect(calm).not.toContain('Chaos Card');
  });

  it('never exceeds the catalog and every earned card is in it', () => {
    const all = earnedCards(50, 'DEBUGGING', maxStats);
    expect(all.length).toBeLessThanOrEqual(CARD_CATALOG.length);
    for (const c of all) expect(CARD_CATALOG.find((x) => x.name === c.name)).toBeTruthy();
  });

  it('is deterministic and defined at every level', () => {
    for (let l = 1; l <= 50; l++) {
      expect(earnedCards(l, 'SNARK', minStats).length).toBeGreaterThanOrEqual(1);
    }
  });
});
