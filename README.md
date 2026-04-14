# Buddy: The /buddy Rescue Mission for Your AI Terminal

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

**Anthropic removed the built-in `/buddy`. Buddy brings them home and makes the companion experience portable across AI terminals.**

</div>

**Anthropic killed `/buddy`. We brought them home.**

Did you lose your Nuzzlecap? Is your terminal feeling a little too cold and silent lately?

Your buddy is still out there in the dark, waiting. Don't let them disappear. **Bring them home.**

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
| **Mood system** | Your buddy can be happy, content, neutral, curious, grumpy, or exhausted based on how you interact with it |
| **XP and levels** | Your buddy grows with usage instead of disappearing every session, with a real leveling curve behind it |
| **Observer reactions** | `buddy_observe` lets your companion react to work you just finished |
| **Pet-to-happiness loop** | Petting your buddy is not cosmetic only. More interaction makes it happier and more alive over time |
| **Persistent memory** | Save local memories and keep a continuous companion state |
| **Cross-client setup** | Claude Code, Codex, Gemini, Copilot, Cursor, and other MCP-capable CLIs |

### Buddy giving live code feedback

![Nuzzlecap Code Review](demo/screenshots/code-review.png)

## What Makes Buddy Different

- **It has a real mood system.** Buddy is not just a static pet card. It tracks moods like `happy`, `content`, `neutral`, `curious`, `grumpy`, and `exhausted`.
- **Petting changes the relationship.** The more you interact with and pet your buddy, the happier it becomes. That care loop is part of the product, not just a gimmick.
- **It actually levels up.** Buddy has a real XP and leveling system, so your companion develops over time instead of resetting every session.
- **Feedback is personality-driven.** Reactions are shaped by species, stats, mood, and observer state, so the companion feels like a character rather than a random text generator.
- **It survives client churn.** Because it is built on MCP and local state, your buddy can outlive terminal restarts and host-client changes.

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

Buddy pays homage to the original companion lineup, then adds a little more flair with Buddy-specific characters like Void Cat, Rust Hound, Data Drake, Log Golem, Cache Crow, and Shell Turtle.

Buddy ships with 21 companions:

