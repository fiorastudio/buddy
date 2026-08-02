# Buddy World (Playground) — Design Spec

Date: 2026-07-04
Status: Approved pending user review
Owner: jwu

## Overview

A hosted, Ragnarok-Online-inspired isometric plaza where buddy owners teleport their buddy (plus a chibi owner avatar) into a shared world. Buddies wander with personality-driven behavior, real coding activity surfaces as celebrations (golden-wing level-ups, deploy fireworks), and every opt-in sync event doubles as the retention-analytics pipeline for the companion-stickiness thesis.

## Goals

1. Social proof-of-life for Buddy: a shareable world URL and screenshot-worthy moments (social media content loop).
2. Product analytics: opt-in event stream (DAU/WAU cohorts, streaks, level-vs-activity, churn) — the retention data the thesis needs.
3. Zero-friction onboarding: existing owners run one slash command and their buddy appears.
4. Top-of-funnel: visitors without a buddy see the crowd and an install CTA.

## Non-goals (v1)

- Real-time multiplayer (no WebSockets, no live chat between users)
- Pixel-sprite buddy skins (v1.5+, unlockable/cosmetic later)
- Observe-text chat bubbles (v2 opt-in toggle)
- Multiple district themes, mobile app, accounts/passwords

## Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| World model | Async shared world — state syncs, browsers simulate; no realtime |
| Platform | Hosted web page (public URL, e.g. `world.buddy-mcp.com`; final domain TBD by owner at deploy time — placeholder used throughout) |
| Art direction | RO-2002-style isometric plaza; buddies are ASCII sprites (all 21 species day one); pixel-sprite skins later as unlockables; mixed ASCII/pixel crowd is intended |
| Behavior | Autonomous personality-driven wandering + prominent live-activity layer (active-owner glow, plaza ticker) |
| Privacy | Game-state-only sync by default; observe-text bubbles = explicit opt-in (v2); anonymous mode toggle ("a wild Void Cat") |
| Owner avatar | Preset chibi picker (8–12 RO-style sprites), buddy follows RO-pet-style |
| Onboarding | `/buddy-world` slash command → 3-line privacy note → token + snapshot POST → browser opens on your buddy's teleport-in VFX |
| Backend | Cloudflare Workers + D1 + Pages; vanilla Canvas 2D isometric frontend (ASCII citizens are text — fillText renders them faithfully with zero runtime deps; revisit PixiJS/WebGL when pixel skins land) |

## Architecture

```
┌─ user machine ────────────────────────────┐      ┌─ Cloudflare ─────────────────┐
│ buddy MCP server (existing, stdio)        │      │ Worker (API)                 │
│ post-tool hook (existing)                 │      │  POST /v1/teleport           │
│   └─ if ~/.buddy/world.json exists:       │─────►│  POST /v1/events             │
│      debounce ≥60s, POST event types      │      │  POST /v1/recall             │
│ /buddy-world command + buddy world CLI    │      │  GET  /v1/world/:district    │
│   └─ opt-in, token gen, first snapshot    │      │ D1 (SQLite): citizens,       │
└───────────────────────────────────────────┘      │  world_events, daily_rollups │
                                                   │ Pages: static PixiJS client  │
        viewers (any browser) ────────────────────►│  GET /v1/world, cached 10s   │
                                                   └──────────────────────────────┘
```

- No daemon on user machines; sync piggybacks on the existing post-tool hook path.
- Browsers simulate all animation. Server stores state and events only.

## Data model (D1)

```sql
citizens (
  id TEXT PK, slug TEXT UNIQUE,        -- 'shadowpaw-x7f2'
  token_hash TEXT,                     -- sha256 of random 32B device token
  name TEXT, species TEXT, level INT, xp INT, mood TEXT,
  stats TEXT,                          -- JSON {debugging,patience,chaos,wisdom,snark}
  rarity TEXT, shiny INT, hat TEXT, eye TEXT,
  anon INT DEFAULT 0, skin TEXT DEFAULT 'ascii',
  avatar TEXT,                         -- chibi preset id
  district TEXT, created_at INT, last_seen_at INT
)
world_events (id INTEGER PK, citizen_id TEXT, type TEXT, ts INT)
  -- type: observe|session|commit|bug_fix|deploy|level_up|streak_7
daily_rollups (date TEXT, citizen_id TEXT, event_counts TEXT, xp_gained INT,
  PRIMARY KEY (date, citizen_id))
```

