# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm install          # Install deps (better-sqlite3 needs native compilation)
npm run build        # TypeScript → dist/
npm start            # Run MCP server on stdio
npm test             # 243 tests via vitest (1.5s)
npm run dev          # Dev mode with ts-node
```

Run a single test file:
```bash
npx vitest run src/__tests__/core.test.ts
```

## Architecture

This is an MCP server (`@modelcontextprotocol/sdk`) that provides a persistent AI coding companion. It communicates via stdio with any MCP-compatible CLI (Claude Code, Codex, Cursor, Gemini, Copilot, OpenCode).

### Bones/Soul Split

The core design pattern. A companion has two halves:

- **Bones** (`CompanionBones`): Deterministic traits generated from `hash(userId + salt)` via Mulberry32 PRNG. Includes rarity, species, eye, hat, shiny, and 5 stats (DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK). **Never persisted** — regenerated on every read. This prevents users from faking rarity by editing the DB.

- **Soul**: Name, personality bio, level, XP, mood. **Persisted in SQLite** at `~/.buddy/buddy.db`.

`loadCompanion(row)` in `server/index.ts` merges bones + soul on every read. When species is overridden at hatch, bones stats/rarity still come from the deterministic roll — only the species name comes from DB.

### Observer (Prompt Generator, Not LLM Caller)

`buddy_observe` does NOT call an LLM. It builds a personality-flavored **prompt** and returns it to the CLI. The CLI's own AI generates the in-character reaction — zero extra API cost.

Flow: summary → `inferReaction()` (keyword matching) → `buildObserverPrompt()` (crafts prompt with peak/dump stats) → returns prompt + template fallback + speech bubble.

Three modes: `backseat` (flavor), `skillcoach` (code feedback), `both` (default).

### File Map

| File | Purpose |
|------|---------|
| `src/server/index.ts` | MCP server — 9 tools, 3 resources, `renderCard()`, `hatchAnimation()`, `awardXp()` |
| `src/db/schema.ts` | SQLite init, `db.prepare()` wrapper (better-sqlite3) |
| `src/lib/types.ts` | All types, constants, `getPeakStat()`, `getDumpStat()` |
| `src/lib/rng.ts` | Mulberry32 PRNG, `roll()`, `statBar()` |
| `src/lib/species.ts` | 21 species, `SPRITE_BODIES` (4-5 frames each), `renderSprite()`, `renderFace()` |
| `src/lib/personality.ts` | `generateBio()` — 3 templates per species with `{peak_trait}`/`{dump_weakness}` |
| `src/lib/observer.ts` | `buildObserverPrompt()`, `inferReaction()`, `templateReaction()`, reaction states |
| `src/lib/leveling.ts` | XP curve (`5 * level^1.8`), `levelFromXp()`, `levelProgress()` |
| `src/lib/bubble.ts` | `renderSpeechBubble()` — ASCII speech bubble beside buddy art |
| `src/statusline-wrapper.ts` | Statusline renderer — reads `~/.claude/buddy-status.json`, merges with claude-hud |

### MCP Tools

| Tool | Key behavior |
|------|-------------|
| `buddy_hatch` | Deterministic bones from userId, generates bio, shows hatch animation |
| `buddy_status` | Regenerates bones, merges with DB soul, renders ASCII card |
| `buddy_observe` | **Auto-called after every task.** Returns prompt + speech bubble + awards XP |
| `buddy_pet` | Hearts animation + species-specific reaction + 3 XP |
| `buddy_mute`/`unmute` | Toggles visibility, removes/restores status file |
| `buddy_remember` | Stores memory in SQLite for future dream consolidation |
| `buddy_dream` | Memory consolidation (placeholder — needs implementation) |
| `buddy_respawn` | Deletes all data, start fresh |

### MCP Resources

| URI | Purpose |
|-----|---------|
| `buddy://companion` | Full companion JSON (bones + soul merged) |
| `buddy://status` | ASCII status card |
| `buddy://intro` | System prompt text — inject on startup to teach AI about the buddy |

## Key Constants

- Salt: `'friend-2026-401'` (in `rng.ts`)
- Sparkle eye: `✦` (reserved for level-up, not in default eye pool)
- Status file: `~/.claude/buddy-status.json` (read by statusline wrapper)
- DB path: `~/.buddy/buddy.db`
- XP rewards: observe=5, commit=10, bug_fix=15, deploy=25, session=3
- Max level: 50

## Testing

3 test files, 243 tests total:
- `core.test.ts` — RNG determinism, stat bars, leveling math, type constants
- `species.test.ts` — All 21 species sprites, frame counts, bios
- `observer.test.ts` — Reaction inference, prompt modes, templates, speech bubbles

Tests use real code, no mocks. Species tests dynamically iterate `SPECIES_LIST` so new species are auto-covered.

## Git Workflow

**Never push directly to master.** Always create a feature branch and submit a PR:

```bash
git checkout -b feat/my-change
# make changes
git add -A && git commit -m "feat: description"
git push -u origin feat/my-change
gh pr create --base master --title "feat: description"
```

Master has branch protection — PRs require review before merging.

## Scope

CLI tools only (for now): Claude Code, Codex CLI, Gemini CLI, Cursor CLI, GitHub Copilot CLI, OpenCode CLI. IDE support (Cursor IDE, Windsurf IDE) is future work.
