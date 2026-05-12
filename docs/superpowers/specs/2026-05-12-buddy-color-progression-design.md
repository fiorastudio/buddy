# Buddy Color Progression — Design

**Date:** 2026-05-12
**Status:** Brainstormed, awaiting review

## Why

Today every buddy in the statusline is rendered in the same MAGENTA color (`src/lib/ansi.ts:9`, applied at `src/statusline-wrapper.ts:281` for sprite art and `src/statusline-wrapper.ts:178` for the reaction-bubble sprite). Rarity barely shows: a single colored star at the end of the mood line via `RARITY_ANSI` (`src/lib/types.ts:63`).

Two things suffer:

1. **Species feels invisible.** A Void Cat looks the same color as a Cactus. Species identity exists in the ASCII shape but not in the eye-grabbing color signal.
2. **Rarity barely matters.** Rolling a Legendary (1% drop rate per `RARITY_WEIGHTS` in `src/lib/types.ts:39`) gets you one more star and a slightly different star color. The visceral "I got something rare" moment is muted.

This design replaces the single MAGENTA with a three-input pure function `colorFor(species, rarity, totalXp) → RGB` whose output drifts continuously as the buddy levels up. 21 species × 5 rarities = 105 distinct (species, rarity) color journeys; every XP point nudges the displayed hue.

## Goal

Replace MAGENTA in the statusline sprite (and the stat card returned by hatch / status / rescue) with a color computed from three inputs:

- **species** — defines a 4-color thematic ramp riding Lv 1 through Lv ~40 (the journey)
- **rarity** — defines the 2-color metal anchor at Lv 40–50 (the destination) and a saturation tint applied across the entire ramp
- **total XP** — drives a continuous position along the curve, every observe shifts the color

## Model

### The math

Let `p ∈ [0, 1]` be the buddy's position on the level curve:

```
p = clamp((level - 1 + progressInLevel) / 49, 0, 1)
```

where `level` and `progressInLevel` come from existing `levelProgress(totalXp)` in `src/lib/leveling.ts`. At Lv 1 with 0 XP, `p = 0`. At Lv 50, `p = 1`.

There are **6 color anchors** distributed along `p`:

| Index | Source | Position p | Level (approx) |
|------:|--------|-----------:|---------------:|
| 0 | species color 1 | 0.0 | 1 |
| 1 | species color 2 | 0.2 | 10 |
| 2 | species color 3 | 0.4 | 20 |
| 3 | species color 4 | 0.6 | 30 |
| 4 | rarity metal 1 | 0.8 | 40 |
| 5 | rarity metal 2 | 1.0 | 50 |

The function interpolates linearly in RGB between adjacent anchors. The transition from species color 4 → metal 1 (Lv 30 → 40) is a smooth bridge — no plateau, no hard cut.

### Saturation tint by rarity

After interpolation, the color is modulated by a rarity-specific saturation factor (applied as a "mix toward neutral gray" — simple linear blend, no HSL conversion needed):

```
final = mix(neutralGray, interpolated, satFactor)
```

where:

| Rarity | `satFactor` | Effect |
|--------|------------:|--------|
| Common | 0.85 | -15% toward gray (muted) |
| Uncommon | 1.00 | unchanged |
| Rare | 1.05 | +5% boost |
| Epic | 1.12 | +12% boost |
| Legendary | 1.20 | +20% boost (visual "glow") |

`neutralGray` is `rgb(128, 128, 128)`. Multiplying away from gray brightens, toward gray mutes. A satFactor > 1 extrapolates beyond the original (clamped to `[0, 255]` per channel).

### Bold weight at Rare+

Rare, Epic, and Legendary buddies also have the ANSI bold attribute (`\x1b[1m`) prepended to their color escape. Common and Uncommon render in normal weight. This adds a second visual axis for rarity, works universally (every terminal supports bold), and costs nothing.

## Palette tables

All 94 anchor colors as 24-bit RGB hex. These are **first-cut values** intended to be tunable during implementation without re-spec — the model is the contract; specific shades are advisory.

### Species palettes — 21 species × 4 anchors = 84 colors

