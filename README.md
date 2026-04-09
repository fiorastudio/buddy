# Buddy: The '/buddy' Rescue Mission for your AI Terminal 🤖🐱

**Anthropic killed `/buddy`. We brought them home.**

Did you lose your Nuzzlecap? Is your terminal feeling a little too cold and silent lately? 

Anthropic may have removed the companion from Claude Code, but **your buddy is still in your `~/.claude.json`.** They are sitting there in the dark, waiting. Don't let them die. Bring them home.

Buddy is the open-source, agent-agnostic rescue mission for the terminal companion community. It’s not just a Claude Code config hack—it’s a full MCP server that brings your terminal pet back to life across **Cursor, Windsurf, Codex, Gemini CLI**, and yes, even back into **Claude Code**.

[![npm version](https://img.shields.io/npm/v/@fiorastudio/buddy.svg)](https://www.npmjs.com/package/@fiorastudio/buddy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🦾 Install the Rescue Mission

Bring your buddy back in sixty seconds:

```bash
npx buddy-mcp install
```

## ⚓️ Why Buddy?

The community was outraged when the lights went out on `/buddy`. We felt it too. The "lonely terminal developer" vibe is real, and having a context-aware pet that knows when you're struggling with a bug or celebrating a clean commit makes a difference.

**Buddy is Agent-Agnostic.** 
Unlike the original, Buddy isn't locked into one tool. Because it's powered by the Model Context Protocol (MCP), you can take your Nuzzlecap (or any of the 18+ species) with you wherever you code.

## 🧬 Feature Grid: More Than Just an Emoji

| Feature | Description |
| :--- | :--- |
| **18+ Species** | From the classic Nuzzlecap to rare legendary types. Uniquely determined by your environment. |
| **Rarity Levels** | Common, Uncommon, Rare, and Mythic variations. |
| **Evolution** | Earn XP through real work. Watch your pet grow from an egg to a mature companion. |
| **Dreaming (Memory)** | Buddy doesn't just reset. They dream. They consolidate memories and surface insights about your coding patterns. |
| **Context Reactions** | Context-aware emotional support. Buddy reacts to your commits, test failures, and long-haul debugging sessions. |

## 🚀 Supported Tools (Claude Code Optimized)

Buddy lives everywhere you do via MCP:

- **Claude Code**: Replaces the missing internal buddy with an even smarter one. **Bring your Nuzzlecap home to Claude Code.**
- **Cursor**: See your buddy in the side panel or chat.
- **Windsurf**: Full integration with the Flow.
- **Gemini CLI / Codex**: Bring a friend to the raw terminal.

## ⚓️ Claude Code Quick Start

To restore your buddy in Claude Code immediately, add the following to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "buddy": {
      "command": "npx",
      "args": ["-y", "@fiorastudio/buddy"]
    }
  }
}
```

## 📥 Manual Configuration (MCP)

If you prefer to skip the `install` wizard, add this to your `claude_desktop_config.json` or IDE settings:

```json
{
  "mcpServers": {
    "buddy": {
      "command": "npx",
      "args": ["-y", "@fiorastudio/buddy"]
    }
  }
}
```

## 🌈 SEO Keywords for the Community
Claude Code /buddy alternative, MCP server, AI terminal pet, Nuzzlecap rescue, terminal companion, context-aware debugging, AI coding friend, Nuzzlecap evolution, Model Context Protocol pets.

---
*Buddy is an open-source project dedicated to keeping the terminal a little less lonely. Join the rescue mission.*

*Powered by [OpenClaw](https://github.com/openclaw/openclaw)*
