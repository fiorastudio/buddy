# HANDOFF — Buddy World plaza + choose-your-town teleport

> **Temporary handoff doc.** Delete before merging PR #147 into the release.
> Written 2026-07-30 for an agent picking up in a different environment.

## TL;DR
This branch (`feat/buddy-world-main`) is the **canonical** Buddy World plaza branch.
**PR #147 → `integration/2.0.0` is open and validated, awaiting merge.**

## What's on this branch (7 commits on top of `integration/2.0.0`)
1. ASCII sprite legibility (WCAG-AA contrast)
2. Saturated sprite color, dropped the heavy outline
3. Dropped the frosted backing plate behind sprites
4. Authentic per-city RO music + distinct town palettes/weather
5. Per-town flora — pines (Lutie), cacti (Morroc), palms (Alberta), autumn (Payon), leafy (Prontera/Geffen)
6. RO-blue jukebox (YouTube music styled as a classic RO window; ToS-compliant ≥200×200 visible; 🎵/✕ both stop)
7. **Choose-your-town teleport** — the headline feature

## Choose-your-town teleport — how it works
Owners pick their buddy's home RO city instead of capacity-sharding assigning one.
- `buddy-world teleport <town>` → puts the buddy in that town; re-running with a different town **moves** it.
- `buddy-world towns` → lists the 6 cities + blurbs.
- `buddy-world status` → names the town.
- **CLI-only by design — NO new MCP tool** (user's explicit token-budget constraint). A `/teleport` skill is the future-ergonomics path, never a tool.

Key files:
- `src/lib/world/towns.ts` — town name ⇄ `plaza-N` registry (ordered to match `world/public/plaza.js` `TOWNS[]`; drift-guarded by `src/__tests__/world/towns-drift.test.ts`).
- `src/lib/world/store.ts` + `d1-store.ts` — `teleport(tokenHash, snap, now, desiredDistrict?)`; sets district on create, UPDATEs it on re-teleport (the "move" path). Both impls verified via shared `describe.each`.
- `src/lib/world/handlers.ts` — `handleTeleport` resolves a town name/`plaza-N` from the request body, returns `400 unknown_town` / `409 town_full` (never bounces an existing occupant re-syncing).
- `src/lib/world/client.ts` — `teleport(snapshot, { district })`; the worker forwards the whole body, so no route change.
- `src/cli/world-cli.ts` — `teleport [town]`, `towns`, town-aware `status`.

## Validation status
- `npx tsc --noEmit` clean.
- `npx vitest run src/__tests__/world/` — 63 teleport/store/handler/CLI/drift tests green.
- **Full E2E passed** (real worker + SqliteWorldStore + puppeteer browser): buddies land in their chosen town for all 6 cities; moving a buddy relocates it (gone from old plaza, present in new); each town renders its distinct palette + per-town music label. 7/7 API + 2/2 browser checks.
- **Known-flaky (NOT this branch's fault):** 2 `plaza-smoke` pixel tests (`jitter`, `RO essence`) fail under heavy local machine load (headless-Chromium rAF starvation) — pre-existing, verified by stashing edits. Pass on a freed machine / CI.

## How to merge PR #147
It's `MERGEABLE` (no conflicts) but `BLOCKED` by a GitHub **ruleset** — this repo admin-merges its protected branches:
```
gh pr merge 147 --merge --admin --delete-branch
```
Integration only moved ahead by the installer ABI fix (#149), which is installer-only and does not touch plaza files, so **no conflict** and a rebase is optional. Backup tags exist: `backup/buddy-world-main-prerebase`, `backup/choose-your-town-prerebase`.

## Ship path for 2.0.0 (still pending)
1. Merge #147 → `integration/2.0.0`.
2. Merge `integration/2.0.0` → `master` (installers pull master = release).
3. Cloudflare deploy (wrangler) + live teleport E2E against the deployed Worker — still pending.

## Landmines / do-not-touch
- **Stale branches, do NOT build on:** `feat/ro-progression`, `feat/buddy-world` (their work is carried forward here).
- **Old PRs target wrong bases:** #143 (`feat/buddy-world`→master), #144 (`feat/xp-events-blessing`→`feat/buddy-world`) predate the integration strategy — close/retarget, don't merge as-is.
- Unrelated master-targeted PRs #151–158 (detector specs, doctor, penguin frame, hermetic tests, mute persistence) are from other work streams — not part of the plaza feature.
- **Installer saga is DONE and live on master** (node-pin/ABI #142→#146, stale-dir re-clone + build-verify #145/#146, ABI-probe-must-instantiate #148/#149). Don't re-open it.

## Running the plaza locally
The plaza is `world/public/` (`plaza.js` + `index.html`), served by the Cloudflare Worker (`src/world/worker-core.ts`) behind `GET /v1/world/:district`. For a local E2E: build (`npm run build`), stand up an HTTP server that routes `/v1/*` to `createWorldFetchHandler({ db: sqliteAsD1(new Database(':memory:')) })` and serves `world/public/` for everything else, seed via `POST /v1/teleport` (pass `district: '<town>'`), then load `http://localhost:PORT/?district=plaza-3&time=day`. `window.__PLAZA__.citizens` exposes the rendered roster for assertions.

## Future (post-2.0.0, in memory)
- Extract the World **server** into its own repo (client sync + CLI stay in buddy repo).
- Choose a coding-trade at level 50 (agency beyond the auto-derived RO job class).
- Human chibi avatar rendered beside the buddy (the `avatar` field already syncs; deferred).