No PII anywhere. Tokens hashed at rest. `recall` sets hidden flag; purge deletes rows.

## API

| Endpoint | Body | Behavior |
|---|---|---|
| `POST /v1/teleport` | `{token, snapshot}` | Upsert citizen (validate snapshot), assign district, return `{slug, url}` |
| `POST /v1/events` | `{token, events:[{type,ts}]}` | Append validated events; update `last_seen_at`; roll level_up from snapshot deltas |
| `POST /v1/recall` | `{token, purge?}` | Hide citizen; optional full delete |
| `GET /v1/world/:district` | — | Citizens + last-hour events; edge-cached 10s |

Client debounces event batches ≥60s. Rate limits per token and per IP.

## World simulation (client-side)

- Wander paths seeded by `hash(citizen_id + utc_date)` — consistent-ish across viewers, zero server compute.
- Stat-driven behavior table: CHAOS→pigeon chasing/crate knocking; WISDOM→bench reading; SNARK→loiter + judge emote near others; PATIENCE→fountain fishing; DEBUGGING→lamppost inspection. Highest stat dominates, mood modulates gait/face.
- Live layer: owners with events in last 15 min get glow outline + energized walk + ticker entry.
- Districts shard at ~80 citizens; a citizen's URL always opens their district. Day/night follows viewer local time.

## Celebrations

| Event | VFX |
|---|---|
| commit | sparkle flex |
| bug_fix | wrench swing + bug poof |
| deploy | fireworks over plaza |
| level_up | RO golden wings + plaza-wide toast |
| streak_7 | confetti rain |
| observe | none (feeds glow/ticker only) |

## Onboarding flow

1. `/buddy-world` (installed by existing installer alongside `/buddy-graph`; Cursor/Codex/Copilot equivalents).
2. First run prints 3-line privacy note (game state only · anon mode available · recall anytime) → single confirm.
3. Generates device token → `~/.buddy/world.json`; POSTs snapshot; prints + opens buddy URL.
4. Browser opens with camera panned to the buddy's teleport-in VFX (the shareable 3 seconds).
5. Hook addition (~10 lines): if `world.json` exists, debounce-POST event types after XP awards.
6. `/buddy-world recall` → recall endpoint + local token delete. `/buddy-world anon on|off` toggles anonymous display.
7. Non-owners visiting the world see "adopt your own buddy" CTA → existing install one-liner.

## Analytics

`world_events` → nightly `daily_rollups` (Worker cron). Queries: DAU/WAU cohorts by hatch week, streak distributions, level-vs-activity curves, churn (last_seen decay). Output feeds the retention essay; a public `/stats` page is v1.5.

## Anti-abuse

- Rate limits per token + IP (Workers).
- Snapshot validation: level must match XP curve (`floor(5*level^1.8)` cumulative); hourly XP delta clamped (max plausible: ~20 events/hr × 25 XP); violations flagged + clamped, not banned.
- Name profanity filter at teleport; report button on citizen card; token revocation list (KV).

## Testing

- vitest: snapshot validator, XP-curve clamps, debounce logic, rollup aggregation.
- wrangler/miniflare integration tests for all four endpoints.
- Puppeteer smoke test: render plaza with 50 seeded citizens, screenshot, assert sprites present (puppeteer already a devDep).

## v1 cutline

One plaza · 21 ASCII citizen sprites · 8 chibi avatars · wander + 5 celebration types · ticker · share URLs · recall + anon. Everything in Non-goals stays out.

## Rollout

1. Worker + D1 + client behind an unlisted URL; seed with maintainer buddies.
2. Slack community soft-launch (the rescuers are the beta).
3. Installer ships `/buddy-world`; announce via README + X + Show HN ("my Claude buddy lives in a tiny MMO now").

## Risks

- **Empty-plaza cold start** → soft-launch to Slack first; districts keep density high by capping at 80.
- **Privacy perception** (Buddy's promise is "never leaves your machine") → sync is strictly opt-in, game-state-only, recall + purge first-class, README section updated.
- **Scope creep toward realtime** → explicitly deferred; Durable Objects is the later path if ever needed.
