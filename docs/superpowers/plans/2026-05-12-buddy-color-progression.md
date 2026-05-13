# Buddy Color Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single MAGENTA buddy sprite color with a three-input gradient (species × rarity × XP) so every buddy reads as a distinct, evolving color identity.

**Architecture:** New `src/lib/color.ts` module exports a pure `colorFor(species, rarity, totalXp) → ansiEscape` function. It interpolates linearly across 6 RGB anchors (4 species + 2 rarity metal) along the level curve, applies a rarity-specific saturation tint, prepends ANSI bold for Rare+, and emits truecolor / 256-color / 16-color / NO_COLOR output based on terminal capability detection. `statusline-wrapper.ts` and `card.ts` swap their hard-coded MAGENTA for this function.

**Tech Stack:** TypeScript (ESM, `.js` suffix imports), vitest for tests, Node.js 18+.

**Spec:** `docs/superpowers/specs/2026-05-12-buddy-color-progression-design.md`

---

### Task 0: Create the feature branch

**Files:** (none — git operation)

- [ ] **Step 1: Verify clean working tree on master**

```bash
git status
```

Expected: on master, optional uncommitted changes from session work (`.claude/settings.local.json`, `package-lock.json`, `.npm-install.log`, `.superpowers/`) are OK but should not be staged. Spec commits are already on master.

- [ ] **Step 2: Create and check out the feature branch**

```bash
git checkout -b feature/color-progression
git branch --show-current
```

Expected output: `feature/color-progression`

- [ ] **Step 3: No commit yet — branch created from current master tip**

---

### Task 1: Scaffold `src/lib/color.ts` with types and stub exports

**Files:**
- Create: `src/lib/color.ts`
- Create: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing test for module structure**

Create `src/__tests__/color.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { RGB, TerminalCapabilities } from '../lib/color.js';
import { NEUTRAL_GRAY } from '../lib/color.js';

describe('color module — types and constants', () => {
  it('exports NEUTRAL_GRAY as RGB [128, 128, 128]', () => {
    expect(NEUTRAL_GRAY).toEqual([128, 128, 128]);
  });

  it('RGB type accepts a 3-tuple of numbers', () => {
    const sample: RGB = [10, 20, 30];
    expect(sample).toHaveLength(3);
  });

  it('TerminalCapabilities type has the four boolean flags', () => {
    const caps: TerminalCapabilities = {
      truecolor: true,
      ansi256: false,
      ansi16: false,
      noColor: false,
    };
    expect(caps.truecolor).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/color.test.ts`
Expected: FAIL — module `../lib/color.js` does not exist.

- [ ] **Step 3: Create the module with types and `NEUTRAL_GRAY` constant**

Create `src/lib/color.ts`:

```typescript
// src/lib/color.ts — buddy color progression (species × rarity × XP → ANSI escape)
//
// See docs/superpowers/specs/2026-05-12-buddy-color-progression-design.md for the design.

export type RGB = readonly [number, number, number];

export interface TerminalCapabilities {
  truecolor: boolean;
  ansi256: boolean;
  ansi16: boolean;
  noColor: boolean;
}

export const NEUTRAL_GRAY: RGB = [128, 128, 128];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/color.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): scaffold color module with types and NEUTRAL_GRAY"
```

---

### Task 2: Add `SPECIES_PALETTES` constant (21 species × 4 RGB anchors)

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing test for the palette table**

Append to `src/__tests__/color.test.ts`:

```typescript
import { SPECIES_PALETTES, FALLBACK_SPECIES_PALETTE } from '../lib/color.js';
import { SPECIES_LIST } from '../lib/species.js';

describe('SPECIES_PALETTES', () => {
  it('has an entry for every species in SPECIES_LIST', () => {
    for (const species of SPECIES_LIST) {
      expect(SPECIES_PALETTES[species], `missing palette for ${species}`).toBeDefined();
    }
  });

  it('has 21 entries total', () => {
    expect(Object.keys(SPECIES_PALETTES)).toHaveLength(21);
  });

  it('every palette has exactly 4 RGB anchors with values in [0, 255]', () => {
    for (const [species, anchors] of Object.entries(SPECIES_PALETTES)) {
      expect(anchors, `${species} should have 4 anchors`).toHaveLength(4);
      for (const [r, g, b] of anchors) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(255);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(255);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(255);
      }
    }
  });

  it('FALLBACK_SPECIES_PALETTE has 4 RGB anchors', () => {
    expect(FALLBACK_SPECIES_PALETTE).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/color.test.ts -t "SPECIES_PALETTES"`
Expected: FAIL — `SPECIES_PALETTES` not exported.

- [ ] **Step 3: Add the palette table (transcribe RGB values from spec section "Species palettes")**

Append to `src/lib/color.ts`:

