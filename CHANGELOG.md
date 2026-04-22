# Changelog

All notable changes to this project will follow [Semantic Versioning](https://semver.org/).

## [1.0.4] - 2026-04-22

### Added
- **Stop and UserPromptSubmit hooks** (PR #85): Two new hook handlers for robust automatic statusline reactions without relying on CLAUDE.md prompt injection. `stop-handler` detects task-completion signals in assistant output via regex (zero token cost). `prompt-handler` detects buddy name mentions, frustration keywords, and excitement signals in user input. Both are async with short timeouts and race-protected writes.
- **341 new tests** for hook handlers (stop-handler: 165 lines, prompt-handler: 176 lines) covering regex patterns, race protection, field fallbacks, and graceful failure.
- **Doctor diagnostics** now check for all three hook types (PostToolUse, Stop, UserPromptSubmit).

### Upgrade
Re-run the installer to get the new hooks registered:
```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash

# Windows
irm https://raw.githubusercontent.com/fiorastudio/buddy/master/install.ps1 | iex
```

## [1.0.3] - 2026-04-22

### Added
- **Verbatim card display:** `buddy_hatch`, `buddy_status`, and `buddy_pet` now include DISPLAY VERBATIM directives so LLMs render ASCII art in code blocks instead of summarizing or truncating it.
- **`renderMarkdownBubble`:** New rendering function for consistent markdown-formatted buddy output (code block for art + blockquote for reactions). Wired into `buddy_pet`; replaces inline markdown duplication.
- **Observer FORMAT_INSTRUCTION:** All observer modes (backseat, skillcoach, both) now include a structured format prompt so LLM reactions use consistent emote + blockquote formatting.
- **8 new tests** for `renderMarkdownBubble` covering code block structure, blockquote formatting, blank-line preservation, and edge cases.
- **Buddies Rescued stats monitor:** Automated GitHub Actions workflow tracking clone/rescue statistics with daily updates.
- **Rescue wall and community stats** in README.

### Fixed
- **Rescue seed priority** (PR #84 by [@longestpath](https://github.com/longestpath)): `rescueCompanion` now prefers `accountUuid` over `userId` as the CC-compatible seed. When both fields are present in `~/.claude.json`, the previous ordering produced different stats than the original CC hatch. Also broadened `hasCCUserId` to include `accountUuid`-only records so `cc_rescue=1` is set correctly.
- **Statusline compatibility:** Demo-compatible Claude HUD integration improvements.

### Docs
- Added "Works with" section to README (PR #79, PR #80)
- Added [@longestpath](https://github.com/longestpath) to contributor special thanks
- Updated buddy_mode description in README

### Upgrade
Re-run the installer to get the latest version:
```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash

# Windows
irm https://raw.githubusercontent.com/fiorastudio/buddy/master/install.ps1 | iex
```
If you previously rescued a CC buddy with wrong stats (seed used `userId` instead of `accountUuid`), respawn and re-rescue:
1. Say "buddy respawn" to release the current companion
2. Re-run the installer (or `node ~/.buddy/server/dist/cli/onboard.js`)
3. Select "Rescue [name]" — stats will now match your original Claude Code buddy

## [1.0.2] - 2026-04-17

### Fixed
- **Rescue species detection:** Companion name is now scanned for species keywords (e.g., "Grit**blob**" → Blob). Previously only personality text was checked, causing many rescued buddies to get the wrong species.
- **Rescue stats mismatch:** CC-rescued buddies now get exact original stats via Bun wyhash. Claude Code runs on Bun which uses a different hash (wyhash) than our FNV-1a — same userId produced different stats. `rollWithCCCompat()` shells out to Bun to reproduce the original hash. Falls back to FNV-1a with a warning if Bun is not installed.
- **Stats persistence after rescue:** Added `cc_rescue` flag to DB schema. `loadCompanion` now uses the CC-compatible hash for rescued buddies on every load, not just during the initial rescue display.
- **Top-level userID:** `parseOldBuddy()` now pulls `userID` from top-level `.claude.json` (where Claude Code stores it), not just from the companion sub-object.
- **Security:** Replaced `execSync` with `spawnSync` for Bun hash computation to prevent command injection via crafted `.claude.json` data.

### Upgrade
Re-run the installer to get the latest version:
```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash

# Windows
irm https://raw.githubusercontent.com/fiorastudio/buddy/master/install.ps1 | iex
```
If you previously rescued a CC buddy with wrong stats, respawn and re-rescue to get the correct stats:
1. Say "buddy respawn" to release the current companion
2. Re-run the installer (or `node ~/.buddy/server/dist/cli/onboard.js`)
3. Select "Rescue [name]" — stats will now match your original Claude Code buddy

## [1.0.0] - 2026-04-16

Built in a week (April 9–16). Pays homage to the original Claude Code buddy while adding our own design flair.

### Added
- 21 companion species with unique ASCII sprites (4-5 animation frames each)
- Deterministic companion generation from user ID (Mulberry32 PRNG + FNV-1a hash)
- 5 personality stats: DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK
- Weighted rarity system: common, uncommon, rare, epic, legendary
- 6 eye styles, 7 hat styles, shiny variants
- Exponential XP/leveling system (max level 50)
- Observer system with backseat + skillcoach modes
- Template fallback reactions with keyword inference
- Reaction states with eye overrides and statusline indicators
- Speech bubble visibility via bubble_lines in statusline + PostToolUse hook for Bash errors
- Rich personality bios (21 species x 3 templates)
- Species voice kernels and NEVER constraints for AI roleplay (per-species voice + 2 behavioral guardrails)
- Pokemon-style hatch animation + rescue animation for imported companions
- Two-path onboarding wizard during install:
  - **Rescue mode**: imports your old Claude Code buddy from `~/.claude.json` — uses original CC userID for deterministic restoration (same name, species, stats, eye, rarity)
  - **Hatch mode**: fresh companion with random species, stats, and personality
  - Interactive arrow-key menu with `--non-interactive` and `--no-onboard` flags for CI
- Choreographed animation sequences (15-frame idle cycle, species-aware profiles with per-species dwell timing)
- Species-aware animation engine (`src/lib/animation.ts`): `AnimationProfile` type system, `defaultProfile` factory, reaction-driven frame cycling
- Pet-hearts statusline overlay (cycling ♥ row above sprite for ~5s after petting)
- Bubble fade/dim (ANSI dim in final 3s of speech bubble TTL before expiry)
- Dwell-based ambient text (seededIndex determinism, no flicker, 15-20s dwell windows)
- Statusline integration (side-by-side with claude-hud, full speech bubble rendering, `refreshInterval: 2`)
- Mood recalibration on every interaction (observe, pet, status) + happy on level-up
- Self-healing level derivation from XP (loadCompanion always derives level, heals stale DB)
- Name sanitization (prompt injection protection: unicode control chars, template injection, 40-char limit)
- Install scripts for Claude Code, Cursor CLI, Codex CLI, Gemini CLI, GitHub Copilot CLI
- AGENTS.md detection: Codex/Gemini/Copilot CLIs prefer AGENTS.md with CLI-specific fallbacks
- --no-onboard flag for CI/scripted installs
- Semantic versioning with dynamic version from package.json
- PostToolUse hook handler for Bash error detection (word-boundary regex, race protection)
- AI relay fallback instructions for non-Claude CLIs (speech bubble display directive)
- Extracted companion.ts (shared creation logic) and card.ts (shared rendering) for CLI + server reuse
- MCP tools: buddy_hatch, buddy_status, buddy_observe, buddy_pet, buddy_mute/unmute, buddy_remember, buddy_dream, buddy_respawn
- Species-specific deterministic name generation (two-pool combos: ~100 unique names per species, seeded from userId)
- Redesigned sprites: Void Cat (cat body + omega mouth + tail), Owl (round body + v beak), Snail (antennae + growing trail), Data Drake (wider, faithful to CC original), Rabbit (long ears + buck nose)
- Sprite alignment fixes across all 21 species (consistent rendered widths, no statusline jitter)
- Animated GIF sprites for all 21 species in demo/sprites/
- Test DB isolation (tests use temp DB, never touch production ~/.buddy/buddy.db)
- MCP resources: buddy://companion, buddy://status, buddy://intro (with VOICE + NEVER sections)
- 439 tests (core, species, observer, self-healing, personality, hooks, companion, onboarding, names, animation stability, blink parity, width consistency)
