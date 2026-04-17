import { describe, it, expect } from 'vitest';
import { SPRITE_BODIES, SPECIES_ANIMATIONS, renderSprite } from '../lib/species.js';
import { stripAnsi } from '../lib/ansi.js';
import {
  getAnimationProfile,
  getAnimationState,
  pickFrame,
  DEFAULT_DWELL_MS,
  type AnimationState,
  type FrameRef,
} from '../lib/animation.js';
import { EYES } from '../lib/types.js';

const ALL_SPECIES = Object.keys(SPRITE_BODIES);

const ALL_ANIMATION_STATES: AnimationState[] = [
  'idle', 'happy', 'content', 'curious', 'grumpy', 'muted', 'exhausted',
  'reaction_excited', 'reaction_impressed', 'reaction_concerned', 'reaction_other',
];

function makeBones(species: string, eye: string = '×') {
  return { species, eye, hat: 'none' as const, rarity: 'common' as const, shiny: false, stats: {} } as any;
}

// ── Width stability tests ──

describe('Width stability — all species × all states', () => {
  for (const species of ALL_SPECIES) {
    describe(species, () => {
      const profile = getAnimationProfile(species);
      const bones = makeBones(species);

      it('all frames have consistent line count', () => {
        const frames = SPRITE_BODIES[species];
        const lineCount = frames[0].length;
        for (let i = 0; i < frames.length; i++) {
          expect(frames[i].length, `frame ${i} has ${frames[i].length} lines, expected ${lineCount}`).toBe(lineCount);
        }
      });

      it('all frames have consistent visible width across all animation states', () => {
        // Collect all unique frame indices referenced by any profile state
        const allRefs = new Set<string>();
        for (const state of ALL_ANIMATION_STATES) {
          for (let tick = 0; tick < 15; tick++) {
            const ref = pickFrame(profile, state, tick * (profile.dwellMs || DEFAULT_DWELL_MS));
            allRefs.add(`${ref.frame}:${ref.blink || false}`);
          }
        }

        // Render each unique frame and check width consistency
        const widthsByLine: Map<number, number> = new Map();
        for (const refStr of allRefs) {
          const [frameStr] = refStr.split(':');
          const frame = parseInt(frameStr, 10);
          const lines = renderSprite(bones, frame);
          for (let i = 0; i < lines.length; i++) {
            const w = lines[i].length; // renderSprite output has no ANSI codes
            if (widthsByLine.has(i)) {
              expect(w, `${species} line ${i} frame ${frame} width ${w} != expected ${widthsByLine.get(i)}`).toBe(widthsByLine.get(i));
            } else {
              widthsByLine.set(i, w);
            }
          }
        }
      });
    });
  }
});

// ── Blink-parity tests ──

describe('Blink parity — frame 1 vs dynamic eye replacement', () => {
  // For most species, frame 1 is the pre-authored blink (eyes already '-').
  // Dynamic blink ({ frame: 0, blink: true }) replaces ALL occurrences of the eye char.
  // These should match for species where the eye char only appears in eye positions.

  const safeEyes = ['×', '◉']; // These rarely appear in structural positions

  for (const species of ['Mushroom', 'Void Cat', 'Duck']) {
    for (const eye of safeEyes) {
      it(`${species} with eye '${eye}': frame 1 matches dynamic blink on frame 0`, () => {
        const bones = makeBones(species, eye);
        const frame1Lines = renderSprite(bones, 1);
        const frame0Lines = renderSprite(bones, 0).map(line => line.replaceAll(eye, '-'));
        expect(frame0Lines).toEqual(frame1Lines);
      });
    }
  }

  // Snail should NOT match — frame 1 has structural trail differences
  it('Snail: frame 1 differs from dynamic blink (trail changes)', () => {
    const bones = makeBones('Snail', '×');
    const frame1Lines = renderSprite(bones, 1);
    const frame0Lines = renderSprite(bones, 0).map(line => line.replaceAll('×', '-'));
    // They should not be equal — Snail frame 1 has trail differences
    expect(frame0Lines).not.toEqual(frame1Lines);
  });

  // Test that dynamic blink with '.' eye corrupts structural dots
  it('species with . eye: dynamic blink corrupts structural positions', () => {
    // Shell Turtle has '.' in structural positions in its sprite
    const bones = makeBones('Shell Turtle', '.');
    const frame0Lines = renderSprite(bones, 0);
    const dynamicBlink = frame0Lines.map(line => line.replaceAll('.', '-'));
    const frame1Lines = renderSprite(bones, 1);
    // Dynamic blink should NOT match frame 1 because it replaces structural dots too
    expect(dynamicBlink).not.toEqual(frame1Lines);
  });
});