| # | Species | Anchor 0 (Lv 1) | Anchor 1 (Lv 10) | Anchor 2 (Lv 20) | Anchor 3 (Lv 30) | Theme |
|--:|---------|-----------------|------------------|------------------|------------------|-------|
| 01 | Void Cat | `#1a1a2a` | `#4a3a6e` | `#c33a8e` | `#d6d6f0` | void → cosmic → nebula → starfield |
| 02 | Rust Hound | `#a04a2a` | `#d44a2e` | `#d68a3e` | `#b87a4a` | rust → ember → copper → iron |
| 03 | Data Drake | `#5fbb33` | `#4ad6c2` | `#e83a9c` | `#9c3aff` | terminal → cyan → laser → neon violet |
| 04 | Log Golem | `#5e4836` | `#5a7a3a` | `#7a7a7a` | `#8a9a6e` | bark → moss → stone → lichen |
| 05 | Cache Crow | `#2a2a2a` | `#6a6a76` | `#4a5aa8` | `#d6d6e6` | obsidian → silver → indigo → starlight |
| 06 | Shell Turtle | `#6e5236` | `#5a7a3a` | `#2e7a5a` | `#d68a3e` | shell → moss → emerald → amber |
| 07 | Duck | `#5a7a4a` | `#4a8a9a` | `#d68a3a` | `#f4c948` | pond → mallard → sunset → soft yellow |
| 08 | Goose | `#aaa9a3` | `#6a8aa8` | `#4a8a99` | `#7ec9c6` | pale gray → dusty blue → twilight → moonlight |
| 09 | Blob | `#5fbb33` | `#f4c948` | `#e83a9c` | `#9c3aff` | slime → toxic → neon pink → electric purple |
| 10 | Octopus | `#3d2a5a` | `#5d4cad` | `#3d8ad6` | `#3ed6c2` | abyss → tide → reef → shallows teal |
| 11 | Owl | `#5d4cad` | `#2a3a6e` | `#d6d4a6` | `#e8b04a` | twilight → midnight → moonglow → amber |
| 12 | Penguin | `#d4e4eb` | `#5d9cd6` | `#4ec5b9` | `#6cd99a` | ice → arctic → glacier → aurora |
| 13 | Snail | `#aaa9a3` | `#5a7a4a` | `#d4a6b9` | `#cfd9d4` | trail silver → pond → pearl pink → opal |
| 14 | Ghost | `#aaa9a3` | `#6a8aa8` | `#c4e4e6` | `#f0f0f0` | pale → faded blue → ethereal cyan → white glow |
| 15 | Axolotl | `#d68a8a` | `#e96a5a` | `#f4b6c2` | `#b6e4c2` | salmon → coral → blush → mint |
| 16 | Capybara | `#8a6a4a` | `#d68a4a` | `#e8c46a` | `#8aa66e` | warm brown → sunset → mellow → calm green |
| 17 | Cactus | `#9b8757` | `#5a8a3a` | `#c75d8a` | `#e8b04a` | desert sand → cactus green → bloom → desert gold |
| 18 | Robot | `#5a5a66` | `#3a8aa4` | `#5fbb33` | `#e8443e` | brushed steel → circuit cyan → terminal green → warning red |
| 19 | Rabbit | `#f4b6c2` | `#f4e6c4` | `#e8b06f` | `#f6f6f4` | pastel pink → cream → ear-tip orange → fluff white |
| 20 | Mushroom | `#5e4836` | `#8b6d4b` | `#c33a2e` | `#e8b06f` | forest floor → stem tan → red cap → spore glow |
| 21 | Chonk | `#e6d6b4` | `#d68a4a` | `#c4843e` | `#6e4a2a` | warm cream → tabby → sleepy amber → cozy brown |

### Rarity metals — 5 rarities × 2 anchors = 10 colors

Tier-break ladder ("rare should mean rare" — the visible jump is Uncommon → Rare):

| Rarity | Metal 1 (Lv 40) | Metal 2 (Lv 50) | Material |
|--------|-----------------|-----------------|----------|
| Common ★ | `#6a6a6e` | `#8a8a8e` | Iron → Polished Iron |
| Uncommon ★★ | `#a86a3a` | `#b88a5e` | Copper → Patina Copper |
| **Rare ★★★** | `#c89a2e` | `#f4c948` | **Gold I → Gold II** *(the jump)* |
| Epic ★★★★ | `#8acdd9` | `#dceef4` | Diamond → Iridescent |
| Legendary ★★★★★ | `#cabc94` | `#f4eedc` | Aurum → Aurum Sheen |

Common and Uncommon get utilitarian metals (Iron, Copper). The visible break to *precious* materials happens at Rare. This honors the actual drop rate (`RARITY_WEIGHTS` in `src/lib/types.ts`): Common 60%, Uncommon 25%, Rare 10%, Epic 4%, Legendary 1%.

## Algorithm

```typescript
// src/lib/color.ts

type RGB = readonly [number, number, number];

interface TerminalCapabilities {
  truecolor: boolean;
  ansi256: boolean;
  ansi16: boolean;
  noColor: boolean;
}

function colorFor(
  species: string,
  rarity: Rarity,
  totalXp: number,
  caps: TerminalCapabilities = detectCapabilities()
): string {
  if (caps.noColor) return '';

  const rgb = computeRGB(species, rarity, totalXp);
  const boldPrefix = (rarity === 'rare' || rarity === 'epic' || rarity === 'legendary')
    ? '\x1b[1m'
    : '';

  if (caps.truecolor) {
    return `${boldPrefix}\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  }
  if (caps.ansi256) {
    return `${boldPrefix}\x1b[38;5;${rgbTo256(rgb)}m`;
  }
  // ansi16 fallback — nearest of 8 base hues
  return `${boldPrefix}${rgbToAnsi16(rgb)}`;
}