```typescript
// 21 species × 4 RGB anchors. First-cut shades from the design spec — tunable.
// Anchor 0 sits at Lv 1 (p=0.0), Anchor 3 sits at Lv 30 (p=0.6). Between
// Lv 30 and Lv 40 the color bridges into the rarity's first metal anchor.
export const SPECIES_PALETTES: Record<string, readonly [RGB, RGB, RGB, RGB]> = {
  'Void Cat':     [[0x1a, 0x1a, 0x2a], [0x4a, 0x3a, 0x6e], [0xc3, 0x3a, 0x8e], [0xd6, 0xd6, 0xf0]],
  'Rust Hound':   [[0xa0, 0x4a, 0x2a], [0xd4, 0x4a, 0x2e], [0xd6, 0x8a, 0x3e], [0xb8, 0x7a, 0x4a]],
  'Data Drake':   [[0x5f, 0xbb, 0x33], [0x4a, 0xd6, 0xc2], [0xe8, 0x3a, 0x9c], [0x9c, 0x3a, 0xff]],
  'Log Golem':    [[0x5e, 0x48, 0x36], [0x5a, 0x7a, 0x3a], [0x7a, 0x7a, 0x7a], [0x8a, 0x9a, 0x6e]],
  'Cache Crow':   [[0x2a, 0x2a, 0x2a], [0x6a, 0x6a, 0x76], [0x4a, 0x5a, 0xa8], [0xd6, 0xd6, 0xe6]],
  'Shell Turtle': [[0x6e, 0x52, 0x36], [0x5a, 0x7a, 0x3a], [0x2e, 0x7a, 0x5a], [0xd6, 0x8a, 0x3e]],
  'Duck':         [[0x5a, 0x7a, 0x4a], [0x4a, 0x8a, 0x9a], [0xd6, 0x8a, 0x3a], [0xf4, 0xc9, 0x48]],
  'Goose':        [[0xaa, 0xa9, 0xa3], [0x6a, 0x8a, 0xa8], [0x4a, 0x8a, 0x99], [0x7e, 0xc9, 0xc6]],
  'Blob':         [[0x5f, 0xbb, 0x33], [0xf4, 0xc9, 0x48], [0xe8, 0x3a, 0x9c], [0x9c, 0x3a, 0xff]],
  'Octopus':      [[0x3d, 0x2a, 0x5a], [0x5d, 0x4c, 0xad], [0x3d, 0x8a, 0xd6], [0x3e, 0xd6, 0xc2]],
  'Owl':          [[0x5d, 0x4c, 0xad], [0x2a, 0x3a, 0x6e], [0xd6, 0xd4, 0xa6], [0xe8, 0xb0, 0x4a]],
  'Penguin':      [[0xd4, 0xe4, 0xeb], [0x5d, 0x9c, 0xd6], [0x4e, 0xc5, 0xb9], [0x6c, 0xd9, 0x9a]],
  'Snail':        [[0xaa, 0xa9, 0xa3], [0x5a, 0x7a, 0x4a], [0xd4, 0xa6, 0xb9], [0xcf, 0xd9, 0xd4]],
  'Ghost':        [[0xaa, 0xa9, 0xa3], [0x6a, 0x8a, 0xa8], [0xc4, 0xe4, 0xe6], [0xf0, 0xf0, 0xf0]],
  'Axolotl':      [[0xd6, 0x8a, 0x8a], [0xe9, 0x6a, 0x5a], [0xf4, 0xb6, 0xc2], [0xb6, 0xe4, 0xc2]],
  'Capybara':     [[0x8a, 0x6a, 0x4a], [0xd6, 0x8a, 0x4a], [0xe8, 0xc4, 0x6a], [0x8a, 0xa6, 0x6e]],
  'Cactus':       [[0x9b, 0x87, 0x57], [0x5a, 0x8a, 0x3a], [0xc7, 0x5d, 0x8a], [0xe8, 0xb0, 0x4a]],
  'Robot':        [[0x5a, 0x5a, 0x66], [0x3a, 0x8a, 0xa4], [0x5f, 0xbb, 0x33], [0xe8, 0x44, 0x3e]],
  'Rabbit':       [[0xf4, 0xb6, 0xc2], [0xf4, 0xe6, 0xc4], [0xe8, 0xb0, 0x6f], [0xf6, 0xf6, 0xf4]],
  'Mushroom':     [[0x5e, 0x48, 0x36], [0x8b, 0x6d, 0x4b], [0xc3, 0x3a, 0x2e], [0xe8, 0xb0, 0x6f]],
  'Chonk':        [[0xe6, 0xd6, 0xb4], [0xd6, 0x8a, 0x4a], [0xc4, 0x84, 0x3e], [0x6e, 0x4a, 0x2a]],
};

// Defensive fallback when an unknown species is encountered (should not happen in
// practice — every Companion has a species from SPECIES_LIST — but avoids throws).
// Generic neutral ramp: gray → blue → green → amber.
export const FALLBACK_SPECIES_PALETTE: readonly [RGB, RGB, RGB, RGB] = [
  [0x66, 0x66, 0x66],
  [0x4a, 0x6a, 0xa8],
  [0x4a, 0xa8, 0x6a],
  [0xd6, 0xa8, 0x4a],
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/color.test.ts -t "SPECIES_PALETTES"`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add 21-species palette table"
```

---

### Task 3: Add `RARITY_METALS` and `RARITY_SATURATION` constants

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/color.test.ts`:

```typescript
import { RARITY_METALS, RARITY_SATURATION } from '../lib/color.js';
import { RARITIES } from '../lib/types.js';

describe('RARITY_METALS and RARITY_SATURATION', () => {
  it('RARITY_METALS has an entry for every rarity', () => {
    for (const rarity of RARITIES) {
      expect(RARITY_METALS[rarity], `missing metals for ${rarity}`).toBeDefined();
    }
  });

  it('every rarity has exactly 2 metal anchors', () => {
    for (const rarity of RARITIES) {
      expect(RARITY_METALS[rarity]).toHaveLength(2);
    }
  });

  it('RARITY_SATURATION values match the spec table', () => {
    expect(RARITY_SATURATION.common).toBe(0.85);
    expect(RARITY_SATURATION.uncommon).toBe(1.00);
    expect(RARITY_SATURATION.rare).toBe(1.05);
    expect(RARITY_SATURATION.epic).toBe(1.12);
    expect(RARITY_SATURATION.legendary).toBe(1.20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/color.test.ts -t "RARITY_METALS"`
Expected: FAIL — `RARITY_METALS` / `RARITY_SATURATION` not exported.

- [ ] **Step 3: Add the constants**

Append to `src/lib/color.ts`:

```typescript
import type { Rarity } from './types.js';

// Tier-break rarity ladder. Common/Uncommon get utilitarian metals (Iron, Copper);
// the visible break to precious materials happens at Rare ("rare should mean rare").
export const RARITY_METALS: Record<Rarity, readonly [RGB, RGB]> = {
  common:    [[0x6a, 0x6a, 0x6e], [0x8a, 0x8a, 0x8e]], // Iron → Polished Iron
  uncommon:  [[0xa8, 0x6a, 0x3a], [0xb8, 0x8a, 0x5e]], // Copper → Patina Copper
  rare:      [[0xc8, 0x9a, 0x2e], [0xf4, 0xc9, 0x48]], // Gold I → Gold II (the jump)
  epic:      [[0x8a, 0xcd, 0xd9], [0xdc, 0xee, 0xf4]], // Diamond → Iridescent
  legendary: [[0xca, 0xbc, 0x94], [0xf4, 0xee, 0xdc]], // Aurum → Aurum Sheen
};

// Applied uniformly across species AND metal segments. Common buddies render
// slightly muted, legendary buddies slightly extra-saturated — rarity is
// readable from Lv 1 through Lv 50.
export const RARITY_SATURATION: Record<Rarity, number> = {
  common:    0.85,
  uncommon:  1.00,
  rare:      1.05,
  epic:      1.12,
  legendary: 1.20,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/color.test.ts -t "RARITY_METALS"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add rarity metal anchors and saturation tints"
```

---

### Task 4: Implement `clamp` and `lerpRGB` helpers

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/color.test.ts`:

```typescript
import { clamp, lerpRGB } from '../lib/color.js';

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });
  it('returns min when below', () => {
    expect(clamp(-10, 0, 100)).toBe(0);
  });
  it('returns max when above', () => {
    expect(clamp(200, 0, 100)).toBe(100);
  });
});

