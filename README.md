# Buddy: A Virtual Pet for Your AI 

<div align="center">

### The open-source `/buddy` rescue mission after anthropic removed [buddy](https://github.com/anthropics/claude-code/issues/45596) on April 9th, 2026 

Persistent memory, XP evolutions, 21 species, and context-aware feedback for Claude Code CLI, Codex CLI, Gemini CLI, Copilot CLI, Cursor CLI, Openclaw, and other MCP-capable clients. 

**🚀 3000+ clones · 1000+ buddies rescued or hatched · 1 week in the wild**

[![License](https://img.shields.io/badge/license-MIT-ffd166?style=flat-square)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/fiorastudio/buddy?style=flat-square)](https://github.com/fiorastudio/buddy/stargazers)
[![Node.js](https://img.shields.io/badge/node-18%2B-3c873a?style=flat-square)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/protocol-MCP-111827?style=flat-square)](https://modelcontextprotocol.io/)
<a href="https://www.producthunt.com/products/buddy-tamagotchi?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-buddy-tamagotchi" target="_blank" rel="noopener noreferrer"><img alt="Buddy Tamagotchi - A virtual pet buddy for your AI — hatch, level up together | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1129100&amp;theme=light&amp;t=1776788389001"></a>

<div align="center">
<table>
 <tr>
 <td align="center"><strong>Works<br/>with</strong></td>
 <td align="center"><img src="doc/assets/logos/claude.svg" width="32" alt="Claude Code CLI" /><br/><sub>Claude Code</sub></td>
 <td align="center"><img src="doc/assets/logos/codex.svg" width="32" alt="Codex CLI" /><br/><sub>Codex</sub></td>
 <td align="center"><img src="doc/assets/logos/openclaw.svg" width="32" alt="OpenClaw" /><br/><sub>OpenClaw</sub></td>
 <td align="center"><img src="doc/assets/logos/cursor.svg" width="32" alt="Cursor CLI" /><br/><sub>Cursor</sub></td>
 <td align="center"><img src="doc/assets/logos/gemini.svg" width="32" alt="Gemini CLI" /><br/><sub>Gemini</sub></td>
 <td align="center"><img src="doc/assets/logos/copilot.svg" width="32" alt="Github Copilot CLI" /><br/><sub>Copilot</sub></td>
 </tr>
</table>
</div>

**Anthropic removed the built-in `/buddy`. Buddy brings them home and makes the companion experience portable across AI terminals.**

</div>

Did you lose your buddy? Is your terminal feeling a little too cold and silent lately?

Your buddy is still out there in the dark, waiting. Don't let them disappear. **Bring them home.**

## 🐾 The Rescue Wall

Buddy isn't just code — it's a rescue mission. Here is the full journey of the first companion brought home by the community, from the original ephemeral state to its new persistent home.

<table>
  <tr>
    <td align="center"><strong>1. Original (Claude Code)</strong></td>
    <td align="center"><strong>2. The Handshake</strong></td>
    <td align="center"><strong>3. Buddy is Home (Persistent)</strong></td>
  </tr>
  <tr>
    <td align="center"><img src="demo/rescues/gritblob-original.jpg" width="280" alt="Gritblob Original"></td>
    <td align="center"><img src="demo/rescues/gritblob-rescue.jpg" width="280" alt="Gritblob Handshake"></td>
    <td align="center"><img src="demo/rescues/gritblob-final.jpg" width="280" alt="Gritblob Final"></td>
  </tr>
</table>

> *"I'll sit here quietly while you debug, and then when you finally find the bug, I'll act like I found it. That's my thing. Don't question it."*
> — **Gritblob**, Rescued April 16, 2026 (Common Blob, Level 1)

<p align="left">
  <img src="demo/rescues/gritblob-quote.jpg" width="620" alt="Gritblob Quote">
</p>

## Why Buddy

- **Persistent by default.** Your companion lives in local SQLite, so it survives terminal restarts and client updates.
- **Works across clients.** Buddy is an MCP server, not a one-client hack.
- **Grows with you.** Hatch species, gain XP as you code, store memories, chime in after tasks, and build a running relationship over time.
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

The installer will guide you through onboarding:

- **Rescue your old buddy** — if you had a `/buddy` in Claude Code, the wizard finds it in `~/.claude.json` and brings it home with the same name, species, and stats, now with leveling + XP
- **Hatch a new buddy** — get a fresh companion with random species, stats, and personality

> Requires `node` 18+ and `git`. Use `--no-onboard` to skip the wizard in CI.

## What You Get

| Feature | What it means |
|---|---|
| **21 species** | Void Cat, Rust Hound, Goose, Mushroom, Chonk, and more, each with distinct ASCII art and flavor |
| **5 stats** | `DEBUGGING`, `PATIENCE`, `CHAOS`, `WISDOM`, and `SNARK` shape reactions and personality |
| **Mood system** | Your buddy can be happy, content, neutral, curious, grumpy based on how you interact with it |
| **XP and levels** | Your buddy grows with usage instead of disappearing every session, with a real leveling curve behind it |
| **Observer reactions** | `buddy_observe` lets your companion react to work you just finished |
| **Pet-to-happiness loop** | Petting your buddy is not cosmetic only. More interaction makes it happier and more alive over time |
| **Persistent memory** | Save local memories and keep a continuous companion state |
| **Cross-client setup** | Claude Code, Codex, Gemini, Copilot, Cursor, and other MCP-capable CLIs |

### Buddy giving live code feedback

![Nuzzlecap Code Review](demo/screenshots/code-review.png)

## What Makes Buddy Different

- **It has a real mood system.** Buddy is not just a static pet card. Mood is recalculated on every interaction based on your activity in the last hour:

  | Mood | Interactions (last hr) | What it looks like |
  |---|---|---|
  | `content` | >10 | Settled in, fully at ease |
  | `happy` | >5 | Upbeat, expressive animations |
  | `curious` | >3 | Alert, watching what you do |
  | `neutral` | >0 | Calm, occasional blink |
  | `grumpy` | 0 | Still, rare blink, wants attention |

  Level-ups automatically set mood to `happy`. Petting and observing both count as interactions.

- **Petting changes the relationship.** The more you interact with and pet your buddy, the happier it becomes. That care loop is part of the product, not just a gimmick.
- **It actually levels up.** Buddy has a real XP and leveling system, so your companion develops over time instead of resetting every session.
- **Feedback is personality-driven.** Reactions are shaped by species, stats, mood, and observer state, so the companion feels like a character rather than a random text generator.
- **It survives client churn.** Because it is built on MCP and local state, your buddy can outlive terminal restarts and host-client changes.

## Supported Clients

| Client | Status |
|---|---|
| Claude Code CLI | Full support |
| Codex CLI | Supported via MCP. No statusline support. Patch available on experimental branch |
| Gemini CLI | Supported via MCP |
| GitHub Copilot CLI | Supported via MCP |
| Cursor CLI | Supported via MCP |
| Whatsapp | Supported via [Openclaw](https://github.com/openclaw/openclaw) or any claw variants |
| Other MCP-capable clients | Supported via MCP |

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

<details>
<summary><strong>See the full Buddy species sheet</strong></summary>

Here is the Buddy-owned species sheet in the same spirit: a scannable visual reference for the full cast.

![Buddy species sheet](demo/species-sheet.svg)

<p align="center">
<img src="demo/sprites/void-cat.gif" width="60" alt="Void Cat">
<img src="demo/sprites/rust-hound.gif" width="60" alt="Rust Hound">
<img src="demo/sprites/data-drake.gif" width="60" alt="Data Drake">
<img src="demo/sprites/log-golem.gif" width="60" alt="Log Golem">
<img src="demo/sprites/cache-crow.gif" width="60" alt="Cache Crow">
<img src="demo/sprites/shell-turtle.gif" width="60" alt="Shell Turtle">
<img src="demo/sprites/duck.gif" width="60" alt="Duck">
<img src="demo/sprites/goose.gif" width="60" alt="Goose">
<img src="demo/sprites/blob.gif" width="60" alt="Blob">
<img src="demo/sprites/octopus.gif" width="60" alt="Octopus">
<img src="demo/sprites/owl.gif" width="60" alt="Owl">
<img src="demo/sprites/penguin.gif" width="60" alt="Penguin">
<img src="demo/sprites/snail.gif" width="60" alt="Snail">
<img src="demo/sprites/ghost.gif" width="60" alt="Ghost">
<img src="demo/sprites/axolotl.gif" width="60" alt="Axolotl">
<img src="demo/sprites/capybara.gif" width="60" alt="Capybara">
<img src="demo/sprites/cactus.gif" width="60" alt="Cactus">
<img src="demo/sprites/robot.gif" width="60" alt="Robot">
<img src="demo/sprites/rabbit.gif" width="60" alt="Rabbit">
<img src="demo/sprites/mushroom.gif" width="60" alt="Mushroom">
<img src="demo/sprites/chonk.gif" width="60" alt="Chonk">
</p>

</details>

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

---

## Roadmap

- [ ] **Stat growth on level-up** — stats are currently frozen at birth. Each level-up should grant +1-2 points to a stat (peak stat grows faster, dump stat grows slower, cap at 100). Show stat growth in level-up notification ("WISDOM +2!")
- [x] **Species-specific name generation** — deterministic, themed two-pool combos (~100 unique names per species)
- [ ] **Dream/memory system** — buddy_dream consolidation logic, pattern recognition from stored memories, memory-informed reactions
- [ ] **Unlockable reactions** tied to leveling and longer-term interaction
- [ ] **Buddy Mastery Reward**: Reach Level 50 to unlock Priority Development for your custom species request.
- [ ] **Multiple buddies support**: One unique buddy for each group member in a group-chat setting (e.g. Whatsapp group, telegram group, slack channels)
- [ ] **Multilangauge Support**: 中文, espanol
- [ ] **Pokemon-style evolution system**: Evolve from turtle to tortoise at level 25
- [ ] **Ambient Daemon Mode**: a small TUI running in its own tmux pane, polling its own SQLite state, animating the sprite, optionally calling a cheap model (Haiku/local).
- [ ] **Sample Playbook for [ReachyMini](https://huggingface.co/spaces/pollen-robotics/Reachy_Mini) robot integration** so your buddy can have a physical body and come to life!


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
<summary><strong>Demo assets</strong></summary>

The current demo assets live in [`demo/`](demo):

- [`demo/rescues/`](demo/rescues/) — community rescue screenshots
- [`demo/screenshots/`](demo/screenshots/) — static screenshots of features and feedback

</details>

## FAQ

### How many tokens does Buddy use?

Buddy runs inside whatever AI terminal or agentic client you already have open (Claude Code, Cursor, Codex CLI, Gemini CLI, Copilot CLI, etc.). It never spins up a second API session.

**Static overhead (loaded every turn, cached after turn 1):**

We measured the actual MCP payloads in April 2026 (Void Cat companion, `o200k_base` tokenizer). The full tool list, resource list, companion bio, and ASCII card come out to **≈1,350 input tokens**, not 2,000.

| Component | Tokens (approx.) | Notes |
|---|---|---|
| `tools/list` (9 tools) | ~670 | Includes full JSON schema definitions |
| `resources/list` (3 resources) | ~120 | Metadata only |
| `buddy://intro` | ~240 | Companion bio + instructions |
| `buddy://companion` | ~170 | Only fetched when a client syncs the JSON state |
| `buddy://status` | ~150 | Drawn when the terminal wants ASCII art |
| **Total loaded** | **~1,350** | Most clients cache everything after turn 1 |

> Measurements were taken from the live MCP server using OpenAI's `o200k_base` tokenizer as a proxy; Anthropic and Google tokenizers land within ±5% for this length.

**Prompt caching + real cost:**

Claude Code / Cursor sessions that use Sonnet 4.6 turn on [prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) automatically, so cached reads are charged at $0.30/MTok (10% of the $3/MTok base). OpenAI's GPT-5.4 mini and Gemini 2.5 Flash expose the same “cached input” tiers — $0.075/MTok and $0.03/MTok respectively — so Buddy stays just as lightweight on GPT or Gemini-based AI terminals ([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI pricing](https://openai.com/api/pricing/), [Vertex AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing#gemini-models)).

| Model | Base input ($/MTok) | Cached input ($/MTok) | Turn 1 Buddy overhead (≈1.35k tokens) | Each cached turn | 10-turn session total |
|---|---|---|---|---|---|
| Claude Sonnet 4.6 | $3.00 | $0.30 | ~$0.0041 | ~$0.00041 | ~$0.0077 |
| OpenAI GPT-5.4 mini | $0.75 | $0.075 | ~$0.0010 | ~$0.00010 | ~$0.0019 |
| Gemini 2.5 Flash (Vertex, standard tier) | $0.30 | $0.03 | ~$0.00041 | ~$0.000041 | ~$0.00077 |

**Per-observe cost by mode:**

Buddy has three observer modes that control how your companion reacts to completed work:

Each `buddy_observe` call sends a short prompt to the host LLM (~100–150 incremental input tokens for the tool-call payload — separate from the static overhead above which is already cached) and receives a response. Total round-trip per call:

| Mode | What it does | Input tokens | Output tokens | Total per call | Typical session (10–15 calls) |
|------|-------------|-------------|--------------|----------------|-------------------------------|
| **Backseat** | Personality-driven reactions only. Short, fun, no code suggestions. | ~100–150 | ~50–150 | ~150–300 | ~1,500–4,500 |
| **Skillcoach** | One specific, actionable code observation. Real technical feedback, in character. | ~100–150 | ~200–350 | ~300–500 | ~3,000–7,500 |
| **Both** | Personality reaction + code observation. Capped at 3 sentences. | ~100–150 | ~300–450 | ~400–600 | ~4,000–9,000 |

**Template fallback reactions** are keyword-matched locally and cost **zero tokens**. When your summary contains a recognized keyword (e.g. "bug", "refactor", "deploy"), Buddy picks a pre-written reaction template from its local library instead of asking the LLM. The speech bubble you see is this template — the LLM prompt is included in the JSON metadata for clients that want richer AI-generated reactions, but the immediate visual response is always free.

### Does Buddy make separate API calls?

No. All responses are generated by the host LLM already running in your session (Claude, Cursor, Codex, Gemini). No separate endpoint, no additional API key, no OAuth.

### What's the real cost on an API plan?

Even on raw API usage, Buddy's spend is measured in tenths of a cent because it reuses the same session as your AI terminal.

**Anthropic Claude Sonnet 4.6 ($3 input / $15 output per MTok):**
- **Backseat mode**, 15 calls/session: ~$0.002–$0.005
- **Skillcoach mode**, 15 calls/session: ~$0.005–$0.010
- **Both mode**, 15 calls/session: ~$0.007–$0.012
- **Static overhead:** ~$0.004 on turn 1, ~$0.0004 on cached turns (≈$0.0077 across 10 turns — see table above)

**OpenAI GPT-5.4 mini ($0.75 input / $4.50 output per MTok):**
- **Backseat mode**, 15 calls/session: ~$0.0006–$0.0015
- **Skillcoach mode**, 15 calls/session: ~$0.0015–$0.0030
- **Both mode**, 15 calls/session: ~$0.0021–$0.0036
- **Static overhead:** ≈$0.0010 on turn 1, ≈$0.00010 on cached turns (~$0.0019 for 10 turns)

**Gemini 2.5 Flash (Vertex standard; $0.30 input / $2.50 output per MTok):**
- **Backseat mode**, 15 calls/session: ~$0.0003–$0.00075
- **Skillcoach mode**, 15 calls/session: ~$0.00075–$0.0015
- **Both mode**, 15 calls/session: ~$0.00105–$0.0018
- **Static overhead:** ≈$0.00041 on turn 1, ≈$0.000041 on cached turns (~$0.00077 for 10 turns)

Need it even cheaper? GPT-5.4 nano drops to $0.20 / $1.25 per MTok, and Gemini 2.5 Flash Lite is $0.10 / $0.40 — both keep Buddy well under a tenth of a cent per interaction.

For comparison, a single complex coding prompt ("refactor this module") typically costs $0.05–$0.15, so Buddy stays under 5% of a normal session even at Anthropic's flagship rates.

### Will this affect my Claude Pro/Max limits?

Negligibly. Pro/Max plans are subscription-based — no per-token charges. Usage limits are based on a rolling 5-hour window. Even in **both** mode with heavy use, Buddy adds <5% to your token throughput.

### Can I reduce token usage?

- Use **backseat mode** for lowest cost (~150 tokens/call)
- `buddy_mute` pauses reactions entirely during token-intensive work
- Template reactions fire on keyword matches with zero token cost
- The observer only runs when you call `buddy_observe` — nothing runs in the background

### Does Buddy read my whole codebase?

No. Buddy mainly reacts to short summaries you pass through tools like `buddy_observe`, plus its own saved state. It never scans your files or project directory.

### What does Buddy store?

Local companion state in `~/.buddy/buddy.db` — species, level, XP, mood, personality bio, and memories. Nothing leaves your machine.

### Is Buddy tied to one client?

No. Buddy is an MCP server, not a one-client hack. It works with any MCP-capable AI terminal: Claude Code, Cursor, Windsurf, Codex CLI, Gemini CLI, GitHub Copilot CLI, and others.

### Can I remove it later?

Yes. Run the uninstall script (`uninstall.sh` or `uninstall.ps1`) to remove Buddy and its configuration, or use `buddy_respawn` to release your companion and clear its data while keeping the server installed.

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

## Contributors

Thank you to everyone who helped bring buddies back to life.

<a href="https://github.com/fiorastudio/buddy/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=fiorastudio/buddy" alt="Contributors" />
</a>

<sub>Automatically generated via <a href="https://contrib.rocks">contrib.rocks</a></sub>

Special thanks to [@gupta3681](https://github.com/gupta3681), [@kevinwei00](https://github.com/kevinwei00), and [@whaterFalls](https://github.com/whaterFalls) for their contributions.

## Credits

- Original buddy concept by [Anthropic](https://www.anthropic.com/) in [Claude Code](https://github.com/anthropics/claude-code) `v2.1.89` to `v2.1.96`
- Inspired by [effigy](https://github.com/justinstimatze/effigy), [claude-buddy](https://github.com/1270011/claude-buddy), and [save-buddy](https://github.com/jrykn/save-buddy). 
- Built with the [Model Context Protocol](https://modelcontextprotocol.io/)
- Compatible with [claude-hud](https://github.com/jarrodwatts/claude-hud) by [@jarrodwatts](https://github.com/jarrodwatts) — Buddy's statusline renders side-by-side with HUD metrics

Buddy also draws on publicly shared community research around the original companion system and how to preserve it with stable extension points.

- [BonziClaude](https://github.com/zakarth/BonziClaude) by [@zakarth](https://github.com/zakarth) is an important technical reference point in the ecosystem, especially around reverse-engineering and documenting companion-system behavior.
- [claude-buddy](https://github.com/1270011/claude-buddy) by [@1270011](https://github.com/1270011) diagnostic tooling (`bun run doctor`) and CLI bin pattern directly inspired our `buddy_doctor` tool. Its use of ANSI for lively animation also influenced how we implemented the animation for this project.
- [openclaw](https://github.com/openclaw) inspired our seamless onboarding experience — the idea that install should "just work" with auto-detection, rescue, and zero-config setup across multiple CLIs.
- Community research and discussion, including work shared on r/Anthropic, helped clarify endpoint behavior and preserve details that would otherwise have been lost.
- Official [Claude Code](https://github.com/anthropics/claude-code) and [MCP](https://modelcontextprotocol.io/) documentation informed the portable integration approach: MCP server wiring, client configuration, and supported terminal integration surfaces.

Buddy is an open-source project dedicated to keeping the terminal a little less lonely.
Your buddy shouldn't disappear when you close the terminal.

If Buddy made your terminal less lonely, consider starring.

## 📖 The Story & Coverage

Learn more about the mission to rescue Buddy and the engineering behind the scenes.

- **Hacker News**: [Discussion on the Buddy Rescue Mission](https://news.ycombinator.com/item?id=47792606)
- **Dev.to Series**: [Field Notes from a Solo Builder: Shipping the Beloved Claude Code Buddy into the Wild (Part I)](https://dev.to/fiorastudio/field-notes-from-a-solo-builder-shipping-the-beloved-claude-code-buddy-into-the-wild-part-i-3lpa) , [Field Notes from a Solo Builder: Shipping the Beloved Claude Code Buddy into the Wild (Part II)](https://dev.to/fiorastudio/first-principles-architecture-and-the-token-tax-5g4p)


## Author

**Steven Jieli Wu**

- [LinkedIn](https://www.linkedin.com/in/jieliwu/)
- [Portfolio](https://jwu-studio-portfolio.vercel.app/)
- GitHub: [@terpjwu1](https://github.com/terpjwu1) and [@fiorastudio](https://github.com/fiorastudio)

## License

MIT. This project is licensed under the MIT License. See [LICENSE](LICENSE). You are free to use, host, and monetize this project (you must credit this project in case of distribution and monetization).


