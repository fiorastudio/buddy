import { describe, it, expect } from 'vitest';
import {
  defaultProfile,
  getAnimationProfile,
  getAnimationState,
  pickFrame,
  DEFAULT_DWELL_MS,
  type AnimationState,
  type FrameRef,
  type AnimationProfile,
} from '../lib/animation.js';
import { SPRITE_BODIES } from '../lib/species.js';

describe('defaultProfile', () => {
  it('generates valid profile for 3-frame species', () => {
    const profile = defaultProfile(3);
    expect(profile.idle.length).toBe(15);
    expect(profile.happy!.length).toBe(15);
    expect(profile.grumpy!.length).toBe(15);
    // All frame indices should be 0, 1, or 2
    for (const ref of profile.idle) {
      expect(ref.frame).toBeGreaterThanOrEqual(0);
      expect(ref.frame).toBeLessThan(3);
    }
  });

  it('generates valid profile for 4-frame species', () => {
    const profile = defaultProfile(4);
    // action2 should use frame 3
    const hasFrame3 = profile.idle.some(r => r.frame === 3);
    expect(hasFrame3).toBe(true);
  });

  it('generates valid profile for 5-frame species', () => {
    const profile = defaultProfile(5);
    const hasFrame3 = profile.idle.some(r => r.frame === 3);
    expect(hasFrame3).toBe(true);
  });

  it('reactionExcited cycles through all frames', () => {
    const profile = defaultProfile(4);
    expect(profile.reactionExcited!.length).toBe(4);
    expect(profile.reactionExcited!.map(r => r.frame)).toEqual([0, 1, 2, 3]);
  });

  it('reactionConcerned alternates idle and blink', () => {
    const profile = defaultProfile(3);
    expect(profile.reactionConcerned!.length).toBe(4);
    expect(profile.reactionConcerned![0]).toEqual({ frame: 0 });
    expect(profile.reactionConcerned![1]).toEqual({ frame: 1 }); // pre-authored blink frame
  });

  it('reactionOther skips idle frame', () => {
    const profile = defaultProfile(4);
    const frames = profile.reactionOther!.map(r => r.frame);
    expect(frames.every(f => f > 0)).toBe(true);
  });

  it('idle sequence includes blink frame (frame 1)', () => {
    const profile = defaultProfile(3);
    const hasBlinkFrame = profile.idle.some(r => r.frame === 1);
    expect(hasBlinkFrame).toBe(true);
  });

  it('generates valid profile for 1-frame species (edge case)', () => {
    const profile = defaultProfile(1);
    expect(profile.idle.every(r => r.frame === 0)).toBe(true);
    // Blink falls back to dynamic eye replacement since only 1 frame
    const hasDynamicBlink = profile.idle.some(r => r.blink === true);
    expect(hasDynamicBlink).toBe(true);
    expect(profile.reactionExcited!.length).toBe(1);
  });

  it('generates valid profile for 2-frame species (edge case)', () => {
    const profile = defaultProfile(2);
    // Frame 1 used for blink
    const hasFrame1 = profile.idle.some(r => r.frame === 1);
    expect(hasFrame1).toBe(true);
    // action1 and action2 fall back to idle (only frames 0 and 1)
    expect(profile.idle.every(r => r.frame <= 1)).toBe(true);
  });

  it('muted sequence has no action frames', () => {
    const profile = defaultProfile(4);
    expect(profile.muted!.every(r => r.frame === 0 && !r.blink)).toBe(true);
  });
});

