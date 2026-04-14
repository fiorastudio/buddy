# Buddy

<div align="center">

### The open-source `/buddy` rescue mission for AI terminals

Persistent memory, XP, species, and context-aware feedback for Claude Code CLI, Codex CLI, Gemini CLI, Copilot CLI, Cursor CLI, and other MCP-capable clients.

[![npm version](https://img.shields.io/npm/v/@fiorastudio/buddy?style=flat-square)](https://www.npmjs.com/package/@fiorastudio/buddy)
[![License](https://img.shields.io/badge/license-MIT-ffd166?style=flat-square)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/fiorastudio/buddy?style=flat-square)](https://github.com/fiorastudio/buddy/stargazers)
[![Node.js](https://img.shields.io/badge/node-18%2B-3c873a?style=flat-square)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/protocol-MCP-111827?style=flat-square)](https://modelcontextprotocol.io/)

<p align="center">
  <img src="demo/buddy-demo.gif" alt="Buddy demo showing hatch, observe, and pet interactions in the terminal" width="760">
</p>

**Anthropic removed the built-in `/buddy`. Buddy brings the companion experience back and makes it portable across AI terminals.**

</div>

## Why Buddy

- **Persistent by default.** Your companion lives in local SQLite, so it survives terminal restarts and client updates.
- **Works across clients.** Buddy is an MCP server, not a one-client hack.
- **Actually alive.** Hatch species, gain XP, store memories, chime in after tasks, and build a running relationship over time.
- **Easy to install.** One command auto-configures supported clients when it can.

## Quick Start

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash
```

### Windows

```powershell
irm https://raw.githubusercontent.com/fiorastudio/buddy/master/install.ps1 | iex
```

Then open your AI terminal and say:

```text
hatch a buddy
```

> Requires `node` 18+ and `git`.

## What You Get

| Feature | What it means |
|---|---|
| **21 species** | Void Cat, Rust Hound, Goose, Mushroom, Chonk, and more, each with distinct ASCII art and flavor |
| **5 stats** | `DEBUGGING`, `PATIENCE`, `CHAOS`, `WISDOM`, and `SNARK` shape reactions and personality |
| **XP and levels** | Your buddy grows with usage instead of disappearing every session |
| **Observer reactions** | `buddy_observe` lets your companion react to work you just finished |
| **Persistent memory** | Save local memories and keep a continuous companion state |
| **Cross-client setup** | Claude Code, Codex, Gemini, Copilot, Cursor, and other MCP-capable CLIs |

## Supported Clients

| Client | Status |
|---|---|
| Claude Code CLI | Full support |
| Codex CLI | Supported via MCP |
| Gemini CLI | Supported via MCP |
| GitHub Copilot CLI | Supported via MCP |
| Cursor CLI | Supported via MCP |
| Other MCP-capable clients | Usually supported with manual config |

## Install Notes

The installer:

1. Clones Buddy to `~/.buddy/server`
2. Installs dependencies and builds the MCP server
3. Auto-configures supported CLI clients when detected
4. Injects Buddy instructions into supported terminal prompts where applicable

If you prefer to install from source:

```bash
git clone https://github.com/fiorastudio/buddy.git ~/.buddy/server
cd ~/.buddy/server
npm install
npm run build
```

Then point your client's MCP config at:

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

---

<details>
<summary><strong>Meet the species, stats, and rarity system</strong></summary>

### 21 species

Buddy ships with 21 companions, including:

- Void Cat
- Rust Hound
- Data Drake
- Log Golem
- Cache Crow
- Shell Turtle
- Duck
- Goose
- Blob
- Octopus
- Owl
- Penguin
- Snail
- Ghost
- Axolotl
- Capybara
- Cactus
- Robot
- Rabbit
- Mushroom
- Chonk

### 5 personality stats

```text
DEBUGGING  ███████▓   92
PATIENCE   ██▓░░░░░   28
CHAOS      █████░░░   60
WISDOM     ██████▓░   78
SNARK      ██████▓░   85
```

These stats shape how your buddy behaves:

- `DEBUGGING` affects bug-spotting sharpness
- `PATIENCE` affects tolerance and calmness
- `CHAOS` affects unpredictability
- `WISDOM` affects architectural insight
- `SNARK` affects sass level

### Rarity

| Rarity | Chance | Bonus |
|---|---|---|
| Common | 60% | Base stats |
| Uncommon | 25% | Better floor plus cosmetic flair |
| Rare | 10% | Stronger roll plus rare flavor text |
| Epic | 4% | Higher stats and stronger aura text |
| Legendary | 1% | Top-tier roll and special prestige |

There is also a 1% shiny chance on any hatch.

</details>

<details>
<summary><strong>See the core tools and commands</strong></summary>

### MCP tools

| Tool | Description |
|---|---|
| `buddy_hatch` | Hatch a new buddy, optionally choosing a name or species |
| `buddy_status` | Show current stats, mood, and card art |
| `buddy_observe` | React to completed work in `backseat`, `skillcoach`, or `both` mode |
| `buddy_pet` | Pet your buddy |
| `buddy_remember` | Save a memory |
| `buddy_dream` | Consolidate memories |
| `buddy_mute` | Pause reactions |
| `buddy_unmute` | Resume reactions |
| `buddy_respawn` | Reset and start over |

### MCP resources

| URI | Description |
|---|---|
| `buddy://companion` | Full buddy JSON state |
| `buddy://status` | ASCII status card |
| `buddy://intro` | Prompt text for host CLI integration |

</details>

<details>
<summary><strong>How Buddy works under the hood</strong></summary>

Buddy is a standalone MCP server. That means it is not tied to hidden internals of a single AI client.

```text
AI terminal client
  -> MCP config
    -> Buddy server
      -> SQLite state
      -> species + rarity engine
      -> observer / memory / XP systems
```

The flow is simple:

1. `buddy_hatch` creates or restores a companion.
2. State is stored locally in `~/.buddy/buddy.db`.
3. `buddy_observe` reacts to task summaries instead of reading your whole repository.
4. The host CLI uses Buddy's MCP tools and resources to keep the companion present in your workflow.

This keeps Buddy:

- portable across clients
- durable across updates
- local-first for saved state
- lightweight enough for everyday use

</details>

<details>
<summary><strong>Demo assets and how to re-film the hero GIF</strong></summary>

The current demo assets live in [`demo/`](demo):

- [`demo/buddy-demo.gif`](demo/buddy-demo.gif)
- [`demo/screenshots/code-review.png`](demo/screenshots/code-review.png)
- [`demo/screenshots/statusline.png`](demo/screenshots/statusline.png)
- [`demo/record-demo.sh`](demo/record-demo.sh)
- [`demo/demo-auto.sh`](demo/demo-auto.sh)
- [`demo/make-gif.mjs`](demo/make-gif.mjs)
- [`demo/render-gif.mjs`](demo/render-gif.mjs)

The repo already includes a reproducible recording path:

- `demo/record-demo.sh` scaffolds a **Terminalizer**-based recording flow
- `demo/demo-auto.sh` plays a scripted terminal sequence for hatch, observe, and pet
- the render scripts turn captured frames into the final GIF asset

If you want to re-film the hero:

1. Build the project
2. Run `bash demo/record-demo.sh`
3. Follow the prompts it prints for recording and rendering
4. Replace `demo/buddy-demo.gif` with the refreshed capture

If you prefer another toolchain, the issue that inspired this README direction specifically called out **asciinema** or **VHS** for recording and **gifski** for conversion as good alternatives.

</details>

<details>
<summary><strong>FAQ</strong></summary>

| Question | Answer |
|---|---|
| Does Buddy read my whole codebase? | No. Buddy mainly reacts to short summaries you pass through tools like `buddy_observe`, plus its own saved state. |
| Does Buddy have a separate API bill? | No. It uses your host CLI's existing model session, so the tradeoff is extra context usage, not a second API. |
| What does Buddy store? | Local companion state in `~/.buddy/buddy.db`, such as species, level, XP, mood, and memories. |
| Is Buddy tied to one client? | No. It is designed for MCP-capable AI terminals, not one vendor UI. |
| Can I remove it later? | Yes. Use the uninstall scripts or reset with `buddy_respawn`. |

</details>

<details>
<summary><strong>Development</strong></summary>

```bash
git clone https://github.com/fiorastudio/buddy.git
cd buddy
npm install
npm run build
npm test
npm start
```

</details>

## Sources and Attribution

Buddy is part of a broader community effort to preserve the `/buddy` experience after it disappeared from hosted clients. This implementation is not presented as appearing from nowhere. It builds on public community work, public documentation, and the open protocol surface exposed by MCP-capable terminals.

- [save-buddy](https://github.com/jrykn/save-buddy) by [@jrykn](https://github.com/jrykn) is a strong reference point for transparent provenance. Its README and methodology framing are a good example of explicitly documenting where preservation ideas came from and how reconstruction work should be credited.
- [claude-buddy](https://github.com/1270011/claude-buddy) by [@1270011](https://github.com/1270011) helped establish the community pattern of rebuilding buddy-like behavior around stable extension points instead of brittle patching. The MCP plus terminal-integration approach in projects like this helped validate that the companion experience could survive client churn.
- Public community reverse-engineering and discussion around the original buddy behavior, including research threads that identified endpoint behavior and reconstruction details, helped shape the preservation direction for projects in this space.
- Official documentation for MCP and host-client integration contracts remains foundational for Buddy's portable architecture. The project relies on the documented MCP server model and on supported client configuration surfaces rather than patching hidden binaries.

If you are building in this area too, credit upstream community research clearly. These preservation projects are strongest when the lineage stays visible.

## Author

**Steven Jieli Wu**

- [LinkedIn](https://www.linkedin.com/in/jieliwu/)
- [Portfolio](https://jwu-studio-portfolio.vercel.app/)
- GitHub: [@terpjwu1](https://github.com/terpjwu1) and [@fiorastudio](https://github.com/fiorastudio)

## License

MIT. See [LICENSE](LICENSE).