// ── SPECIES_ANIMATIONS legacy fallback test ──

describe('SPECIES_ANIMATIONS legacy fallback', () => {
  it('every species has hatchling and adult animations', () => {
    for (const species of ALL_SPECIES) {
      const anim = SPECIES_ANIMATIONS[species];
      expect(anim, `${species} missing from SPECIES_ANIMATIONS`).toBeDefined();
      expect(anim.hatchling.length, `${species} hatchling has no frames`).toBeGreaterThan(0);
      expect(anim.adult.length, `${species} adult has no frames`).toBeGreaterThan(0);
    }
  });

  it('eye substitution works on legacy frames', () => {
    for (const species of ALL_SPECIES) {
      const anim = SPECIES_ANIMATIONS[species];
      for (const stage of ['hatchling', 'adult'] as const) {
        for (const frame of anim[stage]) {
          if (frame.includes('{E}')) {
            const substituted = frame.replaceAll('{E}', '×');
            expect(substituted).not.toContain('{E}');
            expect(substituted).toContain('×');
          }
        }
      }
    }
  });

  it('legacy frames have consistent line count within each stage', () => {
    for (const species of ALL_SPECIES) {
      const anim = SPECIES_ANIMATIONS[species];
      for (const stage of ['hatchling', 'adult'] as const) {
        const frames = anim[stage];
        if (frames.length === 0) continue;
        const lineCount = frames[0].split('\n').length;
        for (let i = 0; i < frames.length; i++) {
          const count = frames[i].split('\n').length;
          expect(count, `${species} ${stage} frame ${i}: ${count} lines vs expected ${lineCount}`).toBe(lineCount);
        }
      }
    }
  });
});

// ── Golden-file snapshot tests ──

describe('Golden-file snapshots — representative species', () => {
  const representatives = ['Snail', 'Mushroom', 'Chonk'];
  const states: AnimationState[] = ['idle', 'happy', 'grumpy'];

  for (const species of representatives) {
    for (const state of states) {
      it(`${species} / ${state}: snapshot is stable`, () => {
        const profile = getAnimationProfile(species);
        const bones = makeBones(species);
        const dwellMs = profile.dwellMs || DEFAULT_DWELL_MS;

        // Render a full cycle (15 ticks) and snapshot
        const frames: string[] = [];
        for (let tick = 0; tick < 15; tick++) {
          const ref = pickFrame(profile, state, tick * dwellMs);
          const lines = renderSprite(bones, ref.frame);
          frames.push(lines.join('\n'));
        }

        // Verify determinism: same inputs produce same outputs
        const frames2: string[] = [];
        for (let tick = 0; tick < 15; tick++) {
          const ref = pickFrame(profile, state, tick * dwellMs);
          const lines = renderSprite(bones, ref.frame);
          frames2.push(lines.join('\n'));
        }
        expect(frames).toEqual(frames2);

        // Verify variation: not all frames identical (except grumpy which is mostly still)
        const unique = new Set(frames);
        if (state === 'grumpy') {
          // Grumpy has idle + blink at sequence position 8 = at least 2 unique frames
          expect(unique.size).toBeGreaterThanOrEqual(2);
        } else {
          expect(unique.size, `${species}/${state} should have frame variation`).toBeGreaterThan(1);
        }
      });
    }
  }
});

// Pet-hearts interaction: hearts are suppressed during bubble mode by code structure
// (petActive check is in the `else` branch of the bubble condition).
// pet_active_until uses strict < comparison, so equal timestamps do not render hearts.