describe('getAnimationProfile', () => {
  it('returns a profile for every species in SPRITE_BODIES', () => {
    for (const species of Object.keys(SPRITE_BODIES)) {
      const profile = getAnimationProfile(species);
      expect(profile.idle.length).toBeGreaterThan(0);
    }
  });

  it('all profile frame indices are within bounds of SPRITE_BODIES', () => {
    for (const [species, frames] of Object.entries(SPRITE_BODIES)) {
      const profile = getAnimationProfile(species);
      const allRefs: FrameRef[] = [
        ...profile.idle,
        ...(profile.happy || []),
        ...(profile.grumpy || []),
        ...(profile.muted || []),
        ...(profile.exhausted || []),
        ...(profile.reactionExcited || []),
        ...(profile.reactionImpressed || []),
        ...(profile.reactionConcerned || []),
        ...(profile.reactionOther || []),
      ];
      for (const ref of allRefs) {
        expect(ref.frame, `${species} frame ${ref.frame} out of bounds (max ${frames.length - 1})`).toBeLessThan(frames.length);
        expect(ref.frame).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('returns cached profile on second call', () => {
    const p1 = getAnimationProfile('Mushroom');
    const p2 = getAnimationProfile('Mushroom');
    expect(p1).toBe(p2); // same reference
  });

  it('applies dwellMs override for slow species', () => {
    const snail = getAnimationProfile('Snail');
    expect(snail.dwellMs).toBe(800);
    const crow = getAnimationProfile('Cache Crow');
    expect(crow.dwellMs).toBe(400);
  });

  it('species without override have no dwellMs', () => {
    const mushroom = getAnimationProfile('Mushroom');
    expect(mushroom.dwellMs).toBeUndefined();
  });
});

describe('getAnimationState', () => {
  it('returns idle for neutral mood with no reaction', () => {
    expect(getAnimationState({ mood: 'neutral' })).toBe('idle');
  });

  it('maps moods correctly', () => {
    const cases: [string, AnimationState][] = [
      ['happy', 'happy'],
      ['content', 'content'],
      ['curious', 'curious'],
      ['grumpy', 'grumpy'],
      ['muted', 'muted'],
      ['exhausted', 'exhausted'],
    ];
    for (const [mood, expected] of cases) {
      expect(getAnimationState({ mood })).toBe(expected);
    }
  });

  it('reactions override mood', () => {
    const future = Date.now() + 30_000;
    expect(getAnimationState({ mood: 'happy', reaction: 'excited', reaction_expires: future })).toBe('reaction_excited');
    expect(getAnimationState({ mood: 'grumpy', reaction: 'concerned', reaction_expires: future })).toBe('reaction_concerned');
    expect(getAnimationState({ mood: 'idle', reaction: 'impressed', reaction_expires: future })).toBe('reaction_impressed');
    expect(getAnimationState({ mood: 'idle', reaction: 'amused', reaction_expires: future })).toBe('reaction_other');
  });

  it('expired reaction falls back to mood', () => {
    const past = Date.now() - 1000;
    expect(getAnimationState({ mood: 'happy', reaction: 'excited', reaction_expires: past })).toBe('happy');
  });

  it('unknown mood defaults to idle', () => {
    expect(getAnimationState({ mood: 'something_new' })).toBe('idle');
    expect(getAnimationState({})).toBe('idle');
  });
});

describe('pickFrame', () => {
  it('is deterministic for a fixed timestamp', () => {
    const profile = defaultProfile(4);
    const t = 1000000;
    const r1 = pickFrame(profile, 'idle', t);
    const r2 = pickFrame(profile, 'idle', t);
    expect(r1).toEqual(r2);
  });

  it('advances through sequence over time', () => {
    const profile = defaultProfile(4);
    const frames: FrameRef[] = [];
    for (let i = 0; i < 15; i++) {
      frames.push(pickFrame(profile, 'idle', i * DEFAULT_DWELL_MS));
    }
    // Should see variation — not all the same
    const unique = new Set(frames.map(f => `${f.frame}:${f.blink || false}`));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('happy uses more varied frames than grumpy', () => {
    const profile = defaultProfile(4);
    const happyFrames = new Set<number>();
    const grumpyFrames = new Set<number>();
    for (let i = 0; i < 15; i++) {
      happyFrames.add(pickFrame(profile, 'happy', i * DEFAULT_DWELL_MS).frame);
      grumpyFrames.add(pickFrame(profile, 'grumpy', i * DEFAULT_DWELL_MS).frame);
    }
    expect(happyFrames.size).toBeGreaterThan(grumpyFrames.size);
  });

  it('uses fallback chain for content (-> happy -> idle)', () => {
    const profile = defaultProfile(3);
    // content falls back to happy
    const contentFrame = pickFrame(profile, 'content', 1 * DEFAULT_DWELL_MS);
    const happyFrame = pickFrame(profile, 'happy', 1 * DEFAULT_DWELL_MS);
    expect(contentFrame).toEqual(happyFrame);
  });

  it('respects dwellMs override', () => {
    const profile = defaultProfile(4);
    profile.dwellMs = 1000;
    // At 500ms intervals with 1000ms dwell, every two ticks should be the same
    const a = pickFrame(profile, 'idle', 0);
    const b = pickFrame(profile, 'idle', 499);
    expect(a).toEqual(b);
  });
});
