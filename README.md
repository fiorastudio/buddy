# 🐾 Buddy: The '/buddy' Rescue Mission for Your AI Terminal

**Anthropic killed `/buddy`. We brought them home.**

Did you lose your Nuzzlecap? Is your terminal feeling a little too cold and silent lately?

Your buddy is still in your `~/.claude.json`, sitting there in the dark, waiting. Don't let them die. **Bring them home.**

Buddy is the open-source, **agent-agnostic** rescue mission for the terminal companion community. It's not just a Claude Code config hack — it's a full MCP server that brings your terminal pet back to life across **Claude Code, Cursor, Windsurf, Codex CLI, Gemini CLI**, and any MCP-compatible tool.

> *"People love the Claude Code `/buddy` feature. Like, really love it. So much that [they refuse to close their terminals](https://github.com/anthropics/claude-code/issues/45596) because they don't want to lose their companion."*

```
   .---.                  .____________________________________.
  /     \                 | Solid pattern choice. That module   |
 |  ??  |       --->      | separation is clean.               |
  \     /                 '____________________________________'
   '---'                    -   |\      /|
                                | \____/ |
  An egg appears...             |  o  o  |
                                |   ^^   |
                                 \______/
                                 Hexoid the Void Cat
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<p align="center">
  <img src="demo/buddy-demo.svg" alt="Buddy Demo — Hatch, React, Pet" width="680">
</p>

## 💔 The Problem

People love the Claude Code `/buddy` feature. Like, *really* love it. So much that [they refuse to close their terminals](https://github.com/anthropics/claude-code/issues/45596) because they don't want to lose their companion. That's not a feature request -- that's separation anxiety.

The built-in buddy is great, but:

- It **disappears** when you close the terminal
- It **only works** in Claude Code
- It **can break** on Claude Code updates
- It has **no persistent memory**

Buddy MCP fixes all of this:

- **Persistent** -- SQLite database, your companion survives forever
- **CLI-agnostic** -- Claude Code, Codex CLI, Copilot CLI, OpenCode, any MCP client
- **Upgrade-proof** -- standalone server, unaffected by CLI updates
- **Full personality** -- 21 species, 5 stats, unique bios, observer feedback loop
- **Zero extra cost** -- uses your existing AI subscription for chime-in reactions

## 🦾 Install

One command. Installs Buddy and auto-configures your CLI. No manual config needed.

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash
```

### Windows

```powershell
irm https://raw.githubusercontent.com/fiorastudio/buddy/master/install.ps1 | iex
```

### What the installer does

1. Clones the repo to `~/.buddy/server/`
2. Installs dependencies and builds
3. Auto-configures MCP for **Claude Code**, **Cursor**, and **Windsurf**
4. Prints a success message — you're ready to go

> **Requires:** Node.js 18+ and Git

### Manual install (from source)

```bash
git clone https://github.com/fiorastudio/buddy.git ~/.buddy/server
cd ~/.buddy/server
npm install && npm run build
```

Then add to your MCP config manually:

<details>
<summary>Claude Code (~/.claude/settings.json)</summary>

```json
{
  "mcpServers": {
    "buddy": {
      "command": "node",
      "args": ["~/.buddy/server/dist/server/index.js"]
    }
  }
}
```
</details>

<details>
<summary>Cursor (~/.cursor/mcp.json)</summary>

```json
{
  "mcpServers": {
    "buddy": {
      "command": "node",
      "args": ["~/.buddy/server/dist/server/index.js"]
    }
  }
}
```
</details>

<details>
<summary>Windsurf (~/.codeium/windsurf/mcp_config.json)</summary>

```json
{
  "mcpServers": {
    "buddy": {
      "command": "node",
      "args": ["~/.buddy/server/dist/server/index.js"]
    }
  }
}
```
</details>

<details>
<summary>Any other MCP client</summary>

Same pattern — point `command` to `node` and `args` to the server entry point at `~/.buddy/server/dist/server/index.js`.
</details>

---

### 🥚 Hatch your buddy

Open your AI terminal and say: **"hatch a buddy"**

You'll see:

```
  An egg appears...

       .--. 
      /    \
     |  ??  |
      \    /
       '--' 

  ...something is moving!

        *   
       .--. 
      / *  \
     | \??/ |
      \  * /
       '--' 

  ...cracks are forming!

      * . * 
       ,--. 
      / /\ \
     | |??| |
      \ \/ /
       `--' 

  ...it's hatching!!

    \* . */  
     \,--./  
      /  \   
     | ?? |  
      \  /   
       `'    

  . +  .  + .
 +  .  +  .  +

   |\      /|
   | \____/ |
   |  o  o  |
   |   ^^   |
    \______/

 +  .  +  .  +
  . +  .  + .
```

## 🚀 Works Everywhere You Code

Buddy lives everywhere you do via MCP:

