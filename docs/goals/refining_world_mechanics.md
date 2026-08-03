# Refining Buddy World Mechanics — Controllable Sprites, Portal Warp & Real-time Hangout

> Design spec. Approved 2026-08-03. Reviewed by Codex (session `019fc8bf`, verdict
> "makes sense with specific changes" — incorporated). Build order at the bottom.

## Context

Buddy World is meant to be a **shared hangout** (Ragnarok-Online-inspired plaza), but three things break that promise today:

1. **"Warp" is overloaded.** The in-page `🌀 warp to X` button (`world/public/plaza.js:47-58`) is just an `<a href="?district=plaza-N">` that pans the *viewer's camera*. Moving a buddy between towns is a separate CLI action (`buddy-world warp`, `world-cli.ts:104-130`) that updates server `district`. Users click the button expecting their buddy to travel; it doesn't.
2. **Sprites are autonomous NPCs with per-viewer positions.** Each citizen's x/y is client-side, seeded per-viewer (`plaza.js:244-263`), and wanders on its own (`plaza.js:862-873`). The **only** shared, persisted location fact is `district` (which town). So if I park my buddy next to my friend's, my friend doesn't see us together — the core hangout fails.
3. **No notion of "my" sprite.** The plaza is an anonymous spectator view (`GET /v1/world/:district`, no auth). There's no way to drive your own buddy.

**Goal (RO-inspired):** You *drive your own sprite* (click-to-move); you travel by *walking into a portal tile* (which moves your buddy server-side **and** transitions the page — unifying "warp" into one gesture); and **everyone sees everyone move in real time** (the actual shared hangout). Town topology is **hub-and-spoke** with Prontera at the center.

**Decision (owner):** Go **straight to real-time** (Cloudflare Durable Objects + WebSockets); no shipped local-only phase. We still build in internal milestones to de-risk (see Build Order), with the DO skeleton front-loaded.

---

## Architecture

- **Identity — scoped browser control token.** The browser must never hold the real world token (`citizens.token_hash`), which authorizes teleport/events/recall/anon (too much blast radius); `?me=<slug>` is spoofable (slugs are public). The CLI mints a **scoped, browser-only token**:
  - `POST /v1/browser-link {token}` → returns a personal URL with a **one-time code** in the fragment.
  - Browser `POST /v1/browser-session {code}` → exchanges it (single-use) for a `controlToken` (scope: `move`,`portal_warp`), stored in `localStorage`.
  - `GET /v1/me` (Bearer controlToken — HTTP, so Bearer is fine here) → `{slug, district, capabilities}`. **Bypasses anon masking** so the owner learns their real slug even when anon.
- **Real-time — one Durable Object "room" per town.** `env.ROOM.idFromName(validatedDistrict)` (the `districtForTown`-validated `plaza-N`, never raw path input), WebSocket **Hibernation API** (`state.acceptWebSocket` + `webSocketMessage/Close/Error`; available at `compatibility_date 2026-06-01`). **D1 stays source of truth** (roster, district, identity, anon, XP, events); the **DO holds only ephemeral live positions**.
- **WS auth transport:** browser `WebSocket` **cannot set an `Authorization` header**. The live socket authenticates via the **first `hello` message carrying the controlToken** (alt: short-lived query token or subprotocol) — *not* a Bearer header.
- **Control — click-to-move.** The owner's actor takes its target (`tx/ty`) from canvas clicks and walks there using the existing movement primitive (`plaza.js:862-873`); autonomous `pickWaypoint` re-target is suppressed for the owner. Non-owner actors are driven by DO position snapshots instead of local wander.
- **Portal-warp — a place, not a button (redirect, not socket handoff).** Portals are **map data** (`{id, from, to, rect, spawn}`), rendered as canvas tiles. When the owner's sprite enters a portal rect → `portal_enter` → **server validates + updates D1 `district`** (reusing `districtForTown` + `DISTRICT_CAPACITY` gate, `handlers.ts:88-101`; **idempotent** — if already in the destination, return success). The room broadcasts `leave` and sends the owner `room_redirect {district, url, spawn}`; the **client closes the socket, navigates to `?district=new`, and reconnects** to `/v1/live/new`. (A Durable Object cannot transfer a socket to another DO.) Full document reload is acceptable for MVP; in-place town-swap is a later optimization. The camera-only `#warp` link is retired.

---

## Components & Files

