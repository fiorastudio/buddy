// src/lib/animation.ts — Animation state derivation, profile management, and frame selection.
// Extracted from statusline-wrapper.ts to enable species-aware animation profiles.

import { SPRITE_BODIES } from './species.js';

// ── Types ──

export type AnimationState =
  | 'idle'
  | 'happy'
  | 'content'
  | 'curious'
  | 'grumpy'
  | 'muted'
  | 'exhausted'              // forward-looking: calculateMood does not return this yet
  | 'reaction_excited'
  | 'reaction_impressed'
  | 'reaction_concerned'
  | 'reaction_other';

export type FrameRef = {
  frame: number;
  blink?: boolean;           // if true, replace eyes with '-' at render time
};

export type AnimationProfile = {
  idle: FrameRef[];
  happy?: FrameRef[];
  content?: FrameRef[];
  curious?: FrameRef[];
  grumpy?: FrameRef[];
  muted?: FrameRef[];
  exhausted?: FrameRef[];
  reactionExcited?: FrameRef[];
  reactionImpressed?: FrameRef[];
  reactionConcerned?: FrameRef[];
  reactionOther?: FrameRef[];
  dwellMs?: number;
};

/** Minimal buddy status shape needed for animation state derivation. */
export interface BuddyAnimationInput {
  mood?: string;
  reaction?: string;
  reaction_expires?: number;
}

// ── Default tick interval ──

export const DEFAULT_DWELL_MS = 500;

// ── Default profile factory ──

/**
 * Generates a sensible default animation profile for a species with `frameCount` frames.
 * Uses { frame: 0, blink: true } for dynamic eye-replacement blinks.
 * Species where frame 1 has structural differences (e.g., Snail trail) should
 * override blink refs with { frame: 1 } in SPECIES_OVERRIDES.
 */
export function defaultProfile(frameCount: number): AnimationProfile {
  const idle: FrameRef = { frame: 0 };
  // Use pre-authored blink frame (frame 1) by default. Dynamic blink ({ frame: 0, blink: true })
  // corrupts sprites for species where the eye character (e.g., '.', '@') appears in structural
  // positions. All 21 species have frame 1 as a hand-authored blink frame with '-' only at eyes.
  const blink: FrameRef = frameCount > 1 ? { frame: 1 } : { frame: 0, blink: true };
  const action1: FrameRef = frameCount > 2 ? { frame: 2 } : idle;
  const action2: FrameRef = frameCount > 3 ? { frame: 3 } : action1;

  return {
    idle: [idle, idle, idle, idle, blink, idle, idle, idle, action1, idle, idle, action2, idle, idle, idle],
    happy: [idle, action1, idle, action2, idle, blink, idle, action1, idle, action2, idle, blink, idle, action1, idle],
    grumpy: [idle, idle, idle, idle, idle, idle, idle, idle, blink, idle, idle, idle, idle, idle, idle],
    muted: [idle, idle, idle, idle, idle, idle, idle, idle, idle, idle, idle, idle, idle, idle, idle],
    exhausted: [idle, idle, idle, idle, idle, idle, idle, idle, blink, idle, idle, idle, idle, idle, idle],
    reactionExcited: Array.from({ length: frameCount }, (_, i) => ({ frame: i })),
    reactionImpressed: Array.from({ length: frameCount }, (_, i) => ({ frame: i })),
    reactionConcerned: [idle, blink, idle, blink],
    reactionOther: frameCount > 1
      ? Array.from({ length: frameCount - 1 }, (_, i) => ({ frame: i + 1 }))
      : [idle],
  };
}

// ── Species overrides ──

