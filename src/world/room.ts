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
  ROOM_NOTICE_PATH,
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
}

// What each socket stores. `district` is known at connect time (even before the
// hello authenticates), so it's available on every subsequent message without
// DO memory. `actor` is null until the hello succeeds. `citizenId` is the
// owner (server-side only, never sent) so an HTTP recall/anon change can find
// this citizen's live socket.
interface SocketAttachment {
  district: string;
  actor: ActorState | null;
  citizenId?: string;
}

const WebSocketPairCtor = (globalThis as unknown as {
  WebSocketPair: new () => WebSocketPairLike;
}).WebSocketPair;

// Coalesce move_to bursts (owner sends 5–10 Hz) into one snapshot per window.
const SNAPSHOT_FLUSH_MS = 60;

export class WorldRoom {
  private storePromise: Promise<D1WorldStore> | null = null;
  // Ephemeral batching state. Safe to lose on hibernation: positions live on the
  // sockets (attachments), so a woken room re-derives everything; at worst it
  // emits one extra full snapshot after wake. A pending timer only exists while
  // actively moving, so it never blocks an IDLE room from hibernating.
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBroadcast = new Map<string, ActorState>();

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
    return { slug: publicSlug(c), district: c.district, citizenId: c.id };
  }

  // Presence/snapshots reach only sockets that completed the hello handshake —
  // a socket that connected but never authenticated must not receive (even
  // masked) peer identities. Idle unauth sockets simply hear nothing; we don't
  // time them out (a timer would block hibernation).
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
      send: (ws, msg) => ws.send(JSON.stringify(msg)),
      broadcast: (msg, except) => this.broadcastToAuthed(msg, except),
      verify: (token) => this.verify(token),
      warp: (token, to) => this.warp(token, to),
    };
  }

  // Schedule a single coalesced snapshot for this window. A no-op if one is
  // already pending — that's the batching.
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushSnapshot();
    }, SNAPSHOT_FLUSH_MS);
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
    return (ws.deserializeAttachment() as SocketAttachment | null) ?? null;
  }

  // Every OTHER authenticated socket, rebuilt from attachments (hibernation-safe).
  private peersExcept(self: CfWebSocket) {
    const peers: Array<{ socket: CfWebSocket; state: ActorState }> = [];
    for (const ws of this.state.getWebSockets()) {
      if (ws === self) continue;
      const att = this.attachmentOf(ws);
      if (att?.actor) peers.push({ socket: ws, state: att.actor });
    }
    return peers;
  }

  // ── Cloudflare entry points ──────────────────────────────────────────────

  // Persist a RoomCore decision onto the socket and act on it.
  private apply(ws: CfWebSocket, att: SocketAttachment, res: HandleResult): void {
    if (res.detach) {
      // Left the room (portal redirect / eviction): clear the actor (and owner)
      // so this socket is gone from every presence path immediately — even
      // during the close window and across any hibernation rehydration before
      // the runtime drops it.
      ws.serializeAttachment({ district: att.district, actor: null } satisfies SocketAttachment);
    } else if (res.attach) {
      const citizenId = res.citizenId ?? att.citizenId;
      ws.serializeAttachment({ district: att.district, actor: res.attach, citizenId } satisfies SocketAttachment);
    }
    if (res.flush) this.scheduleFlush();
    if (res.close) ws.close(res.close.code, res.close.reason);
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
        this.apply(ws, att, res);
      } catch {
        // A racing close: still make sure an evicted socket is detached.
        if (notice.kind === 'evict') {
          ws.serializeAttachment({ district: att.district, actor: null } satisfies SocketAttachment);
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
    const attachment: SocketAttachment = { district, actor: null };
    server.serializeAttachment(attachment);

    return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
  }

  async webSocketMessage(ws: CfWebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const att = this.attachmentOf(ws) ?? { district: '', actor: null };
    const core = new RoomCore<CfWebSocket>(att.district, this.port());
    const res = await core.onMessage(ws, att.actor, raw, this.peersExcept(ws));
    this.apply(ws, att, res);
  }

  async webSocketClose(ws: CfWebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // A portal-redirect close already detached the actor (null) and broadcast the
    // leave, so onClose(null) no-ops — no double announcement. A normal drop
    // still carries its actor and gets the usual single leave.
    const att = this.attachmentOf(ws);
    const core = new RoomCore<CfWebSocket>(att?.district ?? '', this.port());
    core.onClose(att?.actor ?? null);
  }

  async webSocketError(ws: CfWebSocket, _error: unknown): Promise<void> {
    // Treat a socket error like a close for presence purposes (same detach-aware
    // no-op behavior as webSocketClose).
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