describe('lerpRGB', () => {
  it('returns a at t=0', () => {
    expect(lerpRGB([10, 20, 30], [100, 200, 250], 0)).toEqual([10, 20, 30]);
  });
  it('returns b at t=1', () => {
    expect(lerpRGB([10, 20, 30], [100, 200, 250], 1)).toEqual([100, 200, 250]);
  });
  it('returns midpoint at t=0.5', () => {
    expect(lerpRGB([0, 0, 0], [200, 200, 200], 0.5)).toEqual([100, 100, 100]);
  });
  it('rounds to integer channels', () => {
    const result = lerpRGB([0, 0, 0], [3, 3, 3], 0.5);
    expect(result[0]).toBe(2); // 1.5 rounds to 2
    expect(Number.isInteger(result[0])).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/color.test.ts -t "clamp"`
Expected: FAIL — `clamp` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/color.ts`:

```typescript
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/color.test.ts -t "clamp\\|lerpRGB"`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add clamp and lerpRGB helpers"
```

---

### Task 5: Implement `rampPosition` (XP → 0..1 curve position)

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/color.test.ts`:

```typescript
import { rampPosition } from '../lib/color.js';
import { totalXpForLevel } from '../lib/leveling.js';

describe('rampPosition', () => {
  it('returns 0 at totalXp=0 (Lv 1, no progress)', () => {
    expect(rampPosition(0)).toBe(0);
  });

  it('returns 1.0 at total XP for Lv 50', () => {
    expect(rampPosition(totalXpForLevel(50))).toBe(1.0);
  });

  it('returns 1.0 for XP beyond max level', () => {
    expect(rampPosition(totalXpForLevel(50) + 10000)).toBe(1.0);
  });

  it('returns ~0.6 at Lv 30 with zero progress (species → metal bridge entry)', () => {
    const result = rampPosition(totalXpForLevel(30));
    // (30 - 1 + 0) / 49 = 0.5918...
    expect(result).toBeCloseTo(29 / 49, 3);
  });

  it('is monotonically increasing across the level range', () => {
    let prev = -1;
    for (let lvl = 1; lvl <= 50; lvl++) {
      const p = rampPosition(totalXpForLevel(lvl));
      expect(p, `p at Lv ${lvl}`).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/color.test.ts -t "rampPosition"`
Expected: FAIL — `rampPosition` not exported.

- [ ] **Step 3: Implement `rampPosition`**

Append to `src/lib/color.ts`:

```typescript
import { levelProgress } from './leveling.js';

export function rampPosition(totalXp: number): number {
  const { level, currentXp, neededXp } = levelProgress(totalXp);
  if (level >= 50) return 1.0;
  const progress = neededXp > 0 ? currentXp / neededXp : 0;
  return clamp((level - 1 + progress) / 49, 0, 1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/color.test.ts -t "rampPosition"`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add rampPosition to map XP onto [0, 1] curve"
```

---

### Task 6: Implement `interpolateAnchors` (multi-anchor piecewise lerp)

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/color.test.ts`:

```typescript
import { interpolateAnchors } from '../lib/color.js';

describe('interpolateAnchors', () => {
  const anchors: RGB[] = [
    [0, 0, 0],
    [50, 100, 150],
    [100, 200, 250],
    [255, 255, 255],
  ];
  const breakpoints = [0, 0.3, 0.7, 1.0];

  it('returns first anchor at p=0', () => {
    expect(interpolateAnchors(anchors, breakpoints, 0)).toEqual([0, 0, 0]);
  });

  it('returns exact anchor at internal breakpoint', () => {
    expect(interpolateAnchors(anchors, breakpoints, 0.3)).toEqual([50, 100, 150]);
  });

  it('returns last anchor at p=1', () => {
    expect(interpolateAnchors(anchors, breakpoints, 1.0)).toEqual([255, 255, 255]);
  });

  it('interpolates linearly within a segment (p=0.5 between breakpoints 0.3 and 0.7)', () => {
    // local t = (0.5 - 0.3) / (0.7 - 0.3) = 0.5; midway between [50,100,150] and [100,200,250]
    expect(interpolateAnchors(anchors, breakpoints, 0.5)).toEqual([75, 150, 200]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/color.test.ts -t "interpolateAnchors"`
Expected: FAIL — `interpolateAnchors` not exported.

- [ ] **Step 3: Implement `interpolateAnchors`**

Append to `src/lib/color.ts`:

```typescript
export function interpolateAnchors(
  anchors: readonly RGB[],
  breakpoints: readonly number[],
  p: number,
): RGB {
  for (let i = 1; i < breakpoints.length; i++) {
    if (p <= breakpoints[i]!) {
      const localT = (p - breakpoints[i - 1]!) / (breakpoints[i]! - breakpoints[i - 1]!);
      return lerpRGB(anchors[i - 1]!, anchors[i]!, localT);
    }
  }
  return anchors[anchors.length - 1]!;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/color.test.ts -t "interpolateAnchors"`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add interpolateAnchors for piecewise RGB lerp"
```

---

### Task 7: Implement `applySaturationTint`

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/color.test.ts`:

```typescript
import { applySaturationTint } from '../lib/color.js';

describe('applySaturationTint', () => {
  it('factor=1.0 is identity', () => {
    expect(applySaturationTint([200, 50, 100], 1.0)).toEqual([200, 50, 100]);
  });

  it('factor=0 collapses to neutral gray', () => {
    expect(applySaturationTint([200, 50, 100], 0)).toEqual([128, 128, 128]);
  });

  it('factor=0.85 (common) moves toward gray', () => {
    // r: 128 + (200-128)*0.85 = 128 + 61.2 → 189
    expect(applySaturationTint([200, 200, 200], 0.85)).toEqual([189, 189, 189]);
  });

  it('factor=1.2 extrapolates away from gray and clamps to [0, 255]', () => {
    // r: 128 + (250-128)*1.2 = 128 + 146.4 → 274 → clamped to 255
    const result = applySaturationTint([250, 250, 250], 1.2);
    expect(result[0]).toBe(255);
    expect(result[1]).toBe(255);
    expect(result[2]).toBe(255);
  });

  it('factor=1.2 clamps to 0 when extrapolating dark', () => {
    // r: 128 + (10-128)*1.2 = 128 - 141.6 = -13.6 → clamped to 0
    const result = applySaturationTint([10, 10, 10], 1.2);
    expect(result).toEqual([0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/color.test.ts -t "applySaturationTint"`
Expected: FAIL.

- [ ] **Step 3: Implement `applySaturationTint`**

Append to `src/lib/color.ts`:

```typescript
export function applySaturationTint(rgb: RGB, factor: number): RGB {
  const [gr, gg, gb] = NEUTRAL_GRAY;
  return [
    clamp(Math.round(gr + (rgb[0] - gr) * factor), 0, 255),
    clamp(Math.round(gg + (rgb[1] - gg) * factor), 0, 255),
    clamp(Math.round(gb + (rgb[2] - gb) * factor), 0, 255),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/color.test.ts -t "applySaturationTint"`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add applySaturationTint rarity modulation"
```

---

### Task 8: Implement `computeRGB` (composition of all the math)

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/color.test.ts`:

```typescript
import { computeRGB } from '../lib/color.js';

describe('computeRGB', () => {
  it('returns the first species anchor (tinted) at Lv 1 totalXp=0', () => {
    // Cactus anchor 0 = [0x9b, 0x87, 0x57] = [155, 135, 87]. Uncommon factor = 1.0 (identity).
    expect(computeRGB('Cactus', 'uncommon', 0)).toEqual([155, 135, 87]);
  });

  it('common rarity mutes the species color', () => {
    // Cactus anchor 0 tinted by 0.85: each channel pulled toward 128.
    // r: 128 + (155-128)*0.85 = 128 + 22.95 → 151
    // g: 128 + (135-128)*0.85 = 128 + 5.95 → 134
    // b: 128 + (87-128)*0.85 = 128 + -34.85 → 93
    expect(computeRGB('Cactus', 'common', 0)).toEqual([151, 134, 93]);
  });

  it('legendary rarity boosts saturation', () => {
    // Cactus anchor 0 tinted by 1.2:
    // r: 128 + (155-128)*1.2 = 128 + 32.4 → 160
    // g: 128 + (135-128)*1.2 = 128 + 8.4 → 136
    // b: 128 + (87-128)*1.2 = 128 + -49.2 → 79
    expect(computeRGB('Cactus', 'legendary', 0)).toEqual([160, 136, 79]);
  });

  it('falls back to FALLBACK_SPECIES_PALETTE for unknown species', () => {
    const result = computeRGB('Pegasus', 'uncommon', 0); // not a real species
    expect(result).toEqual([0x66, 0x66, 0x66]); // fallback anchor 0
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/color.test.ts -t "computeRGB"`
Expected: FAIL.

- [ ] **Step 3: Implement `computeRGB`**

Append to `src/lib/color.ts`:

```typescript
const BREAKPOINTS = [0, 0.2, 0.4, 0.6, 0.8, 1.0] as const;

export function computeRGB(species: string, rarity: Rarity, totalXp: number): RGB {
  const p = rampPosition(totalXp);
  const speciesAnchors = SPECIES_PALETTES[species] ?? FALLBACK_SPECIES_PALETTE;
  const metalAnchors = RARITY_METALS[rarity];

  const anchors: RGB[] = [
    speciesAnchors[0], speciesAnchors[1], speciesAnchors[2], speciesAnchors[3],
    metalAnchors[0], metalAnchors[1],
  ];

  const interpolated = interpolateAnchors(anchors, [...BREAKPOINTS], p);
  return applySaturationTint(interpolated, RARITY_SATURATION[rarity]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/color.test.ts -t "computeRGB"`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add computeRGB composition function"
```

---

### Task 9: Implement `detectCapabilities` (terminal capability cascade)

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/color.test.ts`:

```typescript
import { detectCapabilities } from '../lib/color.js';

describe('detectCapabilities', () => {
  // Each test passes an explicit env to avoid global mutation.
  it('NO_COLOR defined → noColor true (highest priority)', () => {
    const caps = detectCapabilities({ NO_COLOR: '1', COLORTERM: 'truecolor' });
    expect(caps.noColor).toBe(true);
    expect(caps.truecolor).toBe(false);
  });

  it('NO_COLOR empty string still triggers no-color (per spec convention)', () => {
    const caps = detectCapabilities({ NO_COLOR: '' });
    expect(caps.noColor).toBe(true);
  });

  it('COLORTERM=truecolor → truecolor', () => {
    const caps = detectCapabilities({ COLORTERM: 'truecolor' });
    expect(caps.truecolor).toBe(true);
  });

  it('COLORTERM=24bit → truecolor', () => {
    const caps = detectCapabilities({ COLORTERM: '24bit' });
    expect(caps.truecolor).toBe(true);
  });

  it('WT_SESSION set → truecolor (Windows Terminal)', () => {
    const caps = detectCapabilities({ WT_SESSION: 'some-guid' });
    expect(caps.truecolor).toBe(true);
  });

  it("TERM_PROGRAM=iTerm.app → truecolor", () => {
    const caps = detectCapabilities({ TERM_PROGRAM: 'iTerm.app' });
    expect(caps.truecolor).toBe(true);
  });

  it("TERM_PROGRAM=vscode → truecolor", () => {
    const caps = detectCapabilities({ TERM_PROGRAM: 'vscode' });
    expect(caps.truecolor).toBe(true);
  });

  it('TERM ending in -truecolor → truecolor', () => {
    const caps = detectCapabilities({ TERM: 'xterm-truecolor' });
    expect(caps.truecolor).toBe(true);
  });

  it('TERM ending in -direct → truecolor', () => {
    const caps = detectCapabilities({ TERM: 'xterm-direct' });
    expect(caps.truecolor).toBe(true);
  });

  it('TERM ending in -256color → ansi256', () => {
    const caps = detectCapabilities({ TERM: 'xterm-256color' });
    expect(caps.ansi256).toBe(true);
    expect(caps.truecolor).toBe(false);
  });

  it('plain TERM=xterm → ansi16', () => {
    const caps = detectCapabilities({ TERM: 'xterm' });
    expect(caps.ansi16).toBe(true);
  });

  it('empty env → ansi16 fallback', () => {
    const caps = detectCapabilities({});
    expect(caps.ansi16).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/color.test.ts -t "detectCapabilities"`
Expected: FAIL.

- [ ] **Step 3: Implement `detectCapabilities`**

Append to `src/lib/color.ts`:

```typescript
export function detectCapabilities(env: NodeJS.ProcessEnv = process.env): TerminalCapabilities {
  const caps: TerminalCapabilities = {
    truecolor: false, ansi256: false, ansi16: false, noColor: false,
  };

  // 1. NO_COLOR — highest priority, any value (including "") counts.
  if (env.NO_COLOR !== undefined) {
    caps.noColor = true;
    return caps;
  }

  // 2. COLORTERM explicit truecolor declaration.
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') {
    caps.truecolor = true;
    return caps;
  }

  // 3. Windows Terminal sets WT_SESSION; it supports truecolor.
  if (env.WT_SESSION) {
    caps.truecolor = true;
    return caps;
  }

  // 4. Well-known truecolor TERM_PROGRAMs.
  if (env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'vscode') {
    caps.truecolor = true;
    return caps;
  }

  // 5. TERM suffix.
  const term = env.TERM ?? '';
  if (term.endsWith('-truecolor') || term.endsWith('-direct')) {
    caps.truecolor = true;
    return caps;
  }
  if (term.endsWith('-256color')) {
    caps.ansi256 = true;
    return caps;
  }

  // 6. Fallback.
  caps.ansi16 = true;
  return caps;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/color.test.ts -t "detectCapabilities"`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add terminal capability detection cascade"
```

---

### Task 10: Implement `rgbTo256` (truecolor → 256-color quantization)

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/color.test.ts`:

```typescript
import { rgbTo256 } from '../lib/color.js';

describe('rgbTo256', () => {
  it('maps pure black to 16 (start of 6×6×6 cube)', () => {
    expect(rgbTo256([0, 0, 0])).toBe(16);
  });

  it('maps pure white to 231 (end of 6×6×6 cube)', () => {
    expect(rgbTo256([255, 255, 255])).toBe(231);
  });

  it('maps pure red to 196 (16 + 36*5 + 0 + 0)', () => {
    expect(rgbTo256([255, 0, 0])).toBe(196);
  });

  it('maps pure green to 46 (16 + 0 + 6*5 + 0)', () => {
    expect(rgbTo256([0, 255, 0])).toBe(46);
  });

  it('maps pure blue to 21 (16 + 0 + 0 + 5)', () => {
    expect(rgbTo256([0, 0, 255])).toBe(21);
  });

  it('returns a value in [16, 231]', () => {
    for (const [r, g, b] of [[100, 50, 200], [10, 200, 30], [128, 128, 128]] as RGB[]) {
      const idx = rgbTo256([r, g, b]);
      expect(idx).toBeGreaterThanOrEqual(16);
      expect(idx).toBeLessThanOrEqual(231);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/color.test.ts -t "rgbTo256"`
Expected: FAIL.

- [ ] **Step 3: Implement `rgbTo256`**

Append to `src/lib/color.ts`:

```typescript
// Map a 24-bit RGB triple into the 256-color cube index (16-231 range).
// Uses the standard 6×6×6 cube formula. Grayscale ramp (232-255) is not used —
// the cube provides adequate fidelity and avoids hue distortion.
export function rgbTo256(rgb: RGB): number {
  const r6 = Math.round((rgb[0] / 255) * 5);
  const g6 = Math.round((rgb[1] / 255) * 5);
  const b6 = Math.round((rgb[2] / 255) * 5);
  return 16 + 36 * r6 + 6 * g6 + b6;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/color.test.ts -t "rgbTo256"`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add rgbTo256 quantization for 256-color terminals"
```

---

### Task 11: Implement `rgbToAnsi16` (truecolor → 8-base-hue fallback)

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/color.test.ts`:

```typescript
import { rgbToAnsi16 } from '../lib/color.js';

describe('rgbToAnsi16', () => {
  it('maps pure red to ANSI 31 (red)', () => {
    expect(rgbToAnsi16([255, 0, 0])).toBe('\x1b[31m');
  });
  it('maps pure green to ANSI 32 (green)', () => {
    expect(rgbToAnsi16([0, 255, 0])).toBe('\x1b[32m');
  });
  it('maps pure blue to ANSI 34 (blue)', () => {
    expect(rgbToAnsi16([0, 0, 255])).toBe('\x1b[34m');
  });
  it('maps pure yellow (R+G) to ANSI 33 (yellow)', () => {
    expect(rgbToAnsi16([255, 255, 0])).toBe('\x1b[33m');
  });
  it('maps pure cyan (G+B) to ANSI 36 (cyan)', () => {
    expect(rgbToAnsi16([0, 255, 255])).toBe('\x1b[36m');
  });
  it('maps pure magenta (R+B) to ANSI 35 (magenta)', () => {
    expect(rgbToAnsi16([255, 0, 255])).toBe('\x1b[35m');
  });
  it('maps near-white to ANSI 37 (white)', () => {
    expect(rgbToAnsi16([240, 240, 240])).toBe('\x1b[37m');
  });
  it('maps near-black to ANSI 30 (black)', () => {
    expect(rgbToAnsi16([10, 10, 10])).toBe('\x1b[30m');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/color.test.ts -t "rgbToAnsi16"`
Expected: FAIL.

- [ ] **Step 3: Implement `rgbToAnsi16`**

Append to `src/lib/color.ts`:

```typescript
// Map RGB to one of the 8 base ANSI hues by classifying the dominant channel(s).
// Coarse but functional fallback for terminals without 256-color support.
export function rgbToAnsi16(rgb: RGB): string {
  const [r, g, b] = rgb;
  const brightness = (r + g + b) / 3;
  const threshold = 96; // below this, treat as black/dim

  // Classify per-channel as "on" (> threshold) or "off" (<= threshold).
  const rOn = r > threshold;
  const gOn = g > threshold;
  const bOn = b > threshold;

  if (!rOn && !gOn && !bOn) return '\x1b[30m'; // black
  if (rOn && gOn && bOn) {
    return brightness > 200 ? '\x1b[37m' : '\x1b[30m'; // white or black
  }
  if (rOn && gOn && !bOn) return '\x1b[33m'; // yellow
  if (rOn && !gOn && bOn) return '\x1b[35m'; // magenta
  if (!rOn && gOn && bOn) return '\x1b[36m'; // cyan
  if (rOn && !gOn && !bOn) return '\x1b[31m'; // red
  if (!rOn && gOn && !bOn) return '\x1b[32m'; // green
  return '\x1b[34m'; // blue (only remaining case)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/color.test.ts -t "rgbToAnsi16"`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add rgbToAnsi16 for 16-color terminal fallback"
```

---

### Task 12: Implement `colorFor` (public API)

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/color.test.ts`:

```typescript
import { colorFor } from '../lib/color.js';

describe('colorFor (public API)', () => {
  const truecolor: TerminalCapabilities = { truecolor: true, ansi256: false, ansi16: false, noColor: false };
  const ansi256: TerminalCapabilities = { truecolor: false, ansi256: true, ansi16: false, noColor: false };
  const ansi16: TerminalCapabilities = { truecolor: false, ansi256: false, ansi16: true, noColor: false };
  const noColor: TerminalCapabilities = { truecolor: false, ansi256: false, ansi16: false, noColor: true };

  it('returns empty string when NO_COLOR', () => {
    expect(colorFor('Cactus', 'rare', 0, noColor)).toBe('');
  });

  it('emits truecolor escape when truecolor', () => {
    // Cactus uncommon Lv 1 = [155, 135, 87], no bold (uncommon).
    expect(colorFor('Cactus', 'uncommon', 0, truecolor)).toBe('\x1b[38;2;155;135;87m');
  });

  it('prepends bold escape for Rare buddies', () => {
    expect(colorFor('Cactus', 'rare', 0, truecolor)).toMatch(/^\x1b\[1m\x1b\[38;2;/);
  });

  it('prepends bold escape for Epic buddies', () => {
    expect(colorFor('Cactus', 'epic', 0, truecolor)).toMatch(/^\x1b\[1m/);
  });

  it('prepends bold escape for Legendary buddies', () => {
    expect(colorFor('Cactus', 'legendary', 0, truecolor)).toMatch(/^\x1b\[1m/);
  });

  it('does NOT prepend bold for Common', () => {
    expect(colorFor('Cactus', 'common', 0, truecolor).startsWith('\x1b[1m')).toBe(false);
  });

  it('does NOT prepend bold for Uncommon', () => {
    expect(colorFor('Cactus', 'uncommon', 0, truecolor).startsWith('\x1b[1m')).toBe(false);
  });

  it('emits 256-color escape when ansi256', () => {
    expect(colorFor('Cactus', 'uncommon', 0, ansi256)).toMatch(/^\x1b\[38;5;\d+m$/);
  });

  it('emits ANSI 16-color escape when ansi16', () => {
    expect(colorFor('Cactus', 'uncommon', 0, ansi16)).toMatch(/^\x1b\[3[0-7]m$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/color.test.ts -t "colorFor"`
Expected: FAIL.

- [ ] **Step 3: Implement `colorFor` and a cached default detector**

Append to `src/lib/color.ts`:

```typescript
let cachedCaps: TerminalCapabilities | null = null;

function getDefaultCapabilities(): TerminalCapabilities {
  if (cachedCaps === null) cachedCaps = detectCapabilities();
  return cachedCaps;
}

const BOLD_RARITIES: ReadonlySet<Rarity> = new Set(['rare', 'epic', 'legendary']);

export function colorFor(
  species: string,
  rarity: Rarity,
  totalXp: number,
  caps: TerminalCapabilities = getDefaultCapabilities(),
): string {
  if (caps.noColor) return '';

  const rgb = computeRGB(species, rarity, totalXp);
  const boldPrefix = BOLD_RARITIES.has(rarity) ? '\x1b[1m' : '';

  if (caps.truecolor) {
    return `${boldPrefix}\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  }
  if (caps.ansi256) {
    return `${boldPrefix}\x1b[38;5;${rgbTo256(rgb)}m`;
  }
  return `${boldPrefix}${rgbToAnsi16(rgb)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/color.test.ts -t "colorFor"`
Expected: PASS — 9 tests.

- [ ] **Step 5: Run the full color test file to verify nothing broke**

Run: `npx vitest run src/__tests__/color.test.ts`
Expected: PASS — all 60+ tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/color.ts src/__tests__/color.test.ts
git commit -m "feat(color): add colorFor public API with capability-driven output"
```

---

### Task 13: Snapshot fixture tests (locked visual contract)

**Files:**
- Create: `src/__tests__/color-snapshot.test.ts`

- [ ] **Step 1: Write the snapshot fixture test**

Create `src/__tests__/color-snapshot.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { colorFor, type TerminalCapabilities } from '../lib/color.js';
import { totalXpForLevel } from '../lib/leveling.js';

const TRUECOLOR: TerminalCapabilities = {
  truecolor: true, ansi256: false, ansi16: false, noColor: false,
};

interface Fixture {
  species: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  level: number;
  label: string;
}

const FIXTURES: Fixture[] = [
  // Each rarity at Lv 1 (start of ramp, species color tinted)
  { species: 'Cactus',   rarity: 'common',    level: 1,  label: 'common-cactus-lv1' },
  { species: 'Cactus',   rarity: 'uncommon',  level: 1,  label: 'uncommon-cactus-lv1' },
  { species: 'Cactus',   rarity: 'rare',      level: 1,  label: 'rare-cactus-lv1' },
  { species: 'Cactus',   rarity: 'epic',      level: 1,  label: 'epic-cactus-lv1' },
  { species: 'Cactus',   rarity: 'legendary', level: 1,  label: 'legendary-cactus-lv1' },

  // Mid-ramp (species color 2 territory)
  { species: 'Octopus',  rarity: 'uncommon',  level: 10, label: 'uncommon-octopus-lv10' },
  { species: 'Octopus',  rarity: 'uncommon',  level: 20, label: 'uncommon-octopus-lv20' },
  { species: 'Octopus',  rarity: 'uncommon',  level: 30, label: 'uncommon-octopus-lv30' },

  // Bridge zone (species → metal handoff)
  { species: 'Penguin',  rarity: 'rare',      level: 35, label: 'rare-penguin-lv35-bridge' },

  // Metal zone (Lv 40-50) per rarity
  { species: 'Robot',    rarity: 'common',    level: 50, label: 'common-robot-lv50-iron' },
  { species: 'Robot',    rarity: 'uncommon',  level: 50, label: 'uncommon-robot-lv50-copper' },
  { species: 'Robot',    rarity: 'rare',      level: 50, label: 'rare-robot-lv50-gold' },
  { species: 'Robot',    rarity: 'epic',      level: 50, label: 'epic-robot-lv50-diamond' },
  { species: 'Robot',    rarity: 'legendary', level: 50, label: 'legendary-robot-lv50-aurum' },

  // Defensive: unknown species falls back gracefully
  { species: 'Pegasus',  rarity: 'uncommon',  level: 1,  label: 'fallback-pegasus' },
];

describe('color fixtures (snapshot contract)', () => {
  for (const fx of FIXTURES) {
    it(`${fx.label} renders to a stable ANSI string`, () => {
      const xp = fx.level === 1 ? 0 : totalXpForLevel(fx.level);
      const escape = colorFor(fx.species, fx.rarity, xp, TRUECOLOR);
      expect(escape).toMatchSnapshot();
    });
  }
});
```

- [ ] **Step 2: Run the fixture test to GENERATE snapshots**

Run: `npx vitest run src/__tests__/color-snapshot.test.ts -u`
Expected: PASS — snapshots written. A `__snapshots__` folder appears next to the test file with `color-snapshot.test.ts.snap`.

- [ ] **Step 3: Run again WITHOUT `-u` to verify snapshots are stable**

Run: `npx vitest run src/__tests__/color-snapshot.test.ts`
Expected: PASS — all 15 fixtures.

- [ ] **Step 4: Spot-check the snapshot file**

Run: `cat src/__tests__/__snapshots__/color-snapshot.test.ts.snap | head -30`
Expected: see entries like `exports['color fixtures (snapshot contract) > common-cactus-lv1 ... 1'] = '[38;2;151;134;93m';`

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/color-snapshot.test.ts src/__tests__/__snapshots__/
git commit -m "test(color): snapshot fixtures lock visual contract for 15 cases"
```

---

### Task 14: Integrate `colorFor` into `statusline-wrapper.ts` (normal sprite mode, line 281)

**Files:**
- Modify: `src/statusline-wrapper.ts`

- [ ] **Step 1: Read current context around line 281**

Run: `head -290 src/statusline-wrapper.ts | tail -20`
Expected: see the `for (let i = 0; i < asciiLines.length; i++) { const artPart = \`${MAGENTA}...\` ... }` block at lines ~279-291.

- [ ] **Step 2: Add color.ts import at the top of the file**

Locate the existing import line (around line 7):

```typescript
import { RESET, DIM, CYAN, YELLOW, GREEN, MAGENTA, stripAnsi } from "./lib/ansi.js";
```

Add immediately after it:

```typescript
import { colorFor } from "./lib/color.js";
```

- [ ] **Step 3: Replace the `MAGENTA` wrapping on line 281**

Find the existing line 281:

```typescript
const artPart = `${MAGENTA}${(asciiLines[i] || "").padEnd(artWidth)}${RESET}`;
```

Replace with:

```typescript
const spriteColor = colorFor(buddy.species, buddy.rarity, buddy.xp);
const artPart = `${spriteColor}${(asciiLines[i] || "").padEnd(artWidth)}${RESET}`;
```

(Hoist `spriteColor` outside the per-line loop — compute once per sprite render to avoid re-running capability detection on every line. See refactor in Step 4.)

- [ ] **Step 4: Hoist `spriteColor` outside the loop**

Find the block at line 279:

```typescript
const artWidth = Math.max(...asciiLines.map((l: string) => l.length));
for (let i = 0; i < asciiLines.length; i++) {
  const artPart = `${MAGENTA}${(asciiLines[i] || "").padEnd(artWidth)}${RESET}`;
  ...
}
```

Replace the whole block with:

```typescript
const artWidth = Math.max(...asciiLines.map((l: string) => l.length));
const spriteColor = colorFor(buddy.species, buddy.rarity, buddy.xp);
for (let i = 0; i < asciiLines.length; i++) {
  const artPart = `${spriteColor}${(asciiLines[i] || "").padEnd(artWidth)}${RESET}`;
  if (i === 0) {
    buddyRight.push(`${artPart} ${nameInfo}`);
  } else if (i === 1) {
    buddyRight.push(`${artPart} ${moodInfo}`);
  } else if (i === 2 && ambientText) {
    buddyRight.push(`${artPart} ${ambientText}`);
  } else {
    buddyRight.push(artPart);
  }
}
```

- [ ] **Step 5: Build the project to verify TypeScript compiles**

Run: `npm run build`
Expected: PASS — `tsc` exits 0, no type errors.

- [ ] **Step 6: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS — all existing tests still pass; new color tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/statusline-wrapper.ts
git commit -m "feat(statusline): use colorFor for sprite art in normal mode"
```

---

### Task 15: Integrate `colorFor` into `statusline-wrapper.ts` (bubble mode, line 178)

**Files:**
- Modify: `src/statusline-wrapper.ts`

- [ ] **Step 1: Locate the bubble sprite block (line ~169-185)**

Run: `sed -n '167,185p' src/statusline-wrapper.ts`

Expected: see the bubble line loop with `${MAGENTA}${right}${RESET}` at line 178.

- [ ] **Step 2: Compute `spriteColor` once before the bubble loop**

Find this block (around line 167):

```typescript
// Colorize bubble lines — the bubble is plain text from renderSpeechBubble().
// Left side = text bubble (borders + content), right side = sprite art after connector.
for (const line of bubbleLines) {
```

Insert before the `for` loop:

```typescript
const bubbleSpriteColor = colorFor(buddy.species, buddy.rarity, buddy.xp);
for (const line of bubbleLines) {
```

- [ ] **Step 3: Replace the `MAGENTA` on line 178**

Find this existing block (line ~176-180):

```typescript
const coloredRight = isName
  ? `${CYAN}${right}${RESET}`
  : `${MAGENTA}${right}${RESET}`;
```

Replace with:

```typescript
const coloredRight = isName
  ? `${CYAN}${right}${RESET}`
  : `${bubbleSpriteColor}${right}${RESET}`;
```

- [ ] **Step 4: Build to verify TypeScript compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/statusline-wrapper.ts
git commit -m "feat(statusline): use colorFor for sprite art in bubble mode"
```

---

### Task 16: Integrate `colorFor` into `card.ts` (renderCard, hatch, rescue sprite reveals)

**Files:**
- Modify: `src/lib/card.ts`
- Create: `src/__tests__/card-color.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `src/__tests__/card-color.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderCard } from '../lib/card.js';
import { colorFor } from '../lib/color.js';
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

describe('renderCard color integration', () => {
  it('sprite lines are wrapped in colorFor escape', () => {
    const companion = makeCompanion({ species: 'Cactus', rarity: 'rare', xp: 0 });
    const card = renderCard(companion);
    const expectedColor = colorFor('Cactus', 'rare', 0);
    expect(card).toContain(expectedColor);
  });

  it('different rarities produce different color codes in card output', () => {
    const common = renderCard(makeCompanion({ rarity: 'common' }));
    const legendary = renderCard(makeCompanion({ rarity: 'legendary' }));
    expect(common).not.toEqual(legendary);
  });

  it('Lv 1 vs Lv 50 same buddy produce different color codes', () => {
    const lv1 = renderCard(makeCompanion({ level: 1, xp: 0 }));
    const lv50 = renderCard(makeCompanion({ level: 50, xp: 100000 }));
    expect(lv1).not.toEqual(lv50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/card-color.test.ts`
Expected: FAIL — card output does not contain colorFor escape codes (still plain text).

- [ ] **Step 3: Wrap sprite lines in renderCard with colorFor**

Open `src/lib/card.ts`. Find the existing imports at the top:

```typescript
import { renderSprite } from './species.js';
import { type Companion, STAT_NAMES, RARITY_STARS } from './types.js';
import { statBar } from './rng.js';
import { levelProgress } from './leveling.js';
```

Add:

```typescript
import { colorFor } from './color.js';
import { RESET } from './ansi.js';
```

Then find the `renderCard` function. Locate this line (around line 48):

```typescript
...art.map(l => ln(l)),
```

Replace with:

```typescript
...art.map(l => ln(`${colorFor(companion.species, companion.rarity, companion.xp)}${l}${RESET}`)),
```

Wait — `ln()` pads its argument to fit the card width. If we add ANSI escapes inside `ln`, the padding will be wrong (the visible width is shorter than the string length). The escape sequences must wrap the *result* of `ln`, not the input.

Use this instead:

```typescript
const spriteColor = colorFor(companion.species, companion.rarity, companion.xp);
const coloredArt = art.map(l => {
  const padded = ln(l); // produces e.g. '| ...art... |'
  // Wrap only the art portion (between the borders) in color.
  // ln output structure: '| ' + padded(inner) + ' |'
  const prefix = '| ';
  const suffix = ' |';
  const inner = padded.slice(prefix.length, padded.length - suffix.length);
  return `${prefix}${spriteColor}${inner}${RESET}${suffix}`;
});
```

Then change the `return` block. Replace this existing line:

```typescript
...art.map(l => ln(l)),
```

With:

```typescript
...coloredArt,
```

And insert the `coloredArt` declaration just before the `return` block (after the `bioLines` setup, before `return [`).

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `npx vitest run src/__tests__/card-color.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run existing card-related tests to verify no regressions**

Run: `npx vitest run src/__tests__/animation-stability.test.ts`
Expected: PASS — animation stability test still works (it uses `stripAnsi` so embedded ANSI codes are handled).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/card.ts src/__tests__/card-color.test.ts
git commit -m "feat(card): colorize sprite lines via colorFor in renderCard"
```

---

### Task 17: Manual verification across terminal modes

**Files:** (none — verification only)

- [ ] **Step 1: Build the latest**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Restart Claude Code and hatch a fresh buddy** (or use existing `Deltaspark`)

The MCP server was installed earlier with the dev install. Restart Claude Code so it loads the rebuilt `dist/`. Then in a new session:

- Observe the statusline. Should show the buddy's sprite in a color computed from (species, rarity, xp), not plain MAGENTA.
- Call `buddy_status` and observe the returned card. Sprite lines should be colorized.

- [ ] **Step 3: Verify each rarity produces a visibly different metal at Lv 50** (manual)

If you can rapidly hatch / observe with rigged XP, check that Common → Iron-tinted, Legendary → Aurum + bold. Otherwise, eyeball at lower levels.

- [ ] **Step 4: Verify NO_COLOR strips color**

In a shell with `NO_COLOR=1` set:

```bash
NO_COLOR=1 node dist/statusline-wrapper.js < some-status-input.json
```

Expected: sprite art appears with no ANSI escapes.

- [ ] **Step 5: Verify cmd.exe (16-color) fallback works**

Open plain `cmd.exe` (not Windows Terminal). Trigger statusline by running buddy via Claude Code from cmd.exe. Expected: sprite renders with one of the 8 base ANSI colors per buddy. Not pretty, but not broken.

- [ ] **Step 6: Verify Windows Terminal (truecolor) renders the full gradient**

Open Windows Terminal. Hatch several buddies of different species/rarities. Expected: each has a distinctly different colored sprite that shifts as XP accrues.

- [ ] **Step 7: No commit — manual verification step**

If verification reveals issues, fix them and commit the fix as a new task. Otherwise proceed.

---

### Task 18: Push the branch and open the PR

**Files:** (none — git/gh operations)

- [ ] **Step 1: Confirm all changes are committed**

Run: `git status`
Expected: working tree clean (or only pre-existing session-state files like `.npm-install.log`).

- [ ] **Step 2: Review the commit log on the branch**

Run: `git log master..HEAD --oneline`
Expected: ~17 commits, one per implementation task.

- [ ] **Step 3: Push the branch**

Run: `git push -u origin feature/color-progression`
Expected: branch published.

- [ ] **Step 4: Open the PR with `gh`**

Run:

```bash
gh pr create --title "feat: buddy color progression (species × rarity × XP)" --body "$(cat <<'EOF'
## Summary
- Replace single MAGENTA sprite color with a 3-input gradient (species × rarity × XP)
- New `src/lib/color.ts` module: 21 species palettes (84 RGB anchors), 5 rarity metal tiers (10 anchors), saturation tint, bold weight at Rare+, truecolor/256-color/16-color/NO_COLOR fallbacks
- Integration: statusline-wrapper.ts (normal + bubble sprite modes) and card.ts (renderCard sprite lines)

Spec: `docs/superpowers/specs/2026-05-12-buddy-color-progression-design.md`

## Test plan
- [x] Unit tests for color math (lerp, interpolate, ramp, tint) — `src/__tests__/color.test.ts`
- [x] Capability detection tests for every env-var path
- [x] Snapshot fixtures for 15 representative (species, rarity, level) cases — `src/__tests__/color-snapshot.test.ts`
- [x] Card integration tests — `src/__tests__/card-color.test.ts`
- [x] Manual verification on Windows Terminal (truecolor), cmd.exe (16-color), NO_COLOR=1

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned.

- [ ] **Step 5: Done.**

---

## Self-Review

**Spec coverage check** (each spec section → task):

- WHY (sprite is monochrome, rarity invisible) → motivation captured in plan goal.
- Goal (3-input function replacing MAGENTA) → Tasks 1, 12, 14, 15, 16.
- Model & Math (6 anchors, breakpoints, lerp) → Tasks 5, 6 (rampPosition, interpolateAnchors).
- Saturation tint → Task 7.
- Bold weight at Rare+ → Task 12 (`BOLD_RARITIES` set, prefix logic).
- Palette tables (21 species × 4, 5 × 2 metals) → Tasks 2, 3.
- Algorithm pseudocode → Tasks 4–8, 12.
- Terminal capability cascade (NO_COLOR → COLORTERM → WT_SESSION → TERM_PROGRAM → TERM suffix → 16-color fallback) → Task 9.
- rgbTo256, rgbToAnsi16 → Tasks 10, 11.
- Code architecture (new src/lib/color.ts, modify statusline-wrapper.ts, modify card.ts) → Tasks 1, 14, 15, 16.
- Tests (unit + snapshot + manual) → Tasks 1–13, 17.
- In-scope (all 21 species, all 5 rarities, capability fallbacks, bold, tint) → all tasks.
- Out-of-scope (shimmer, mood, RARITY_ANSI star recolor, README) → not present in plan ✓ matches.
- Risks (color blindness, terminal compat, bridge muddiness) → manual verification Task 17 covers terminal compat. Bridge muddiness left for post-launch tuning.

**Placeholder scan:** No "TBD", "TODO", "implement later", "appropriate error handling", or "similar to task N." Every step has exact code or exact commands. ✓

**Type consistency:**
- `RGB` type — declared in Task 1, used in Tasks 2–8, 10, 11.
- `TerminalCapabilities` — declared in Task 1, used in Tasks 9, 12.
- `Rarity` — imported from `./types.js` consistently.
- Function names match across tasks: `clamp`, `lerpRGB`, `rampPosition`, `interpolateAnchors`, `applySaturationTint`, `computeRGB`, `detectCapabilities`, `rgbTo256`, `rgbToAnsi16`, `colorFor`.
- Constant names match: `SPECIES_PALETTES`, `FALLBACK_SPECIES_PALETTE`, `RARITY_METALS`, `RARITY_SATURATION`, `NEUTRAL_GRAY`, `BREAKPOINTS`, `BOLD_RARITIES`. ✓

**No gaps spotted.** Plan is ready for execution.
