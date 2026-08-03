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
  type RoomPort,
  type ActorState,
  type AuthResult,
} from '../lib/world/room-core.js';
import { D1WorldStore, type D1Like } from '../lib/world/d1-store.js';
import { hashToken } from '../lib/world/handlers.js';
import type {
  CfWebSocket,
  DurableObjectStateLike,
  WebSocketPairLike,
} from './runtime.js';

interface RoomEnv {
  DB: D1Like;
}

// What each socket stores. `district` is known at connect time (even before the
// hello authenticates), so it's available on every subsequent message without
// DO memory. `actor` is null until the hello succeeds.
interface SocketAttachment {
  district: string;
  actor: ActorState | null;
}

const WebSocketPairCtor = (globalThis as unknown as {
  WebSocketPair: new () => WebSocketPairLike;
}).WebSocketPair;

export class WorldRoom {
  private storePromise: Promise<D1WorldStore> | null = null;

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
    const slug = c.anon ? `anon-${hashToken(c.slug).slice(0, 6)}` : c.slug;
    return { slug, district: c.district };
  }

  private port(): RoomPort<CfWebSocket> {
    return {
      now: () => Date.now(),
      send: (ws, msg) => ws.send(JSON.stringify(msg)),
      broadcast: (msg, except) => {
        const frame = JSON.stringify(msg);
        for (const ws of this.state.getWebSockets()) {
          if (ws === except) continue;
          // Presence reaches only sockets that completed the hello handshake —
          // a socket that connected but never authenticated must not receive
          // (even masked) peer identities. Idle unauth sockets simply hear
          // nothing; we don't time them out (a timer would block hibernation).
          if (!this.attachmentOf(ws)?.actor) continue;
          try {
            ws.send(frame);
          } catch {
            // a racing close; the socket will surface via webSocketClose
          }
        }
      },
      verify: (token) => this.verify(token),
    };
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

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
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
    if (res.attach) {
      ws.serializeAttachment({ district: att.district, actor: res.attach } satisfies SocketAttachment);
    }
    if (res.close) ws.close(res.close.code, res.close.reason);
  }

  async webSocketClose(ws: CfWebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const att = this.attachmentOf(ws);
    const core = new RoomCore<CfWebSocket>(att?.district ?? '', this.port());
    core.onClose(att?.actor ?? null);
  }

  async webSocketError(ws: CfWebSocket, _error: unknown): Promise<void> {
    // Treat a socket error like a close for presence purposes.
    const att = this.attachmentOf(ws);
    const core = new RoomCore<CfWebSocket>(att?.district ?? '', this.port());
    core.onClose(att?.actor ?? null);
  }
}