const SPECIES_OVERRIDES: Partial<Record<string, Partial<AnimationProfile> & { dwellMs?: number }>> = {
  'Snail':        { dwellMs: 800 },
  'Shell Turtle': { dwellMs: 700 },
  'Capybara':     { dwellMs: 700 },
  'Cache Crow':   { dwellMs: 400 },
  'Duck':         { dwellMs: 400 },
  'Goose':        { dwellMs: 400 },
  'Penguin':      {
    dwellMs: 400,
    idle: [{ frame: 0 }, { frame: 1 }, { frame: 2 }, { frame: 3 }, { frame: 2 }, { frame: 4 }],
    happy: [{ frame: 1 }, { frame: 2 }, { frame: 3 }, { frame: 2 }, { frame: 1 }, { frame: 3 }, { frame: 4 }],
    content: [{ frame: 0 }, { frame: 1 }, { frame: 2 }, { frame: 3 }],
    reactionExcited: [{ frame: 1 }, { frame: 2 }, { frame: 3 }, { frame: 2 }, { frame: 1 }, { frame: 3 }],
    reactionImpressed: [{ frame: 0 }, { frame: 1 }, { frame: 2 }, { frame: 3 }, { frame: 4 }],
  },
  'Rabbit':       { dwellMs: 400 },
};

// ── Profile cache (built on first access) ──

const profileCache = new Map<string, AnimationProfile>();

/** Get the animation profile for a species. Merges default factory with overrides. */
export function getAnimationProfile(species: string): AnimationProfile {
  const cached = profileCache.get(species);
  if (cached) return cached;

  const frames = SPRITE_BODIES[species];
  const frameCount = frames?.length || 3;
  const base = defaultProfile(frameCount);
  const overrides = SPECIES_OVERRIDES[species];

  if (overrides) {
    const merged = { ...base, ...overrides };
    // Preserve dwellMs from override
    if (overrides.dwellMs !== undefined) merged.dwellMs = overrides.dwellMs;
    profileCache.set(species, merged);
    return merged;
  }

  profileCache.set(species, base);
  return base;
}

// ── State derivation ──

/** Derive the current animation state from buddy status + reaction. */
export function getAnimationState(buddy: BuddyAnimationInput): AnimationState {
  const hasReaction = buddy.reaction_expires != null && Date.now() < buddy.reaction_expires;

  if (hasReaction && buddy.reaction) {
    switch (buddy.reaction) {
      case 'excited': return 'reaction_excited';
      case 'impressed': return 'reaction_impressed';
      case 'concerned': return 'reaction_concerned';
      default: return 'reaction_other';
    }
  }

  switch (buddy.mood) {
    case 'happy': return 'happy';
    case 'content': return 'content';
    case 'curious': return 'curious';
    case 'grumpy': return 'grumpy';
    case 'muted': return 'muted';
    case 'exhausted': return 'exhausted';
    default: return 'idle';
  }
}

// ── Frame selection ──

/** Pick a frame from the profile for the given state and timestamp. */
export function pickFrame(profile: AnimationProfile, state: AnimationState, nowMs: number): FrameRef {
  const dwellMs = profile.dwellMs || DEFAULT_DWELL_MS;
  const tick = Math.floor(nowMs / dwellMs);

  // Resolve which sequence to use, with fallback chain
  let seq: FrameRef[];
  switch (state) {
    case 'happy':
      seq = profile.happy || profile.idle;
      break;
    case 'content':
      seq = profile.content || profile.happy || profile.idle;
      break;
    case 'curious':
      seq = profile.curious || profile.idle;
      break;
    case 'grumpy':
      seq = profile.grumpy || profile.idle;
      break;
    case 'muted':
      seq = profile.muted || profile.grumpy || profile.idle;
      break;
    case 'exhausted':
      seq = profile.exhausted || profile.grumpy || profile.idle;
      break;
    case 'reaction_excited':
      seq = profile.reactionExcited || profile.idle;
      break;
    case 'reaction_impressed':
      seq = profile.reactionImpressed || profile.reactionExcited || profile.idle;
      break;
    case 'reaction_concerned':
      seq = profile.reactionConcerned || profile.idle;
      break;
    case 'reaction_other':
      seq = profile.reactionOther || profile.idle;
      break;
    default:
      seq = profile.idle;
  }

  return seq[tick % seq.length]!;
}
