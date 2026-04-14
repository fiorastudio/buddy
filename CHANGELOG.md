# Changelog

All notable changes to this project will follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-04-16

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
- Choreographed animation sequences (15-frame idle cycle, 500ms ticks, mood-aware: idle/grumpy/happy patterns)
- Statusline integration (side-by-side with claude-hud, full speech bubble rendering)
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
- MCP resources: buddy://companion, buddy://status, buddy://intro (with VOICE + NEVER sections)
- 318+ tests (core, species, observer, self-healing, personality, hooks, companion, onboarding)
