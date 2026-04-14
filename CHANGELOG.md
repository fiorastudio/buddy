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
- Speech bubble rendering for immediate visual feedback
- Rich personality bios (21 species x 3 templates)
- Species voice kernels and NEVER constraints for AI roleplay
- Pokemon-style hatch animation
- Statusline integration (side-by-side with claude-hud)
- Mood system based on interaction frequency
- Self-healing level derivation from XP
- Name sanitization (prompt injection protection)
- Install scripts for Claude Code, Cursor CLI, Codex CLI, Gemini CLI, GitHub Copilot CLI
- MCP tools: buddy_hatch, buddy_status, buddy_observe, buddy_pet, buddy_mute/unmute, buddy_remember, buddy_dream, buddy_respawn
- MCP resources: buddy://companion, buddy://status, buddy://intro
- 246+ tests (core, species, observer, self-healing)