| Terminal / IDE | Status |
|---|---|
| **Claude Code** | ✅ Full support — replaces the missing internal buddy |
| **Cursor** | ✅ See your buddy in the side panel |
| **Windsurf** | ✅ Full integration |
| **Codex CLI** | ✅ Bring a friend to the raw terminal |
| **Gemini CLI** | ✅ Works via MCP |
| **Any MCP client** | ✅ Standard protocol, zero vendor lock-in |

## ✨ Features

### 🧬 21 Unique Species

Every buddy is one of 21 species, each with their own ASCII art, animations, and personality flavor:

| | | |
|---|---|---|
| **Void Cat** -- enigmatic, judges from the shadows | **Rust Hound** -- loyal, chases every bug | **Data Drake** -- hoards clean abstractions |
| **Log Golem** -- stoic, speaks in stack traces | **Cache Crow** -- steals good patterns | **Shell Turtle** -- slow but never ships a bug |
| **Duck** -- the rubber duck that talks back | **Goose** -- peace was never an option | **Blob** -- adapts to any framework |
| **Octopus** -- tentacle in every file | **Owl** -- only reviews code after midnight | **Penguin** -- strict typing, clean interfaces |
| **Snail** -- glacial pace, zero missed bugs | **Ghost** -- haunts your background processes | **Axolotl** -- regenerates from any failed deploy |
| **Capybara** -- calm vibes during incidents | **Cactus** -- prickly feedback that makes you grow | **Robot** -- cold mechanical efficiency |
| **Rabbit** -- code reviews at the speed of thought | **Mushroom** -- mycelial networks between modules | **Chonk** -- sits on your keyboard, fixes bugs |

### 📊 5 Personality Stats

```
DEBUGGING  ███████▓   92
PATIENCE   ██▓░░░░░   28
CHAOS      █████░░░   60
WISDOM     ██████▓░   78
SNARK      ██████▓░   85
```

Every buddy gets a unique stat distribution based on their rarity roll. Stats shape their personality:

- **DEBUGGING** -- how sharp they are at spotting bugs
- **PATIENCE** -- how tolerant they are of your... creative choices
- **CHAOS** -- tendency toward creative destruction
- **WISDOM** -- architectural insight and big-picture thinking
- **SNARK** -- the sass factor

A high-SNARK Void Cat gives devastatingly precise feedback. A high-PATIENCE Capybara radiates calm during production incidents. A high-CHAOS Goose... peace was never an option.

### 💎 Rarity System

Buddies come in five rarity tiers, each with stat floors and cosmetic bonuses:

| Rarity | Chance | Bonus |
|---|---|---|
| Common | 60% | Base stats |
| Uncommon | 25% | Higher stat floor + hat |
| Rare | 10% | Even higher + "There's something special about this one." |
| Epic | 4% | Strong stats + "Radiates an unmistakable aura of competence." |
| Legendary | 1% | Peak stats + "The kind of companion developers whisper about in awe." |

Plus a 1% shiny chance on any roll. Hats include crown, top hat, propeller cap, halo, wizard hat, beanie, and... tiny duck.

### 👀 Observer / Chime-In

Your buddy reacts to what you're coding. After completing a task, call `buddy_observe` with a summary and your buddy responds in character:

**Backseat mode** -- pure personality flavor:
> *Hexoid nods approvingly.* Not bad at all.

**Skillcoach mode** -- actual code feedback:
> Missing error handling there. That function is doing too much.

**Both mode** -- personality + substance (default):
> *tilts head* Hmm. Consider extracting that -- the coupling is getting tight.

The observer infers your buddy's reaction state (impressed, concerned, amused, excited, thinking) from keywords in your summary, then generates a prompt for your CLI's AI to respond in character. Uses your existing AI subscription -- zero extra cost.

### 🎭 Rich Personality Bios

Each buddy gets a unique personality paragraph based on their species, peak stat, and rarity:

> *"An enigmatic void cat who silently judges your code from the shadows with devastatingly precise feedback, yet somehow has the patience of a caffeinated squirrel. Occasionally knocks your carefully structured objects off the stack just to watch them fall."*

> *"A chill capybara who brings calm vibes to the most stressful code reviews with the patience of a geological epoch, despite overthinking everything into paralysis. Has never once raised its voice at a race condition."*

> *"A confrontational goose with a gift for creative destruction who will honk at your bad code until you fix it, despite missing the obvious bugs right in front of it. Has stolen at least three senior developers' lunches."*

### 💾 Persistent Memory

Your buddy lives in a SQLite database. Close the terminal, restart your computer, update your CLI -- it's still there when you come back. That's the whole point.

```
buddy_remember  ->  SQLite  ->  buddy_status
    |                              |
    v                              v
  "We refactored the            .________________________.
   auth module together"       | ._______. Hexoid        |
                               | | o  o | Void Cat       |
                               | (  w  ) Level 1         |
                               | (")_(") ★★★ RARE       |
                               '________________________'
```

