import { describe, it, expect } from 'vitest';
import { phraseFindingForCompanion } from '../../lib/reasoning/phrasings.js';
import type { Companion } from '../../lib/types.js';

function makeCompanion(species: string, peak: 'DEBUGGING' | 'PATIENCE' | 'CHAOS' | 'WISDOM' | 'SNARK'): Companion {
  const stats = { DEBUGGING: 10, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 } as any;
  stats[peak] = 95;
  return {
    name: 'Buddy',
    species,
    rarity: 'common',
    eye: '·',
    hat: 'none',
    shiny: false,
    stats,
    personalityBio: 'test',
    level: 1,
    xp: 0,
    mood: 'happy',
    availablePoints: 0,
    hatchedAt: 0,
  };
}

describe('phraseFindingForCompanion', () => {
  it('varies wording by species for the same caution finding', () => {
    const goose = phraseFindingForCompanion('unchallenged_chain', 'This claim is doing a lot.', makeCompanion('Goose', 'CHAOS'), 0);
    const turtle = phraseFindingForCompanion('unchallenged_chain', 'This claim is doing a lot.', makeCompanion('Shell Turtle', 'WISDOM'), 0);
    expect(goose).not.toEqual(turtle);
    expect(goose).toContain('Honk');
  });

  it('adds stat-driven lead-in for kudos', () => {
    const drake = phraseFindingForCompanion('grounded_premise_adopted', 'Measured premise', makeCompanion('Data Drake', 'DEBUGGING'), 0);
    expect(drake).toContain('Nice catch:');
  });

  it('falls back safely for species without a custom table', () => {
    const out = phraseFindingForCompanion('unverified_hedge', 'This likely works.', makeCompanion('Penguin', 'PATIENCE'), 0);
    expect(out.length).toBeGreaterThan(0);
  });
});
