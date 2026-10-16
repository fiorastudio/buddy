// src/world/room.ts
// The WorldRoom Durable Object: one live "room" per town. This is a THIN
// Cloudflare adapter — it owns sockets, hibernation, and D1 access, and
// delegates every protocol decision to room-core.ts (host-agnostic, unit-tested).
//
// Hibernation discipline (a hard requirement — idle timers keep 6 rooms warm =
// cost): we hold NO cross-request state. Each socket carries its own identity
// via serializeAttachment, so a DO evicted between messages rebuilds everything
// from ctx.getWebSockets() on wake. There is no setInterval anywhere.

import {
  RoomCore,
  planSnapshot,
  type RoomPort,
  type ActorState,
  type AuthResult,
  type ServerMsg,
  type WarpOutcome,
  type HandleResult,
  type Peer,
  ROOM_NOTICE_PATH,
  CLOSE_TAKEN_OVER,
  FrameBudget,
} from '../lib/world/room-core.js';
import { D1WorldStore, type D1Like } from '../lib/world/d1-store.js';
import { hashToken, handlePortalWarp, publicSlug, type RoomNotice } from '../lib/world/handlers.js';
import type {
  CfWebSocket,
  DurableObjectStateLike,
  WebSocketPairLike,
} from './runtime.js';

interface RoomEnv {
  DB: D1Like;
  // Bound from wrangler.toml [vars]; used to build the room_redirect URL. Falls
  // back to a relative `/?district=…` (fine for same-origin client navigation).
  BASE_URL?: string;
  // Same secret the worker masks /v1/world with, so a live actor's anon id
  // matches the plaza's (handlers.publicSlug).
  ANON_SECRET?: string;
}

// What each socket stores. `district` is known at connect time (even before the
// hello authenticates), so it's available on every subsequent message without
// DO memory. `actor` is null until the hello succeeds. `citizenId` is the
// owner (server-side only, never sent) so an HTTP recall/anon change can find
// this citizen's live socket. `left` marks a socket that has left the room
// (warped, evicted, taken over) and is only waiting for its close: its frames
// are ignored, so it can never re-enter presence (e.g. by re-sending hello).
// `connectedAt` starts the hello deadline for a not-yet-authenticated socket.
interface SocketAttachment {
  district: string;
  actor: ActorState | null;
  citizenId?: string;
  left?: boolean;
  connectedAt?: number;
}

const WebSocketPairCtor = (globalThis as unknown as {
  WebSocketPair: new () => WebSocketPairLike;
}).WebSocketPair;

// Coalesce move_to bursts (owner sends 5–10 Hz) into one snapshot per window.
const SNAPSHOT_FLUSH_MS = 60;

// Frames a socket may have queued behind one in-flight D1 call (a hello or a
// portal_enter). Real clients queue a handful at most; past this the socket is
// flooding and further frames are dropped until the queue drains.
const MAX_QUEUED_FRAMES = 32;

// B7 limits. A socket must authenticate within AUTH_DEADLINE_MS of connecting
// (the plaza sends hello on open) or it is closed 1008 by the room's alarm.
// Frames over MAX_FRAME_CHARS close the socket (1009); the protocol's largest
// legitimate frame is a few hundred bytes. move_to is budgeted at ~15 Hz with
// a burst of 15 (the plaza streams ~8 Hz); every other frame at 5/s, burst 10.
// Frames over budget are dropped, not answered.
export const AUTH_DEADLINE_MS = 10_000;
const MAX_FRAME_CHARS = 4096;
const MOVE_RATE = { perSec: 15, burst: 15 };
const OTHER_RATE = { perSec: 5, burst: 10 };