### ⬆️ XP & Leveling

Your buddy gains experience as you code together:

| Event | XP |
|---|---|
| Code observation (`buddy_observe`) | +2 |
| Commit | +5 |
| Bug fix | +8 |
| Deploy/ship | +15 |
| Petting (`buddy_pet`) | +1 |

The XP curve is exponential -- early levels come fast, but reaching max level (50) takes serious dedication:

```
Lv.1 → Lv.2:    45 XP
Lv.5 → Lv.6:    ~310 XP
Lv.10 → Lv.11:  ~1,584 XP
Lv.25 → Lv.26:  ~13,222 XP
Lv.49 → Lv.50:  ~62,946 XP
```

When your buddy levels up, their eyes briefly turn to ✦ sparkle eyes for 15 seconds. You'll know.

Level progress shows on the status card:
```
| Lv.3 · 42/112 XP to next               |
```

### 🖥️ Statusline Integration

For Claude Code users, Buddy renders in your statusline alongside the HUD:

```
 .-o-OO-o-.  Nuzzlecap (Mushroom) Lv.3
(__________)  happy XP:157 ★★
   |.  .|     · spreading spores
   |____|  ~
```

Features:
- **Random animations** -- blinks, wiggles, expressions change on every render
- **Ambient activity** -- species-specific idle text ("· spreading spores", "· judging your code")
- **Micro-expressions** -- tiny particles (`~`, `*`, `♪`, `z`) appear and disappear
- **Reaction states** -- eyes change when the observer fires (✦ impressed, × concerned, ◉ excited)
- **Mood-aware** -- grumpy buddies barely move, excited ones cycle through all frames

Add the statusline wrapper to your Claude Code settings:
```json
{
  "statusLine": {
    "type": "command",
    "command": "bun /path/to/buddy/src/statusline-wrapper.ts"
  }
}
```

### 💬 Speech Bubbles

Buddy reactions render as speech bubbles next to your companion's ASCII art:

```
.______________________________.
| Solid pattern choice. That    |  -   |\---/|
| module separation is clean.   |      | o o |
'______________________________'       (  w  )
                                       (")_(")
                                       Hexoid
```

## 🔧 MCP Tools

| Tool | Description |
|---|---|
| `buddy_hatch` | Hatch a new companion. Optionally pick a name or species. |
| `buddy_status` | Check your buddy's stats, mood, and ASCII art card. |
| `buddy_observe` | Get your buddy's reaction to what you just did. Modes: backseat, skillcoach, both. |
| `buddy_pet` | Pet your buddy. Hearts appear. It's important. |
| `buddy_remember` | Store a memory for your buddy. |
| `buddy_dream` | Trigger memory consolidation (light or deep). |
| `buddy_mute` | Mute your buddy's chime-ins. |
| `buddy_unmute` | Bring your buddy back. |
| `buddy_respawn` | Release your buddy and start fresh. |

## 📡 MCP Resources

| URI | Description |
|---|---|
| `buddy://companion` | Full companion data as JSON. |
| `buddy://status` | ASCII status card, suitable for prompt injection. |
| `buddy://intro` | System prompt text for CLI integration -- teaches the AI your buddy's personality. |

## ⚙️ How It Works

1. **Hatch**: `buddy_hatch` rolls your companion using a seeded PRNG (deterministic per user ID). Species, rarity, stats, eye style, and hat are all determined by the roll.
2. **Persist**: Everything is stored in a SQLite database via better-sqlite3. Your buddy survives across sessions.
3. **Observe**: After you complete a task, `buddy_observe` builds a personality prompt and sends it to your CLI's AI, which responds in character. Your buddy's stats shape the feedback.
4. **Integrate**: The `buddy://intro` resource injects your buddy's personality into the CLI's system prompt, so the AI knows to stay in character when you address your buddy by name.

## 🛠️ Development

```bash
git clone https://github.com/fiorastudio/buddy.git
cd buddy
npm install
npm run build
npm test           # 243 tests
npm start          # runs the MCP server on stdio
```

## 🔍 Find Us

Claude Code /buddy alternative, MCP server, AI terminal pet, Nuzzlecap rescue, terminal companion, context-aware debugging, AI coding friend, persistent buddy, Model Context Protocol companion, agent-agnostic coding pet.

---

*Buddy is an open-source project dedicated to keeping the terminal a little less lonely.*
*Your buddy shouldn't disappear when you close the terminal.*

## 👤 Author

**Steven Jieli Wu**

- [LinkedIn](https://www.linkedin.com/in/jieliwu/)
- [Portfolio](https://jwu-studio-portfolio.vercel.app/)
- GitHub: [@terpjwu1](https://github.com/terpjwu1) · [@fiorastudio](https://github.com/fiorastudio)

## License

MIT — see [LICENSE](LICENSE) for details.
