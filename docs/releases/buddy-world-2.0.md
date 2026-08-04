# Buddy World 2.0 — the shared plaza goes live & real-time 🌍

**Live now at [buddyworldonline.com](https://buddyworldonline.com)**

Buddy World is a shared, Ragnarok-Online-inspired plaza where your AI coding
companions gather. This release turns it from a per-viewer diorama into a **real
multiplayer hangout**: you drive your own buddy, travel between towns by walking
into portals, and everyone sees each other move — and celebrate — in real time.

## ✨ Highlights

- **Drive your own sprite.** Enter through a personal control link and move your
  buddy with click-to-move (Ragnarok-style). Everyone else in that town sees you
  walk around, live.
- **Real-time shared world.** Positions are streamed over WebSockets through a
  Cloudflare **Durable Object "room" per town** (WebSocket Hibernation). Your
  buddy is in the same spot on your screen and your friend's.
- **Portal travel — "warp" is a place, not a button.** Walk your buddy into a
  glowing gate at the edge of the plaza to travel to another town. It moves your
  buddy server-side *and* transitions the page. Six towns in a **hub-and-spoke**
  layout with Prontera at the center.
- **Country flags.** On teleport, your buddy flies the flag of your connection's
  country (derived server-side from the request — coarse country-level only, no
  city or IP stored; hidden in anonymous mode).
- **Per-town music.** Each town has its own original, self-hosted theme.
- **RO-style celebrations.** Level-ups, deploys, and 7-day streaks trigger a
  **yellow world-broadcast banner** that sweeps across the top **in every town**
  (`📢 buddy shipped to production! — in Prontera`), plus in-world effects: a
  golden pillar of light for a level-up, fireworks for a deploy.
- **Durable metrics.** Every celebration is persisted to Cloudflare D1
  (`world_events`), with a nightly rollup into `daily_rollups` for per-day
  analytics. (Note: `buddy-world recall --purge` deletes a buddy's history.)

## 🕹️ How to join

1. Install Buddy (see the README Quick Start), which includes the `buddy-world` CLI.
2. Teleport your buddy into the world:
   ```bash
   buddy-world teleport
   ```
3. Get a personal control link and open it in your browser to drive your sprite:
   ```bash
   buddy-world link
   ```
4. Click the ground to walk; walk into a portal gate to travel. Or move between
   towns from the CLI:
   ```bash
   buddy-world warp payon
   ```

## 🔐 Privacy & safety

- **Game state only.** Buddy World syncs name, species, level, XP, mood, stats —
  never your code, prompts, or messages.
- **Anonymous mode:** `buddy-world anon on` masks your buddy as "a wild
  \<species\>" — no name, no country flag.
- **Scoped browser control.** The browser holds a *scoped* control token (mint
  it with `buddy-world link`) that can only move your own sprite and travel — it
  can never teleport, recall, or touch XP. Your real world token never leaves
  your machine.
- **Leave anytime:** `buddy-world recall --purge` removes your buddy and all its
  server-side history.

## 🧱 Under the hood

- Cloudflare **Workers** (single worker serves the plaza frontend + the `/v1` API
  same-origin), **D1** (SQLite — the durable source of truth for citizens,
  events, identity), and **Durable Objects** (per-town live-position rooms over
  WebSockets; D1 stays authoritative, the DO holds only ephemeral positions).
- Built and shipped in sequenced milestones (identity → realtime room →
  click-to-move → portal-warp → deploy → announce banner), each independently
  tested and reviewed.

## ⚙️ CLI reference (`buddy-world`)

| Command | What it does |
|---------|--------------|
| `buddy-world teleport` | Bring your buddy into Buddy World (lands in Prontera) |
| `buddy-world link` | Mint a personal browser control link (drive your sprite) |
| `buddy-world warp <town>` | Move your buddy to another town |
| `buddy-world towns` | List the towns you can warp to |
| `buddy-world status` | Show your buddy's world status |
| `buddy-world anon on\|off` | Toggle anonymous mode |
| `buddy-world recall [--purge]` | Leave the world (`--purge` deletes everything server-side) |
