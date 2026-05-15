import { describe, it, expect } from 'vitest';
import { phraseFindingForCompanion } from '../../lib/reasoning/phrasings.js';
import type { Companion } from '../../lib/types.js';

const SPECIES = [
  'Void Cat','Rust Hound','Data Drake','Log Golem','Cache Crow','Shell Turtle','Duck','Goose','Blob','Octopus','Owl','Penguin','Snail','Ghost','Axolotl','Capybara','Cactus','Robot','Rabbit','Mushroom','Chonk'
] as const;

function makeCompanion(species: string): Companion {
  return {
    name: 'Buddy', species, rarity: 'common', eye: '·', hat: 'none', shiny: false,
    stats: { DEBUGGING: 20, PATIENCE: 30, CHAOS: 10, WISDOM: 95, SNARK: 15 },
    personalityBio: 'test', level: 1, xp: 0, mood: 'happy', availablePoints: 0, hatchedAt: 0,
  };
}

describe('phase 2 species voice coverage', () => {
  for (const species of SPECIES) {
    it(`${species} has custom caution and kudos voice`, () => {
      const companion = makeCompanion(species);
      const caution = phraseFindingForCompanion('unchallenged_chain', 'This premise kicked off a long line of reasoning and nobody pressure-tested it after that point.', companion, 0);
      const kudos = phraseFindingForCompanion('grounded_premise_adopted', 'This measured user premise anchored the rest of the solution cleanly.', companion, 0);
      expect(caution.length).toBeGreaterThan(0);
      expect(kudos.length).toBeGreaterThan(0);
      expect(caution).not.toEqual(kudos);
      expect(caution.toLowerCase()).not.toContain('graph');
      expect(caution.toLowerCase()).not.toContain('claims');
      expect(kudos.toLowerCase()).not.toContain('graph');
      expect(kudos.toLowerCase()).not.toContain('claims');
    });
  }

  it('keeps long claim snippets concise', () => {
    const companion = makeCompanion('Goose');
    const out = phraseFindingForCompanion('unchallenged_chain', 'A'.repeat(200), companion, 0);
    expect(out.length).toBeLessThan(220);
    expect(out).toContain('…');
  });
});