### Server — Durable Object + realtime
- `world/wrangler.toml` — add `[[durable_objects.bindings]]` (`name = "ROOM"`, `class_name = "WorldRoom"`) and, **choosing the legacy path**, `[[migrations]]` (`tag = "v1"`, `new_sqlite_classes = ["WorldRoom"]`). (Cloudflare's newer declarative `[exports]` DO lifecycle is the alternative; legacy migrations are chosen here for simplicity and are mutually exclusive with `exports`.) No compat-flag change needed.
- `src/world/worker.ts` — extend `Env` with `ROOM: DurableObjectNamespace`; **export** the `WorldRoom` class from this `main` module; thread the namespace into `createWorldFetchHandler` config (`WorldWorkerConfig`, `worker-core.ts:18-23`). The handler is module-memoized (`worker.ts:18`) — ensure it isn't cached without `ROOM` in test/preview contexts.
- `src/world/room.ts` **(new)** — the `WorldRoom` DO: thin Cloudflare adapter. WS Hibernation handlers, `state.acceptWebSocket`, per-socket identity via `serializeAttachment`. On wake, **rebuild live-position maps from `ctx.getWebSockets()` attachments**; clients resend their current target after reconnect. Delegates all logic to `room-core.ts`.
- `src/lib/world/room-core.ts` **(new)** — **host-agnostic room logic** (message reducer, live-position map, **dirty-only** broadcast planning, presence join/leave, portal-redirect decision, `seq` monotonic handling) with **injected `send`/`broadcast` + clock** — matching the repo's "logic in a testable core, thin CF adapter" convention (`worker-core.ts` ↔ `worker.ts`). Unit tests target this.
- `src/world/worker-core.ts` — add a WS-upgrade route **before** the POST block: `GET /v1/live/:district` when `Upgrade: websocket`, resolve town via `districtForTown`, forward to the DO stub; the 101 response must **bypass `json()`/CORS** wrapping (return the stub's raw `Response`). Extend the POST allowlist (`:74`) + `switch` (`:94-103`) with the new routes below.
- **Types:** the repo deliberately avoids Cloudflare type packages (structural `D1Like`, `d1-store.ts:18`). A real DO class + `DurableObjectNamespace`/`WebSocketPair` will need `@cloudflare/workers-types` (dev dep) or careful structural typing, or `npm run build` (tsc) breaks.

### Server — identity & portal handlers
- `src/lib/world/handlers.ts` — add `handleBrowserLink`, `handleBrowserSession`, `handleMe`, `handlePortalWarp`. Reuse `hashToken`/`findByTokenHash`, `districtForTown` + `DISTRICT_CAPACITY` + `bad()`, and mirror the existing-citizen district UPDATE (`d1-store.ts:85-88`). Scope: the control token may only move **its own** citizen and may not write XP. Portal capacity reuses the "don't bounce someone already there" exception (`handlers.ts:94`).
- Identity storage — new tables in `src/lib/world/schema-sql.ts` (mirrored to `world/migrations/0001_init.sql`, drift-guarded by `migration-drift.test.ts`; prod D1 gets an out-of-band migration at deploy):
  - `link_codes(code_hash PK, citizen_id, expires_at)` — **single-use** (consume in a transaction), short **TTL**.
  - `browser_sessions(token_hash PK, citizen_id, scope, expires_at)` — scoped control tokens with **TTL**; **do not reuse** `citizens.token_hash`. Unique indexes on the hash columns.
  - **Purge-on-recall:** `recall(purge)` must also delete this citizen's `link_codes`/`browser_sessions` rows (today it only clears events/rollups/citizen, `store.ts:215`).
  - New `WorldStore` methods (both stores): `createLinkCode`, `consumeLinkCode` (atomic), `createBrowserSession`, `findCitizenByBrowserToken`, plus the recall cleanup.
- `src/lib/world/client.ts` + `src/cli/world-cli.ts` — new `WorldSync.mintBrowserLink()` (mirrors `setAnon`, `client.ts:181-184`) and a `buddy-world link` command (new `case` in `worldCommand`, `world-cli.ts:61-171`; add USAGE line) printing the personal plaza URL.

### Client — `world/public/plaza.js`
- **Bootstrap** (`:16-18`): read `controlToken` from `localStorage`/URL fragment; `GET /v1/me` → set `state.meSlug`.
- **WebSocket** (parallel to `refresh()`/`setInterval` in `boot()`, `:1287-1305`): connect `/v1/live/:district`; send `hello {controlToken, slug, lastSeq}` first; on `snapshot`, drive non-owner actors toward server x/y — applied **outside** the `REDUCED_MOTION` freeze (`:854`) so remote/owner sprites still move (snap rather than animate under reduced motion); send owner `move_to` intents at **5–10 Hz while moving** (not per frame). Define **reconnect/backoff**, stale-session handling, and duplicate-owner-socket behavior.
- **Click-to-move**: extend the empty-space branch of the click handler (`:981`) to set the owner actor's `tx/ty` and emit `move_to`; movement is already handled by `:862-873` (suppress `pickWaypoint` for the owner).
- **Portals**: render portal tiles from the hub-and-spoke graph; hit-test the owner actor each frame; on entry emit `portal_enter`; on `room_redirect`, close + navigate + reconnect. Retire the `#warp` IIFE (`:47-58`).
- **Test hooks** (beside `jobLabelForSlug`/`flagForSlug`, `:134-143`): expose `meSlug`, owner target, and remote peer positions on `window.__PLAZA__`.

### Topology data (hub-and-spoke, Prontera center)
Portal graph: Prontera (`plaza-1`) ⇄ each of Payon/Geffen/Alberta/Morroc/Comodo (`plaza-2..6`); each satellite has one portal back to Prontera. Records `{id, from, to, rect:{x,y,w,h fractions}, spawn:{x,y}}`, shared shape between client render and server validation, kept aligned with the six-town validator (`towns.ts:7`).

---

## Message Model (public id = `slug`; anon masking preserved for spectators)
- Client→room: `hello {controlToken, slug, lastSeq}`, `move_to {seq, x, y, clientTs}`, `portal_enter {seq, portal, to}`, `ping`.
- Room→clients: `snapshot {district, serverTs, actors:[{slug,x,y,tx,ty,state,seq}]}` (**dirty-only**, batched 50–100 ms), `join`/`leave`, `room_redirect {district, url, spawn}`.
- **Anon:** live public snapshots must keep the same masking as `handleWorld` (`handlers.ts:185-193`) — spectators see the masked/session-scoped id, never a real anon slug; `/v1/me` returns the real slug only to the authenticated owner.
- `seq` is monotonic per browser session: drop stale `move_to`, dedupe `portal_enter`.

---

## Build Order (DO skeleton front-loaded; still one launch, each step independently testable)
1. **Identity** — `link_codes`/`browser_sessions` tables + store methods (incl. purge-on-recall) + `browser-link`/`browser-session`/`me` handlers + `buddy-world link` CLI. Testable with SqliteWorldStore, no WS.
2. **Minimal DO/WS skeleton** *(front-loaded)* — `room-core.ts` + `room.ts` + `/v1/live/:district` + wrangler DO binding/migration + Worker types. Connect, authenticate `hello`, join one room, broadcast presence. Surfaces config/type/101/token-transport issues early.
3. **Click-to-move over the socket** — owner drives `move_to`; observers render snapshots.
4. **Portal-warp** — `handlePortalWarp` (idempotent) + portal graph data + client portal tiles + `room_redirect`/reconnect.
5. **Deploy + live-verify + Codex review + merge** to `release/2.0`.

---

## Verification
- **Unit** (`vitest`): `room-core.test.ts` (new) with injected `send`/clock + fake sockets — move_to → dirty batched snapshot, presence join/leave, `seq` ordering, idempotent portal decision. `handlers.test.ts` — browser-link/session/me/portal-warp on in-memory `SqliteWorldStore` (anon `/v1/me` returns real slug; portal-warp 409 capacity + already-there exception; scoped token can't write XP; recall purges sessions). `worker.test.ts` — WS upgrade returns 101; new POST auth. `world-cli.test.ts` — `link`.
- **Real DO/WS integration**: add `@cloudflare/vitest-pool-workers` (dev dep) for one in-process test with a real `WebSocketPair` + `acceptWebSocket`, **including an eviction/rehydration (hibernation) test** (rebuild positions from attachments on wake).
- **Client** (`plaza-smoke.test.ts`): click-to-move sets the owner's target; portal hit-test fires the warp (mock WS / instrumentation hook).
- **Live**: deploy to preview, `buddy-world link`, open the URL, drive the sprite, walk into a portal → town changes + buddy moves server-side; **second browser** confirms it sees the movement in real time.

---

## Risks / Notes
- **First WebSocket/DO in the repo** — new test tooling; DO hibernation drops in-memory state, so serialize per-socket identity and rebuild live maps from `ctx.getWebSockets()`; **dirty-only batching, no idle `setInterval`** (a hard requirement — idle timers block hibernation and keep 6 rooms warm = cost).
- **Anon**: `/v1/me` returns the real slug for the owner; live snapshots preserve anon masking for everyone else.
- **Security**: scoped control token limited to `move`/`portal_warp` on its own citizen; one-time link codes durably single-use (D1), not the volumetric per-isolate `RateLimiter` (use it only as an anti-abuse throttle on `browser-link`).
- **Capacity**: portal-warp enforces the 80/town gate, never bouncing a citizen already in the destination. **Decide the hidden-citizen mismatch**: `districtCounts()` counts hidden rows (`store.ts:255`) while `district()` shows only `hidden=0` (`store.ts:228`) — align live capacity to visible citizens.
- **Reconnection/ordering**: define close-code handling, backoff, duplicate owner-session resolution, portal-redirect races, and monotonic `seq`.
- **Schema drift + prod migration**: new tables in `schema-sql.ts` + `0001_init.sql` (drift test) + out-of-band prod D1 migration at deploy (country-flag precedent).
- **MVP scope discipline**: first realtime cut = owner moves, observers see snapshots, portal redirects. Defer `lastSeq` replay, rich presence states, spawn choreography, and nonessential hooks.
- **Deploy/merge**: production `wrangler deploy` + remote D1 migrations are gated (owner runs them); land on `release/2.0` via fast-forward after Codex approval.