export class WorldRoom {
  private storePromise: Promise<D1WorldStore> | null = null;
  // Ephemeral batching state. Safe to lose on hibernation: positions live on the
  // sockets (attachments), so a woken room re-derives everything; at worst it
  // emits one extra full snapshot after wake. A pending timer only exists while
  // actively moving, so it never blocks an IDLE room from hibernating.
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBroadcast = new Map<string, ActorState>();
  // B5: frames are handled ONE AT A TIME PER SOCKET. A DO's input gate does not
  // hold across D1 I/O, so without this a second frame from the same socket
  // runs while the first awaits D1 — two portal_enters both passing the seq
  // dedupe (double warp/leave/redirect), two hellos each broadcasting a join,
  // a move_to refused as "expected hello" mid-handshake. Memory only, and safe
  // to lose: a socket with a frame in flight keeps the DO awake, and an empty
  // queue is deleted, so hibernation never strands one.
  private queues = new Map<CfWebSocket, { tail: Promise<void>; depth: number }>();
  // Sockets whose close/error already ran, so an in-flight frame that resumes
  // after its D1 await doesn't announce a socket that is gone.
  private closed = new WeakSet<CfWebSocket>();
  // Per-socket frame budgets (B7). Memory only: a hibernation wake hands every
  // socket a fresh budget, which is harmless.
  private budgets = new WeakMap<CfWebSocket, { move: FrameBudget; other: FrameBudget }>();
  // Decoded attachments, so a broadcast or roster walk doesn't deserialize
  // every socket (idle unauthenticated ones included) each time. Written only
  // through setAttachment(); rebuilt lazily after a hibernation wake.
  private attCache = new WeakMap<CfWebSocket, SocketAttachment | null>();

  constructor(private state: DurableObjectStateLike, private env: RoomEnv) {}

  private store(): Promise<D1WorldStore> {
    this.storePromise ??= D1WorldStore.create(this.env.DB).catch((err) => {
      this.storePromise = null;
      throw err;
    });
    return this.storePromise;
  }

  // Authenticate a control token → PUBLIC (anon-masked) identity, matching
  // handleWorld's masking exactly so spectators never see a real anon slug.
  private async verify(controlToken: string): Promise<AuthResult | null> {
    const store = await this.store();
    const found = await store.findCitizenByBrowserToken(hashToken(controlToken), Date.now());
    if (!found) return null;
    const c = found.citizen;
    return { slug: publicSlug(c, this.env.ANON_SECRET), district: c.district, citizenId: c.id };
  }

