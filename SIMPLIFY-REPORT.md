# Simplify Report — v1.0.0 Code Review

Generated from three parallel review agents (reuse, quality, efficiency).

## HIGH PRIORITY — Fix Now

### 1. BUDDY_STATUS_PATH duplicated in 4 files
- `companion.ts:15`, `server/index.ts:35`, `statusline-wrapper.ts:16`, `post-tool-handler.ts:14`
- All define: `const BUDDY_STATUS_PATH = join(homedir(), ".claude", "buddy-status.json")`
- **Fix**: Extract to `src/lib/constants.ts`

### 2. ANSI color codes duplicated in 2 files
- `cli/onboard.ts:18-26` and `statusline-wrapper.ts:8-13`
- Same hex values, same names
- **Fix**: Extract to `src/lib/ansi.ts`

### 3. `as any` casts everywhere (13 occurrences)
- `server/index.ts` has 12 `db.prepare(...).get() as any` casts
- `statusline-wrapper.ts` has 1 bones cast
- **Fix**: Define `CompanionRow` type, use throughout

### 4. ~~Dead code: `hasActiveReaction()` in post-tool-handler.ts~~ FALSE POSITIVE
- Function is exported and has 4 dedicated tests in hooks.test.ts
- Logic is also inlined in `writeConcernedReaction()` for single-pass, but the standalone function is a valid utility

### 5. Copy-paste: observe/pet tool handlers
- `buddy_observe` and `buddy_pet` have nearly identical XP award + mood recalc + status write
- **Fix**: Extract `awardXpAndUpdateMood(rowId, eventType, leveledUp)` helper

### 6. Copy-paste: createCompanion/rescueCompanion in companion.ts
- ~45 lines of near-identical DB insert + companion object construction
- **Fix**: Extract shared `_insertCompanion()` helper

### 7. Copy-paste: nameInfo/moodInfo in statusline-wrapper.ts
- Identical construction in both normal layout and speech bubble layout paths
- **Fix**: Compute once before the conditional branch

### 8. `SELECT * FROM companions LIMIT 1` repeated 10+ times
- Same query scattered across server/index.ts
- **Fix**: Use `companionExists()` from companion.ts (already exported)

## MEDIUM PRIORITY — Should Fix

### 9. Text box border rendering duplicated
- `card.ts:18-21` and `bubble.ts:42-49` both create `.___.`/`'___'` borders
- Word-wrap logic also duplicated between card.ts and bubble.ts
- **Fix**: Extract shared `wrapText()` and box border functions

### 10. recalcMood makes 2 DB queries that could be 1
- `SELECT * FROM xp_events` (fetches all rows) + `SELECT count(*) FROM memories`
- Only `.length` is used from xp_events
- **Fix**: Use `SELECT count(*)` for both, combine into one query

### 11. `replaceAll('{name}', '{name}')` no-op in observer.ts
- Line in BOTH_TEMPLATES computation — replaces placeholder with itself
- **Fix**: Remove the no-op

### 12. Stringly-typed tool names
- `if (name === "buddy_hatch")` scattered across server/index.ts
- **Fix**: Define `const TOOL_NAMES = { ... }` constant object

## LOW PRIORITY — Nice to Have

### 13. Level calculation O(50) loop per XP award
- Could precompute cumulative XP thresholds as a lookup table
- Practical impact is negligible (50 iterations of simple math)

### 14. Self-healing UPDATE on every loadCompanion
- Runs even when level matches — the comparison is cheap but the branch is always taken
- Already optimized with `row.level !== derivedLevel` guard

### 15. Species ambient text could be in its own module
- 21 species x 4 lines in statusline-wrapper.ts — large data block inline

### 16. Animation fallback path recalculates tick
- `statusline-wrapper.ts:146` recalculates `Date.now() / FRAME_INTERVAL_MS` when the same `tick` was computed at line 108
- **Fix**: Reuse the `tick` variable
