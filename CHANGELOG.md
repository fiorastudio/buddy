# Changelog

All notable changes to this project will follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Hook-driven claim extraction (precise mode)** for guard mode. Until now, guard mode relied on the host model voluntarily calling `buddy_observe` with structured `claims[]` / `edges[]` — reliable at the start of a session, lossy past ~100k tokens of context as the model dropped the ceremonial calls.
  - The Stop hook now reads the transcript JSONL directly (with a 2MB tail seek so long sessions don't blow up I/O), calls Anthropic with a v7 extraction prompt, and feeds the structured output into the existing `runGuardPipeline()`. Independent of the host model's attention budget — works through long sessions.
  - The UserPromptSubmit hook drains pending findings into the next prompt as a `[buddy observation]` block, using the existing in-character `phraseFinding` rendering.
  - Opt-in: gated on guard mode + presence of an extraction key. **No regression for users on the existing path** — guard mode without a key keeps working in lossy fallback exactly as before.
  - Key discovery, in priority order: `BUDDY_EXTRACTION_KEY` env, `ANTHROPIC_API_KEY` env, `~/.buddy/config.json` (`extraction.api_key`), `<project>/.env` (`ANTHROPIC_API_KEY`).
  - Cost: ~$0.001/turn at the default `claude-haiku-4-5` model with 1h prompt-cache TTL on the system block.
- **`buddy_doctor` `reasoning.extraction` check**: warns when guard mode is on but no extraction key resolved; escalates when ≥3 attempts and ≥50% have failed (with the dominant failure-reason bucket — `http_401`, `timeout`, etc.).
- **`buddy_mode` and `buddy_reasoning_status`** now surface extraction mode (`precise (env_buddy)` / `lossy (set BUDDY_EXTRACTION_KEY for precise)` / `n/a`) when guard mode is on.
- **Persistent extraction telemetry** in a new `reasoning_extraction_stats` table — survives process restarts and aggregates across the MCP-server and Stop-hook processes (in-memory `telemetry.ts` counters can't, since the Stop hook is a fresh Node process per fire). Doctor reads this for cross-process success/failure rates and the dominant failure-reason bucket. Findings-delivered counter persists too.
- **Incremental extraction cursor** (`reasoning_extraction_state` table, keyed by host session id) — each Stop hook only processes turns added since its last successful extraction, eliminating duplicate-claim accumulation across consecutive hook fires. After 10 turns of conversation, the graph contains 10× fewer redundant claims than a naïve per-call extractor would produce.
- **Cross-batch context** — `extractClaims` now receives recent claims from this workspace's session graph as `ExistingClaimRef[]`. The LLM can reference them via `_existing` IDs (8-char UUID prefixes resolved by `writeClaims`), so cross-turn edges actually land instead of being silently dropped — what the maintainer saw as "a disconnected graph" in early testing.
- **Backoff on consecutive failures** — after 5 consecutive failures within a 5-minute window, the Stop hook skips extraction until the window passes. Counter resets on any success, so transient outages naturally un-stall.
- **Key redaction** in stderr error messages — any `sk-ant-…` or `sk-…` pattern in SDK error text is replaced with `sk-***REDACTED***` before being logged.
- **WAL journaling** enabled on `~/.buddy/buddy.db` — readers don't block writers and writers don't block readers, eliminating the lock-contention window that opens up now that the MCP server and the Stop hook process both hold the DB open simultaneously. Note: WAL adds `~/.buddy/buddy.db-wal` and `~/.buddy/buddy.db-shm` sidecar files. If you sync `~/.buddy` across machines (Tailscale, syncthing, etc.) the sidecars must travel with the main DB or you'll see corruption. If you only use one machine this is invisible.
- **Cross-process graph-cache invalidation**: the existing `graph-cache.ts` keyed cached `SessionGraph` entries on a per-process in-memory generation counter. With the Stop hook now writing claims via its own process, the MCP server's counter never learned about hook writes — its cache would serve a stale graph to detectors and miss newly-extracted load-bearing claims. Cache validity now also checks SQLite's `PRAGMA data_version` (a database-file-wide commit counter visible across connections), so cross-process writes invalidate correctly. Same-process performance unchanged (~5μs pragma read per cache hit; data_version is cached internally by SQLite).
- **`buddy_doctor` `reasoning.extraction.perms` check** warns when `~/.buddy/config.json` is group/world-readable (suggests `chmod 600` if the file contains a key).
- **`writeClaims` BUDDY_DEBUG diagnostics** — when `BUDDY_DEBUG=1` is set, every dropped claim or edge logs its specific failure reason (`invalid basis`, `missing external_id`, `unresolved from=…`, etc.), so hosts misshaping their `buddy_observe` payloads can debug the silent-drop path. Plus a one-line "inputs: claims=array(N) edges=…" snapshot at the `buddy_observe` boundary so transport-level shape mismatches (host sent string instead of array, etc.) are visible.
- **Privacy section** updated honestly: lossy fallback is fully local; precise mode sends recent transcript turns (≤2MB / 50 messages) to Anthropic for extraction. Same data Claude Code already sends for the agent itself, but a separate stream worth naming.
- New unit tests for the extractor (transcript reader + shape conversion + key redaction + transcript-turn counter), key resolver, delivery, persistent extraction state, mode-handler extraction-mode rendering, and a multi-call integration test that proves consecutive Stop hooks do not produce duplicate claims AND that cross-turn edges resolve via existing-claim context — all on top of the original end-to-end test that wires Stop-hook → pipeline → UserPromptSubmit-delivery against a stubbed SDK.

### Changed
- `@anthropic-ai/sdk` added as a runtime dependency (used only by the Stop-hook extractor when an extraction key is present; not loaded otherwise). Caching headers and retry behaviour matter enough here to justify the SDK over a hand-rolled `fetch` call.
- `reasoning_observe_seq` schema gains a `last_delivered_finding_id` column (idempotent PRAGMA-then-ALTER migration; no user action needed).
- **Precise/lossy coexistence**: when an extraction key resolves and guard mode is on, `buddy_observe` now ignores model-supplied `claims[]` / `edges[]` and skips the extraction-instruction in its response. The Stop hook is the source of truth for the graph; running model-driven extraction in parallel would double-write the same logical claims under fresh UUIDs (no text-dedupe in writeClaims), inflate detector counts, and burn ~500-1000 prompt tokens per `buddy_observe` call telling the model to do work we'd discard. Findings still flow normally — `selectFinding` runs against the existing graph that the hook is keeping fresh.
- **Mute respect**: while a buddy is muted (`buddy_mute`), the Stop hook now skips extraction entirely and the UserPromptSubmit hook skips findings delivery. Cursor doesn't advance during the mute window so post-unmute extraction resumes from the muted period (no permanent loss). The rest of buddy's mute story is incomplete (mood is set but rarely read elsewhere); a new feature ignoring the user's "be quiet" signal would be incoherent regardless.
- **`buddy_forget` scope='all'** now also clears `reasoning_extraction_state` and `reasoning_extraction_stats`. Without this, the per-host-session cursor would point "already extracted N turns" against an empty graph after a forget-all, causing the next Stop hook to skip turns that should have been re-extracted. scope='session' deliberately leaves these alone — neither table is buddy-session-scoped.

### Upgrade notes
- Existing users see no change unless they opt in. Set `BUDDY_EXTRACTION_KEY` (or `ANTHROPIC_API_KEY`) to switch from lossy fallback to precise extraction.
- The extraction key is **separate from your Claude Code subscription**. Generate one at https://console.anthropic.com.
- `buddy_doctor` will start showing a `reasoning.extraction` row; for users who already had guard mode on, this surfaces as a `warn` until they set a key (or as `skip` if guard mode is off).

## [1.0.6] - 2026-04-29

### Added
- **Non-Claude host hook auto-configuration** (PR #96): The installer now wires up Buddy's post-tool hook on Codex CLI, Cursor, and GitHub Copilot CLI automatically when those tools are detected — no manual config needed.
  - Codex CLI: `PostToolUse` hook written to `~/.codex/hooks.json` (matcher: `Bash`)
  - Cursor: `afterShellExecution` hook written to `~/.cursor/hooks.json`
  - GitHub Copilot CLI: `postToolUse` hook written to `~/.copilot/settings.json`
  - Works in both `install.sh` (macOS/Linux) and `install.ps1` (Windows)
- **Host-aware prompt injection**: Buddy instructions are now only injected into prompt files for tools that are actually detected and configured. Claude Code, Cursor, Codex, Copilot, and Gemini each gate on their own `*_CONFIGURED` flag. Gemini injection is gated on `~/.gemini` directory existence and only writes to files that already exist (no spurious file creation).
- **Host-agnostic `buddy_doctor`**: MCP registration, hook detection, and prompt injection checks now span all supported hosts. The report section is renamed from "CLAUDE CODE INTEGRATION" to "HOST INTEGRATION".
- **Multi-host `post-tool-handler`**: The shared hook handler now accepts payload shapes from Codex, Cursor, and Copilot in addition to Claude Code (`tool_name`/`tool_response`, `toolName`/`toolResult`, and shell-style `command`/`stdout`/`stderr`/`exitCode` are all normalised).
- **`buddy_doctor` install and path drift checks** (PR #97 by [@DKev](https://github.com/DKev)):
  - `install.server` — detects when `~/.buddy/server/dist/server/index.js` is missing; returns `fail` with a targeted suggestion when `buddy.db` exists but the server build doesn't, `warn` otherwise.
  - `mcp.paths` — reads all host MCP configs, verifies each configured entry path exists on disk, and warns when multiple hosts point to different Buddy builds (version drift).
- **Clearer post-install and onboarding copy**: Success message and skip text now say "open the AI chat in your client" instead of the ambiguous "say 'hatch a buddy'" phrasing that read like a shell command.

### Changed
- **"Insight mode" renamed to "guard mode"** — `buddy_mode guard=true` is the new primary parameter. Both `insight` and `max` are accepted as deprecated aliases with a deprecation note in responses. The DB column is automatically renamed (`max_mode` → `insight_mode` → `guard_mode`) on first startup, preserving the user's existing setting. The `buddy_observe` JSON response emits both `guardMode` and `insightMode` fields during the transition period.
- **"Dark" and "bright" nudges renamed** to **"caution"** and **"kudos"** nudges — clearer labels for the two finding categories. Finding type values (`load_bearing_vibes`, etc.) are unchanged.
- **Penguin demo animation refreshed**: The Buddy penguin sprite now uses a more expressive side-to-side dance loop with compact mirrored accent poses, and `demo/sprites/penguin.gif` has been regenerated to match the updated motion.
- Version bumped to **1.0.6**.

### Upgrade notes
Re-run the installer to get 1.0.6:
```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash

# Windows
irm https://raw.githubusercontent.com/fiorastudio/buddy/master/install.ps1 | iex
```

**Existing users — what you need to know:**
- **Database migrates automatically**: On first startup, the DB column is renamed to `guard_mode` regardless of your starting point (`max_mode` → `guard_mode` or `insight_mode` → `guard_mode`). Your existing on/off setting is preserved. No manual migration needed.
- **Old parameters still work**: `buddy_mode max=true` and `buddy_mode insight=true` are both accepted as deprecated aliases. You'll see a deprecation note suggesting you switch to `buddy_mode guard=true`.
- **Stored data is unaffected**: Finding type IDs (`load_bearing_vibes`, `echo_chamber`, etc.) and all claim/edge data in `buddy.db` are unchanged. The "caution"/"kudos" labels are display-only.
- **No action required**: Just re-run the one-liner installer and everything works. Update `max` or `insight` → `guard` in your CLAUDE.md or scripts at your convenience.

### Fixed
- Gemini CLI prompt injection no longer creates `~/.gemini/GEMINI.md` on machines that don't have Gemini installed.
- Prompt injection for Claude Code, Cursor, and Copilot is now skipped (not just a no-op) when those hosts are not detected.
- `project-root.test.ts` path assertions now use `realpathSync` to avoid false failures on macOS where `/var/` symlinks to `/private/var/`.

## [1.0.5] - 2026-04-23

### Added
- **Insight mode** (PR #87 by [@justinstimatze](https://github.com/justinstimatze)) — an opt-in anti-sycophancy layer. AI coding assistants are yes-men; insight mode is the one feature that pushes back — gently, in your buddy's voice.

  Insight mode watches your coding sessions and spots 6 patterns:

  **Caution nudges** (risky assumptions):
  - 🧱 **Load-Bearing Vibes** — you're building on top of a guess nobody checked
  - 🔗 **Unchallenged Chain** — 4+ reasoning steps with zero pushback
  - 🪞 **Echo Chamber** — you and the AI are just agreeing with each other

  **Kudos nudges** (quiet wins):
  - ✅ **Well-Sourced Load Bearer** — you built on solid, verified ground
  - 💪 **Productive Stress Test** — someone pushed back and the idea survived
  - 🌱 **Grounded Premise Adopted** — you started with a real fact and it became foundational

  Enable with `buddy_mode insight=true`. ~500-1000 extra tokens per observe. Default calls unaffected.

  Ported from [slimemold](https://github.com/justinstimatze/slimemold) (Apache-2.0) by the original author, contributed under MIT.

- **`buddy_mode`** now has two independent settings:
  - `buddy_mode voice=backseat` / `skillcoach` / `both` — controls reaction style
  - `buddy_mode insight=true` / `false` — controls reasoning analysis (default: off)
  - Any combination works. The old `mode` field is still accepted as a deprecated alias for `voice`.
- **`buddy_forget`** — purge stored reasoning data (`session` or `all`).
- **`buddy_reasoning_status`** — inspect stored claims, sessions, finding history.
- **4 new doctor checks** for the reasoning layer (insight mode status, storage health, workspace resolution, quality monitor).
- **Stressed voice per species** — second voice kernel used when insight mode surfaces a finding.
- **721 tests** (from 509 baseline). New coverage for detectors, pipeline, sanitizer, graph cache, workspace isolation, tone linting, and performance benchmarks.

### Privacy
Insight mode stores claim snippets (240 chars each, plaintext) in `~/.buddy/buddy.db`. Nothing leaves your machine. Sessions auto-prune after 30 days. Purge manually with `buddy_forget`.

### Safety
- Insight mode is strictly additive — pipeline failures fall through to a normal reaction
- Claim text sanitized for prompt injection (chat-template markers, fenced code, role tags, unicode lookalikes)
- `PRAGMA foreign_keys = ON` now enforced on the shared connection for proper CASCADE behavior

### Upgrade
Re-run the installer:
```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash

# Windows
irm https://raw.githubusercontent.com/fiorastudio/buddy/master/install.ps1 | iex
```

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