  // Presence/snapshots reach only sockets that completed the hello handshake —
  // a socket that connected but never authenticated must not receive (even
  // masked) peer identities. Idle unauth sockets hear nothing and are closed
  // by the hello-deadline alarm (an alarm, unlike a timer, lets the DO
  // hibernate).
  private broadcastToAuthed(msg: ServerMsg, except?: CfWebSocket): void {
    const frame = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      if (!this.attachmentOf(ws)?.actor) continue;
      try {
        ws.send(frame);
      } catch {
        // a racing close; the socket will surface via webSocketClose
      }
    }
  }

  // Run the portal-warp semantic in D1 (idempotent, capacity-gated, no XP
  // write) and translate the handler result into a room-core WarpOutcome.
  private async warp(controlToken: string, to: string): Promise<WarpOutcome> {
    const store = await this.store();
    const res = await handlePortalWarp(
      { controlToken, to },
      store,
      { now: Date.now(), baseUrl: this.env.BASE_URL ?? '' }
    );
    if (res.status !== 200) return { ok: false, error: (res.body as { error?: string })?.error };
    const b = res.body as { district: string; url: string; spawn: { x: number; y: number } };
    return { ok: true, district: b.district, url: b.url, spawn: b.spawn };
  }

  private port(): RoomPort<CfWebSocket> {
    return {
      now: () => Date.now(),
      send: (ws, msg) => this.trySend(ws, msg),
      broadcast: (msg, except) => this.broadcastToAuthed(msg, except),
      verify: (token) => this.verify(token),
      warp: (token, to) => this.warp(token, to),
      current: (ws) => {
        const att = this.attachmentOf(ws);
        return { gone: this.closed.has(ws) || !att || !!att.left, actor: att?.actor ?? null };
      },
      peers: (ws) => this.peersExcept(ws),
    };
  }

  // Schedule a single coalesced snapshot for this window. A no-op if one is
  // already pending — that's the batching.
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      try {
        this.flushSnapshot();
      } catch (err) {
        // A timer callback has no caller to catch for it; never let one throw.
        console.error('buddy-world room snapshot failed:', err);
      }
    }, SNAPSHOT_FLUSH_MS);
  }

  // Best-effort send (B17): a socket can close between the decision and the
  // send. That is not this frame's failure; the close handler deals with it.
  private trySend(ws: CfWebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // racing close
    }
  }

  private tryClose(ws: CfWebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closing
    }
  }

  // Emit a dirty-only snapshot of everyone currently present, rebuilt from
  // socket attachments (hibernation-safe). Nothing dirty → nothing sent.
  private flushSnapshot(): void {
    const current = new Map<string, ActorState>();
    let district = '';
    for (const ws of this.state.getWebSockets()) {
      const att = this.attachmentOf(ws);
      if (!att?.actor) continue;
      district = att.district;
      current.set(att.actor.slug, att.actor);
    }
    const snap = planSnapshot(district, Date.now(), this.lastBroadcast, current);
    this.lastBroadcast = current;
    if (snap) this.broadcastToAuthed(snap);
  }

  private attachmentOf(ws: CfWebSocket): SocketAttachment | null {
    if (this.attCache.has(ws)) return this.attCache.get(ws) ?? null;
    const att = (ws.deserializeAttachment() as SocketAttachment | null) ?? null;
    this.attCache.set(ws, att);
    return att;
  }

  // Persist (survives hibernation) and cache. Never mutate a returned
  // attachment in place — always write a new object through here.
  private setAttachment(ws: CfWebSocket, att: SocketAttachment): void {
    ws.serializeAttachment(att);
    this.attCache.set(ws, att);
  }

  // Every OTHER authenticated socket, rebuilt from attachments (hibernation-safe).
  // Each carries its owner id (server-side only) so a hello can find an older
  // socket for the same buddy.
  private peersExcept(self: CfWebSocket): Peer<CfWebSocket>[] {
    const peers: Peer<CfWebSocket>[] = [];
    for (const ws of this.state.getWebSockets()) {
      if (ws === self) continue;
      const att = this.attachmentOf(ws);
      if (att?.actor) peers.push({ socket: ws, state: att.actor, citizenId: att.citizenId });
    }
    return peers;
  }

  // ── Cloudflare entry points ──────────────────────────────────────────────

  // Persist a RoomCore decision onto the socket and act on it. The attachment
  // is re-read HERE, not passed in: a decision reached after a D1 await must
  // merge onto what is stored now, never write back a pre-await copy.
  private apply(ws: CfWebSocket, res: HandleResult<CfWebSocket>): void {
    const att = this.attachmentOf(ws) ?? { district: '', actor: null };
    if (att.left) return; // already out of the room; nothing left to decide
    if (res.detach || res.close) {
      // Left the room (portal redirect / eviction), or refused (bad hello):
      // clear the actor (and owner) so this socket is gone from every presence
      // path immediately — even during the close window and across any
      // hibernation rehydration before the runtime drops it — and so frames it
      // already queued are ignored (a burst of bad hellos costs ONE D1 query).
      this.setAttachment(ws, { district: att.district, actor: null, left: true });
    } else if (res.attach) {
      const citizenId = res.citizenId ?? att.citizenId;
      this.setAttachment(ws, { district: att.district, actor: res.attach, citizenId });
    }
    // Newest wins: older sockets for this buddy leave presence silently (the
    // buddy never left — no `leave`, and their close handler finds no actor).
    for (const old of res.takeover ?? []) {
      const oldAtt = this.attachmentOf(old);
      try {
        this.setAttachment(old, { district: oldAtt?.district ?? att.district, actor: null, left: true });
        old.close(CLOSE_TAKEN_OVER.code, CLOSE_TAKEN_OVER.reason);
      } catch {
        // already closing — its close handler will find no actor either way
      }
    }
    if (res.flush) this.scheduleFlush();
    if (res.close) this.tryClose(ws, res.close.code, res.close.reason);
  }

  // A recall/purge/anon change landed over HTTP: apply it to this citizen's
  // live socket(s), if any are here. Unauthenticated sockets carry no owner.
  private onNotice(notice: RoomNotice): number {
    let touched = 0;
    for (const ws of this.state.getWebSockets()) {
      const att = this.attachmentOf(ws);
      if (!att?.actor || att.citizenId !== notice.citizenId) continue;
      const core = new RoomCore<CfWebSocket>(att.district, this.port());
      try {
        const res =
          notice.kind === 'evict'
            ? core.evict(ws, att.actor)
            : core.relabel(ws, att.actor, notice.slug, this.peersExcept(ws));
        this.apply(ws, res);
      } catch {
        // A racing close: still make sure an evicted socket is detached.
        if (notice.kind === 'evict') {
          this.setAttachment(ws, { district: att.district, actor: null, left: true });
        }
      }
      touched++;
    }
    return touched;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      if (request.method === 'POST' && new URL(request.url).pathname === ROOM_NOTICE_PATH) {
        const notice = parseNotice(await request.text());
        if (!notice) return new Response('bad notice', { status: 400 });
        return new Response(JSON.stringify({ touched: this.onNotice(notice) }), { status: 200 });
      }
      return new Response('expected a websocket upgrade', { status: 426 });
    }
    // The worker validated the town and forwards it as ?district=plaza-N; trust
    // that, not raw client path input.
    const district = new URL(request.url).searchParams.get('district') ?? '';

    const pair = new WebSocketPairCtor();
    const client = pair[0];
    const server = pair[1];
    // Hibernatable accept — no ws.accept()/addEventListener, so the runtime can
    // evict this DO between frames.
    this.state.acceptWebSocket(server);
    const connectedAt = Date.now();
    this.setAttachment(server, { district, actor: null, connectedAt });
    try {
      await this.armAuthDeadline(connectedAt + AUTH_DEADLINE_MS);
    } catch (err) {
      // Storage hiccup: the socket is already accepted, so hand it over; the
      // next upgrade (or a later alarm) arms the deadline.
      console.error('buddy-world room alarm arm failed:', err);
    }

    return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
  }

  // Make sure an alarm fires by `deadline`. Deadlines only grow (later
  // connects), so an already-armed alarm is early enough; alarm() re-arms for
  // whatever is still pending when it runs.
  private async armAuthDeadline(deadline: number): Promise<void> {
    const armed = await this.state.storage.getAlarm();
    if (armed === null || armed > deadline) await this.state.storage.setAlarm(deadline);
  }

  // B7 hello deadline: close every socket that hasn't authenticated within
  // AUTH_DEADLINE_MS. 1008, so a client that somehow never sent hello doesn't
  // reconnect-loop (the plaza parks on 1008). A socket whose hello is being
  // verified right now is spared; the alarm re-arms for it.
  async alarm(): Promise<void> {
    const now = Date.now();
    let next = Infinity;
    for (const ws of this.state.getWebSockets()) {
      const att = this.attachmentOf(ws);
      if (!att || att.actor || att.left) continue;
      if (this.queues.has(ws)) {
        next = Math.min(next, now + 1000);
        continue;
      }
      const deadline = (att.connectedAt ?? 0) + AUTH_DEADLINE_MS;
      if (deadline > now) {
        next = Math.min(next, deadline);
        continue;
      }
      try {
        this.setAttachment(ws, { district: att.district, actor: null, left: true });
        ws.send(JSON.stringify({ type: 'error', error: 'hello timeout' } satisfies ServerMsg));
        ws.close(1008, 'hello timeout');
      } catch {
        // already closing
      }
    }
    if (next !== Infinity) await this.state.storage.setAlarm(next);
  }

  // Drop a frame that is over this socket's budget (B7). Unparseable frames
  // count against the general budget; the core answers them with an error.
  private withinBudget(ws: CfWebSocket, raw: string): boolean {
    const now = Date.now();
    let b = this.budgets.get(ws);
    if (!b) {
      b = {
        move: new FrameBudget(MOVE_RATE.perSec, MOVE_RATE.burst, now),
        other: new FrameBudget(OTHER_RATE.perSec, OTHER_RATE.burst, now),
      };
      this.budgets.set(ws, b);
    }
    let type: unknown;
    try {
      type = (JSON.parse(raw) as { type?: unknown } | null)?.type;
    } catch {
      type = undefined;
    }
    return (type === 'move_to' ? b.move : b.other).take(now);
  }

  webSocketMessage(ws: CfWebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    if (raw.length > MAX_FRAME_CHARS) {
      try {
        ws.close(1009, 'frame too large');
      } catch {
        // already closing
      }
      return Promise.resolve();
    }
    if (!this.withinBudget(ws, raw)) return Promise.resolve();
    // Chain behind this socket's previous frame (see `queues`).
    const q = this.queues.get(ws) ?? { tail: Promise.resolve(), depth: 0 };
    if (q.depth >= MAX_QUEUED_FRAMES) return Promise.resolve();
    q.depth++;
    this.queues.set(ws, q);
    const run = q.tail.then(() => this.handleFrame(ws, raw));
    q.tail = run
      .catch(() => {})
      .then(() => {
        if (--q.depth === 0 && this.queues.get(ws) === q) this.queues.delete(ws);
      });
    return run;
  }

  private async handleFrame(ws: CfWebSocket, raw: string): Promise<void> {
    const att = this.attachmentOf(ws) ?? { district: '', actor: null };
    // Left the room (or closed) while this frame was queued: it is moot.
    if (att.left || this.closed.has(ws)) return;
    try {
      const core = new RoomCore<CfWebSocket>(att.district, this.port());
      const res = await core.onMessage(ws, att.actor, raw, this.peersExcept(ws));
      this.apply(ws, res);
    } catch (err) {
      // B17 error boundary: an unexpected failure (D1 down, a bug) must not
      // escape the DO's event handler. Log it and tell the client. A socket
      // that hadn't joined can't proceed (its hello failed for a SERVER
      // reason), so close it 1011: the plaza retries those with backoff,
      // unlike 1008. A joined socket stays — only this one frame failed.
      console.error('buddy-world room frame failed:', err);
      const now = this.attachmentOf(ws);
      if (!now || now.left || this.closed.has(ws)) return;
      this.trySend(ws, { type: 'error', error: 'internal error' });
      if (!now.actor) {
        this.setAttachment(ws, { district: now.district, actor: null, left: true });
        this.tryClose(ws, 1011, 'internal error');
      }
    }
  }

  async webSocketClose(ws: CfWebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // A portal-redirect close already detached the actor (null) and broadcast the
    // leave, so onClose(null) no-ops — no double announcement. A normal drop
    // still carries its actor and gets the usual single leave.
    if (this.closed.has(ws)) return; // an error already announced it
    this.closed.add(ws);
    const att = this.attachmentOf(ws);
    const core = new RoomCore<CfWebSocket>(att?.district ?? '', this.port());
    core.onClose(att?.actor ?? null);
  }

  async webSocketError(ws: CfWebSocket, _error: unknown): Promise<void> {
    // Treat a socket error like a close for presence purposes (same detach-aware
    // no-op behavior as webSocketClose).
    if (this.closed.has(ws)) return; // close already announced it
    this.closed.add(ws);
    const att = this.attachmentOf(ws);
    const core = new RoomCore<CfWebSocket>(att?.district ?? '', this.port());
    core.onClose(att?.actor ?? null);
  }
}

function parseNotice(raw: string): RoomNotice | null {
  try {
    const n = JSON.parse(raw) as Partial<{ kind: unknown; citizenId: unknown; slug: unknown }>;
    if (typeof n.citizenId !== 'string' || !n.citizenId) return null;
    if (n.kind === 'evict') return { kind: 'evict', citizenId: n.citizenId };
    if (n.kind === 'relabel' && typeof n.slug === 'string' && n.slug) {
      return { kind: 'relabel', citizenId: n.citizenId, slug: n.slug };
    }
    return null;
  } catch {
    return null;
  }
}
