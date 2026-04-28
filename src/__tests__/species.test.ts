import { describe, it, expect } from 'vitest';
import {
  SPECIES_LIST,
  SPRITE_BODIES,
  renderSprite,
  renderFace,
  spriteFrameCount,
} from '../lib/species.js';
import { generateBio } from '../lib/personality.js';
import type { CompanionBones, Eye, Hat, StatName } from '../lib/types.js';
import { EYES, HATS } from '../lib/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeBones(
  species: string,
  overrides: Partial<CompanionBones> = {},
): CompanionBones {
  return {
    rarity: 'common',
    species,
    eye: '·' as Eye,
    hat: 'none' as Hat,
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 40, CHAOS: 30, WISDOM: 20, SNARK: 10 },
    ...overrides,
  };
}

// ── 1. All 21 Species Coverage ────────────────────────────────────────────────

describe('SPECIES_LIST', () => {
  it('has exactly 21 species', () => {
    expect(SPECIES_LIST).toHaveLength(21);
  });
});

describe('All 21 species — SPRITE_BODIES coverage', () => {
  for (const species of SPECIES_LIST) {
    describe(species, () => {
      it('has an entry in SPRITE_BODIES', () => {
        expect(SPRITE_BODIES[species]).toBeDefined();
      });

      it('has at least 4 animation frames', () => {
        const frames = SPRITE_BODIES[species];
        expect(frames.length).toBeGreaterThanOrEqual(4);
      });

      it('all frames have the same number of lines (no jitter)', () => {
        const frames = SPRITE_BODIES[species];
        const lineCount = frames[0].length;
        for (let i = 1; i < frames.length; i++) {
          expect(frames[i].length).toBe(lineCount);
        }
      });

      it('frame lines are non-empty strings', () => {
        const frames = SPRITE_BODIES[species];
        for (const frame of frames) {
          for (const line of frame) {
            expect(typeof line).toBe('string');
            expect(line.length).toBeGreaterThan(0);
          }
        }
      });

      it('renderSprite produces output for each frame', () => {
        const bones = makeBones(species);
        const count = SPRITE_BODIES[species].length;
        for (let f = 0; f < count; f++) {
          const lines = renderSprite(bones, f);
          expect(lines.length).toBeGreaterThan(0);
          for (const line of lines) {
            expect(typeof line).toBe('string');
          }
        }
      });

      it('renderFace produces a non-empty string', () => {
        const bones = makeBones(species);
        const face = renderFace(bones);
        expect(typeof face).toBe('string');
        expect(face.length).toBeGreaterThan(0);
      });

      it('spriteFrameCount matches actual frame count in SPRITE_BODIES', () => {
        expect(spriteFrameCount(species)).toBe(SPRITE_BODIES[species].length);
      });
    });
  }
});

describe('Penguin generated motion', () => {
  it('keeps a compact body while differentiating left and right poses', () => {
    const bones = makeBones('Penguin');
    const neutral = renderSprite(bones, 0).join('\n');
    const left = renderSprite(bones, 1).join('\n');
    const tucked = renderSprite(bones, 2).join('\n');
    const right = renderSprite(bones, 3).join('\n');

    expect(neutral).toContain('/(   )\\');
    expect(left).toContain('_/|   )\\');
    expect(tucked).toContain('|(   )|');
    expect(right).toContain('/(   |\\_');
    expect(left).not.toEqual(right);
  });
});

// ── 2. Sprite Rendering ───────────────────────────────────────────────────────