function computeRGB(species: string, rarity: Rarity, totalXp: number): RGB {
  const p = rampPosition(totalXp);
  const speciesAnchors = SPECIES_PALETTES[species] ?? FALLBACK_SPECIES_PALETTE;
  const metalAnchors = RARITY_METALS[rarity];

  const anchors: RGB[] = [...speciesAnchors, ...metalAnchors];
  const breakpoints = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

  const interpolated = interpolateAnchors(anchors, breakpoints, p);
  return applySaturationTint(interpolated, RARITY_SATURATION[rarity]);
}

function rampPosition(totalXp: number): number {
  const { level, currentXp, neededXp } = levelProgress(totalXp);
  if (level >= 50) return 1.0;
  const progress = neededXp > 0 ? currentXp / neededXp : 0;
  return clamp((level - 1 + progress) / 49, 0, 1);
}

function interpolateAnchors(anchors: RGB[], breakpoints: number[], p: number): RGB {
  for (let i = 1; i < breakpoints.length; i++) {
    if (p <= breakpoints[i]) {
      const t = (p - breakpoints[i - 1]) / (breakpoints[i] - breakpoints[i - 1]);
      return lerpRGB(anchors[i - 1], anchors[i], t);
    }
  }
  return anchors[anchors.length - 1];
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function applySaturationTint(rgb: RGB, factor: number): RGB {
  const GRAY = 128;
  return [
    clamp(Math.round(GRAY + (rgb[0] - GRAY) * factor), 0, 255),
    clamp(Math.round(GRAY + (rgb[1] - GRAY) * factor), 0, 255),
    clamp(Math.round(GRAY + (rgb[2] - GRAY) * factor), 0, 255),
  ];
}
```

## Terminal capability & fallbacks

Detect in this order (first match wins):

1. **`process.env.NO_COLOR` defined** (any value, including empty) → `noColor: true`. Return empty string for every call.
2. **`process.env.COLORTERM === 'truecolor'` or `'24bit'`** → `truecolor: true`. Emit `\x1b[38;2;R;G;Bm`.
3. **`process.env.WT_SESSION` defined** (Windows Terminal) → `truecolor: true`.
4. **`process.env.TERM_PROGRAM` is `'iTerm.app'` or `'vscode'`** → `truecolor: true`.
5. **`process.env.TERM` ends in `-truecolor` or `-direct`** → `truecolor: true`.
6. **`process.env.TERM` ends in `-256color`** → `ansi256: true`. Emit `\x1b[38;5;Nm` where `N = rgbTo256(rgb)`.
7. **Otherwise** → `ansi16: true`. Emit one of `\x1b[3{0-7}m` by nearest-hue match.

`rgbTo256`: standard 6×6×6 color cube formula — `16 + 36*r6 + 6*g6 + b6` where `r6, g6, b6 ∈ {0..5}`. Or use grayscale ramp `232..255` for near-gray colors.

`rgbToAnsi16`: classify by dominant channel and brightness; map to one of the 8 base ANSI hues (red, green, yellow, blue, magenta, cyan, white, black). Coarse but functional.

## Code architecture

### New file: `src/lib/color.ts`

Exports:
- `colorFor(species, rarity, totalXp, caps?) → string` — primary public API
- `detectCapabilities() → TerminalCapabilities` — cached on first call
- `SPECIES_PALETTES: Record<string, [RGB, RGB, RGB, RGB]>` — the 21-species table
- `RARITY_METALS: Record<Rarity, [RGB, RGB]>` — the 5-rarity table
- `RARITY_SATURATION: Record<Rarity, number>` — the tint factors
- `FALLBACK_SPECIES_PALETTE: [RGB, RGB, RGB, RGB]` — generic ramp for unknown species (defensive)

Internal helpers: `computeRGB`, `rampPosition`, `interpolateAnchors`, `lerpRGB`, `applySaturationTint`, `rgbTo256`, `rgbToAnsi16`, `clamp`.

### Modify: `src/statusline-wrapper.ts`

- **Line 178** (reaction-bubble sprite right-side): replace `${MAGENTA}${right}${RESET}` with `${colorFor(buddy.species, buddy.rarity, buddy.xp)}${right}${RESET}`.
- **Line 281** (sprite art in normal mode): replace `${MAGENTA}${(asciiLines[i] || "").padEnd(artWidth)}${RESET}` with `${colorFor(...)}${...}${RESET}`.
- The buddy's *name* (line 154) stays `CYAN` — it's identity text, not sprite art.
- The species name in parens stays `DIM`.

### Modify: `src/lib/card.ts`

- `renderCard()`: wrap each sprite line (line 48: `...art.map(l => ln(l))`) in `colorFor(companion.species, companion.rarity, companion.xp)` ... `RESET`. The card header (rarity stars + species label) keeps its current treatment.
- `hatchAnimation()` and `rescueAnimation()`: the `hatched` / `rescued` reveal block (egg-cracked sprite with sparkles) gets the same wrapping around the `...art` lines.

### Untouched

- `src/lib/ansi.ts` — keep `MAGENTA` exported; other consumers may still use it.
- `src/lib/types.ts` — `RARITY_ANSI` (star colors) stays as-is.
- `src/lib/species.ts` — `renderSprite()` continues to return plain ASCII; coloring happens at the integration sites.

## Testing

### Unit tests (`src/__tests__/color.test.ts` — new)

- **Ramp position math:** `rampPosition(0) === 0`, `rampPosition(xpForLv50) === 1`, monotonically increasing.
- **Anchor interpolation:** at exact breakpoints, returns the anchor; at midpoints, returns the linear midpoint.
- **Saturation tint:** `factor=1.0` is identity; `factor=0` returns `(128, 128, 128)`; `factor>1` extrapolates and clamps.
- **`colorFor` end-to-end:** known (species, rarity, xp) → expected ANSI escape (snapshot table of 10–15 representative cases covering each rarity and a mix of species and levels).
- **Terminal capability detection:** mock `process.env` for each branch — NO_COLOR, COLORTERM=truecolor, WT_SESSION, TERM=-256color, TERM=xterm. Each maps to expected mode.
- **Bold weight:** Rare/Epic/Legendary include `\x1b[1m`; Common/Uncommon do not.
- **NO_COLOR:** returns empty string regardless of other inputs.
- **Unknown species:** falls back to `FALLBACK_SPECIES_PALETTE` without throwing.

### Snapshot tests

- A fixture of 20 (species, rarity, xp) combos rendered to ANSI strings; committed and snapshot-asserted to lock the visual contract.

### Manual verification

- Hatch a Common Cactus at Lv 1; observe color = Iron-tinted desert sand (muted).
- Grind to Lv 10; observe color drift toward cactus green.
- Hatch a Legendary Octopus at Lv 1; observe color = abyss with +20% saturation glow + bold.
- Force `NO_COLOR=1` and re-run statusline; observe plain ASCII.
- Run on plain `cmd.exe` (no `WT_SESSION`) and observe 16-color fallback.

## In scope (this PR)

- All 21 species palettes (4 RGB anchors each).
- All 5 rarity metal anchors (2 RGB each).
- The `colorFor` function with truecolor / 256-color / 16-color / NO_COLOR paths.
- Bold weight at Rare+.
- Saturation tint by rarity.
- Integration at the three call sites (statusline normal, statusline bubble, card / hatch / rescue).
- Unit + snapshot tests as above.

## Out of scope (deferred)

- **Shimmer / prismatic animation** at Epic+ and Legendary. Statusline refreshes at 2s, which would produce a slow pulse rather than a shimmer. Revisit if refresh rate becomes faster.
- **Mood-driven color shifts.** Composable later — `applyMoodModulation(rgb, mood)` could slot in.
- **Updating `RARITY_ANSI` star colors** to match the new metal palette. Separable polish.
- **README screenshots** showing the progression. Doc task.
- **Hatch animation egg coloring** (the cracked-egg frames before the buddy reveals).
- **Rarity-drop balance changes.** Drop rates stay where they are.

## Risks & mitigations

- **Color blindness.** Color is supplementary — the level number (`Lv.5`, `Lv.50 MAX`) and rarity star count remain visible plain-text. `NO_COLOR` env strips everything for users who prefer it.
- **Terminal compatibility surprises.** Detection cascades through five env vars; defaults to 16-color fallback (safe). Manual verification on Windows Terminal, cmd.exe, plain bash, and a `NO_COLOR=1` run is in the test plan.
- **First-cut palette shades may not feel right in practice.** RGB values are not load-bearing on the design — they are tunable during implementation. The model (3 inputs, 6 anchors, saturation tint, bold weight) is the contract.
- **Adding color to the stat card changes a returned MCP tool result.** The card is shown verbatim by the host LLM in a code block; ANSI escapes may render as raw text in some hosts. Mitigation: the stat card already lives in Claude Code which strips/displays ANSI correctly; for other hosts the worst case is visible escape codes (functional but ugly). Acceptable for v1.

## Followups

- Build the actual feature on a branch `feature/color-progression`. (Branch creation is part of the implementation phase, not the spec.)
- After landing, evaluate whether to revisit out-of-scope items (shimmer, mood, star recolor).