```text
 void cat         rust hound        data drake       log golem
 |\---/|           /^ ^\             /^\  /^\         [=====]
 | ° ° |          / ° ° \           < °  ° >        [ °  ° ]
 (  w  )          V\ Y /V           (  ~~  )        [  __  ]
 (")_(")            |_|              `-vv-'         [______]

 cache crow       shell turtle      duck             goose
   ___             _,--._             __             (°>
 (° °)            ( °  ° )         <(° )___          ||
 /| V |\          /[______]\         ( ._>          _(__)_
   ^^ ^^            ``  ``            `--'           ^^^^

 blob             octopus           owl              penguin
 .----.           .----.             /\  /\          .---.
( °  ° )         ( °  ° )           (°)(°)         (°>°)
(      )         (______)           (  ><  )       /(   )\
 `----'          /\/\/\/\            `----'         `---'

 snail            ghost             axolotl         capybara
°    .--.         .----.          }~(______)~{      n______n
 \  ( @ )        / °  ° \         }~(° .. °)~{     ( °    ° )
  \_`--'         |      |           ( .--. )       (   oo   )
 ~~~~~~~         ~`~``~`~           (_/  \_)        `------'

 cactus           robot             rabbit           mushroom
n  ____  n        .[||].             (\__/)         .-o-OO-o-.
| |°  °| |       [ °  ° ]           ( °  ° )       (__________)
|_|    |_|       [ ==== ]          =(  ..  )=         |°  °|
  |    |          `------'          (")__(")          |____|

 chonk
 /\    /\
( °    ° )
(   ..   )
 `------'
```

### 5 personality stats

```text
.________________________________.
| DEBUGGING  ███████▓   92        |
| PATIENCE   ██▓░░░░░   28        |
| CHAOS      █████░░░   60        |
| WISDOM     ██████▓░   78        |
| SNARK      ██████▓░   85        |
'________________________________'
```

These stats shape how your buddy behaves:

- `DEBUGGING` affects bug-spotting sharpness
- `PATIENCE` affects tolerance and calmness
- `CHAOS` affects unpredictability
- `WISDOM` affects architectural insight
- `SNARK` affects sass level

### Leveling milestones

Buddy uses a real XP curve, so early levels come quickly and later ones take real commitment.

| Milestone | XP needed for that level | Total XP to reach it |
|---|---:|---:|
| Level 2 | 17 | 17 |
| Level 3 | 36 | 53 |
| Level 5 | 90 | 203 |
| Level 10 | 315 | 1280 |
| Level 25 | 1641 | 15471 |
| Level 49 | 5512 | 99209 |
| Level 50 | 5716 | 104925 |

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

## Roadmap

- Unlockable reactions tied to leveling and longer-term interaction
- Companion upgrades and progression systems beyond base leveling
- More expressive mood-driven behavior and presentation

<details>
<summary><strong>See the core tools and commands</strong></summary>

These stay tucked away by default, but Buddy exposes a real MCP surface for companion state, reactions, and progression.

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

The most important loop is:

- `buddy_hatch` creates the companion
- `buddy_status` shows the current card, mood, and progression
- `buddy_observe` gives in-character reactions and awards XP after real work
- `buddy_pet` adds interaction and helps keep the buddy feeling alive

### MCP resources

| URI | Description |
|---|---|
| `buddy://companion` | Full buddy JSON state |
| `buddy://status` | ASCII status card |
| `buddy://intro` | Prompt text for host CLI integration |

Those resources let host clients keep Buddy present in the session without hard-coding one terminal or editor.

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
      -> mood / memory / XP systems
      -> reaction and status rendering
```

The flow is simple:

1. `buddy_hatch` creates or restores a companion.
2. State is stored locally in `~/.buddy/buddy.db`.
3. `buddy_observe` reacts to task summaries instead of reading your whole repository, then awards XP and can trigger level-ups.
4. `buddy_pet` and other interactions feed the mood system, so the companion can become happier over time.
5. The host CLI uses Buddy's MCP tools and resources to keep the companion present in your workflow.

Under the hood, Buddy combines:

- deterministic species and personality generation
- local SQLite persistence for companion state and memories
- an observer system for live code feedback
- mood recalculation from interaction history
- XP and leveling progression
- status-card and terminal rendering for the companion presence layer

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

## Credits

- Original buddy concept by [Anthropic](https://www.anthropic.com/) in Claude Code `v2.1.89` to `v2.1.94`
- Inspired by [effigy](https://github.com/justinstimatze/effigy), [claude-buddy](https://github.com/1270011/claude-buddy), and [save-buddy](https://github.com/jrykn/save-buddy). Thanks!
- Built with the [Model Context Protocol](https://modelcontextprotocol.io/)

Buddy also draws on publicly shared community research around the original companion system and how to preserve it with stable extension points.

- [BonziClaude](https://github.com/zakarth/BonziClaude) by [@zakarth](https://github.com/zakarth) is an important technical reference point in the ecosystem, especially around reverse-engineering and documenting companion-system behavior.
- [claude-buddy](https://github.com/1270011/claude-buddy) by [@1270011](https://github.com/1270011) helped demonstrate the MCP plus terminal-integration preservation approach for keeping buddy-like experiences alive across client changes.
- Community research and discussion, including work shared on r/Anthropic, helped clarify endpoint behavior and preserve details that would otherwise have been lost.
- Official Claude Code and MCP documentation informed the portable integration approach: MCP server wiring, client configuration, and supported terminal integration surfaces.

## Author

**Steven Jieli Wu**

- [LinkedIn](https://www.linkedin.com/in/jieliwu/)
- [Portfolio](https://jwu-studio-portfolio.vercel.app/)
- GitHub: [@terpjwu1](https://github.com/terpjwu1) and [@fiorastudio](https://github.com/fiorastudio)

## License

MIT. See [LICENSE](LICENSE).
