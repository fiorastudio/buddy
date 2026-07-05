import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES_LIST, SPRITE_BODIES, spriteFrameCount, renderSprite } from '../../lib/species.js';
import { SPECIES_PALETTES } from '../../lib/color.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('world/public/sprites.json drift guard', () => {
  const raw = readFileSync(join(repoRoot, 'world', 'public', 'sprites.json'), 'utf8');
  const data = JSON.parse(raw) as {
    sprites: Record<string, string[][]>;
    palettes: Record<string, number[][]>;
  };

  it('contains every species with all frames matching renderSprite output', () => {
    for (const species of SPECIES_LIST) {
      expect(data.sprites[species], `missing sprites for ${species}`).toBeDefined();
      const frames = spriteFrameCount(species);
      expect(data.sprites[species]).toHaveLength(frames);
      for (let f = 0; f < frames; f++) {
        const rendered = renderSprite(
          { species, eye: '{E}' as never, hat: 'none', shiny: false, rarity: 'common', stats: {} as never },
          f
        );
        expect(data.sprites[species][f]).toEqual(rendered);
      }
    }
  });

  it('contains a palette for every species', () => {
    for (const species of SPECIES_LIST) {
      expect(data.palettes[species], `missing palette for ${species}`).toEqual(
        SPECIES_PALETTES[species]
      );
    }
  });

  it('covers exactly the species in SPRITE_BODIES (no strays)', () => {
    expect(Object.keys(data.sprites).sort()).toEqual(Object.keys(SPRITE_BODIES).sort());
  });
});
