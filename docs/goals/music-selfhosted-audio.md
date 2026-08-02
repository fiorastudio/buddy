# Goal: self-hosted plaza music (remove the YouTube embed)

## Problem
Buddy World's plaza music is a **YouTube playlist embed**. YouTube's ToS
("Required Minimum Functionality") forces the embedded player to be ≥200×200 and
**visible**, so every music session pops an ugly iframe/modal. It also makes a
third-party (YouTube) request and ties the experience to external availability.

## Goal (definition of done)
Replace the YouTube embed with **self-hosted, original, royalty-free audio** that
delivers the same *emotional experience* (cozy, nostalgic, warm MMO-town feel),
with **no visible player, no third-party request, no copyright exposure.**

A working local version means:
1. The 🎵 button toggles a looping ambient track via a hidden `<audio loop>` — no
   iframe, no modal.
2. The track is served from `world/public/music/` (static asset on the Worker /
   local server). No YouTube.
3. Opt-in preserved: `preload="none"`, so **zero** network/audio until the user
   clicks.
4. Full test suite green, including the rewritten opt-in test asserting **no
   iframe ever** appears.
5. Runs locally: serve `world/public/` and confirm the button plays/stops the
   looping track with no visible player.

## Non-goals / explicitly rejected
- ❌ Downloading and "reshaping" the original Ragnarok Online OST. Reshaping a
  copyrighted recording produces an infringing **derivative work** — it does not
  clear the rights and is riskier than the current official embed. Rejected.
- Themed per-district music (districts are numbered capacity shards today, not
  themed towns). Possible later; out of scope here.

## Approach
- **Music source:** generate ORIGINAL instrumental tracks with Suno from a
  *genre/mood* description (style/vibe is not copyrightable; specific melodies and
  recordings are). Prompts live in `world/public/music/README.md`. The prompts
  deliberately never name RO or any track — they evoke the feeling, not the work.
- **Files:** `plaza-theme.ogg` (primary, small) + `plaza-theme.mp3` (fallback),
  dropped into `world/public/music/`.
- **Packaging:** `world/` is excluded from the npm package (`files` allowlist), so
  audio adds **zero** bloat for installers — it only ships to the deployed Worker.

## Verification
- `npx vitest run src/__tests__/world/plaza-smoke.test.ts` → green (opt-in test
  now asserts no iframe + audio wired).
- Local smoke: serve `world/public/` and click 🎵 → looping track plays, no
  visible player; click again → stops.