describe('renderSprite', () => {
  it('substitutes {E} with the eye character', () => {
    const bones = makeBones('Void Cat', { eye: '@' as Eye });
    const lines = renderSprite(bones, 0);
    const joined = lines.join('\n');
    expect(joined).toContain('@');
    expect(joined).not.toContain('{E}');
  });

  it('with a hat prepends a hat line', () => {
    const bones = makeBones('Rust Hound', { hat: 'crown' as Hat });
    const linesWithHat = renderSprite(bones, 0);
    const linesNoHat = renderSprite(makeBones('Rust Hound'), 0);
    expect(linesWithHat.length).toBe(linesNoHat.length + 1);
  });

  it('without a hat does NOT prepend a hat line', () => {
    const bones = makeBones('Rust Hound', { hat: 'none' as Hat });
    const linesWithHat = renderSprite(bones, 0);
    const linesNoHat = renderSprite(makeBones('Rust Hound'), 0);
    expect(linesWithHat.length).toBe(linesNoHat.length);
  });

  it('returns fallback art for an unknown species', () => {
    const bones = makeBones('Not A Real Species');
    const lines = renderSprite(bones, 0);
    expect(lines).toEqual(['  (?.?)  ']);
  });

  it('frame wraps (frame >= length still returns valid output)', () => {
    const bones = makeBones('Blob');
    const frameCount = spriteFrameCount('Blob');
    // frame index equal to length should wrap to 0
    const wrapped = renderSprite(bones, frameCount);
    const first = renderSprite(bones, 0);
    expect(wrapped).toEqual(first);
  });
});

// ── 3. Eye Substitution ───────────────────────────────────────────────────────

describe('Eye substitution — all 6 eye styles', () => {
  for (const eye of EYES) {
    it(`eye "${eye}" leaves no {E} placeholders in renderSprite output`, () => {
      // Use a species guaranteed to have {E} in its frames
      const bones = makeBones('Void Cat', { eye: eye as Eye });
      const count = spriteFrameCount('Void Cat');
      for (let f = 0; f < count; f++) {
        const lines = renderSprite(bones, f);
        for (const line of lines) {
          expect(line).not.toContain('{E}');
        }
      }
    });

    it(`eye "${eye}" appears in renderSprite output when frame contains eyes`, () => {
      // Frame 0 of Void Cat has {E} in the eye row
      const bones = makeBones('Void Cat', { eye: eye as Eye });
      const lines = renderSprite(bones, 0);
      const joined = lines.join('\n');
      expect(joined).toContain(eye);
    });
  }
});

// ── 4. Personality Bios ───────────────────────────────────────────────────────

describe('generateBio', () => {
  it('produces a non-empty string for all 21 species', () => {
    for (const species of SPECIES_LIST) {
      const bio = generateBio(makeBones(species).stats ? makeBones(species) : makeBones(species));
      expect(typeof bio).toBe('string');
      expect(bio.length).toBeGreaterThan(0);
    }
  });

  it('bio contains species name (case-insensitive)', () => {
    for (const species of SPECIES_LIST) {
      const bio = generateBio(makeBones(species));
      expect(bio.toLowerCase()).toContain(species.toLowerCase());
    }
  });

  it('bio is deterministic — same bones yield same bio', () => {
    for (const species of SPECIES_LIST) {
      const bones = makeBones(species);
      expect(generateBio(bones)).toBe(generateBio(bones));
    }
  });

  it('different peak stats produce different bios', () => {
    // DEBUGGING peak vs SNARK peak for the same species
    const bonesA = makeBones('Void Cat', {
      stats: { DEBUGGING: 90, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
    });
    const bonesB = makeBones('Void Cat', {
      stats: { DEBUGGING: 10, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 90 },
    });
    expect(generateBio(bonesA)).not.toBe(generateBio(bonesB));
  });

  it('bio contains peak trait language', () => {
    // With DEBUGGING as peak stat, the bio should mention debugging-related trait
    const bones = makeBones('Rust Hound', {
      stats: { DEBUGGING: 99, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
    });
    const bio = generateBio(bones);
    // DEBUGGING strength = 'an uncanny nose for bugs'
    expect(bio).toContain('uncanny nose for bugs');
  });

  it('bio contains dump weakness language', () => {
    // With SNARK as dump stat, the bio should mention snark-related weakness
    const bones = makeBones('Data Drake', {
      stats: { DEBUGGING: 80, PATIENCE: 70, CHAOS: 60, WISDOM: 50, SNARK: 5 },
    });
    const bio = generateBio(bones);
    // SNARK weakness = 'roasting your code when it should be helping'
    expect(bio).toContain('roasting your code when it should be helping');
  });
});
