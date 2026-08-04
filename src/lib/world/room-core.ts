// src/lib/world/room-core.ts
// Host-agnostic logic for a Buddy World "room" (one per town). The Cloudflare
// Durable Object (src/world/room.ts) is a thin adapter that owns the sockets and
// hibernation; ALL protocol/decision logic lives here so it is unit-tested with
// injected fakes — mirroring the worker-core.ts ↔ worker.ts split.
//
// Hibernation discipline: this module holds NO cross-request state. Every call
// receives the current socket identity (attachment) and peer list, both rebuilt
// from the sockets themselves. So a Durable Object that woke from hibernation
// with empty memory behaves identically — there is nothing to lose.

// Default spawn (fractional map coords). Real positions arrive in M3; presence
// in M2 just needs a well-defined starting point to broadcast.
export const ROOM_SPAWN = { x: 0.5, y: 0.5 } as const;

// Result of authenticating a hello's control token. `slug` is the PUBLIC id
// (already anon-masked by the adapter, exactly like handleWorld) so this module
// never sees a real anon slug. `district` is the buddy's town — it must match
// the room the socket connected to.
export interface AuthResult {
  slug: string;
  district: string;
}

// A live actor as seen on the wire. Public id only; positions default to spawn.
export interface ActorState {
  slug: string;
  x: number;
  y: number;
  seq: number;
}

export type PublicActor = ActorState;

export interface Peer<S> {
  socket: S;
  state: ActorState;
}

export type ServerMsg =
  | { type: 'welcome'; district: string; self: string; actors: PublicActor[] }
  | { type: 'join'; actor: PublicActor }
  | { type: 'leave'; slug: string }
  | { type: 'snapshot'; district: string; serverTs: number; actors: PublicActor[] }
  | { type: 'pong'; serverTs: number }
  | { type: 'room_redirect'; district: string; url: string; spawn: { x: number; y: number } }
  | { type: 'error'; error: string };

// Result of the portal-warp semantic (the adapter runs handlePortalWarp against
// D1). `ok` with a district/url on success; `ok: false` on capacity/auth/bad
// target. The room turns a success into a `leave` + `room_redirect`.
export interface WarpOutcome {
  ok: boolean;
  district?: string;
  url?: string;
  spawn?: { x: number; y: number };
  error?: string;
}

// The adapter injects transport + auth + warp + clock. `S` is the opaque socket
// handle (a real WebSocket in prod, a string in tests).
export interface RoomPort<S> {
  now(): number;
  send(socket: S, msg: ServerMsg): void;
  broadcast(msg: ServerMsg, except?: S): void;
  verify(controlToken: string): Promise<AuthResult | null>;
  // Move the control token's own citizen to `to` in D1 (idempotent, capacity
  // -gated, no XP write). Returns the redirect payload on success.
  warp(controlToken: string, to: string): Promise<WarpOutcome | null>;
}

export interface HandleResult {
  // New identity to persist on the socket (via serializeAttachment in prod).
  attach?: ActorState;
  // Ask the adapter to close the socket (protocol/auth violation).
  close?: { code: number; reason: string };
  // A position changed — ask the adapter to schedule a batched snapshot flush
  // (the 50–100 ms coalescing + timer is host-specific, so it lives there).
  flush?: boolean;
  // Clear this socket's stored actor: it has left the room (portal redirect) and
  // must be excluded from every presence path — rosters, snapshots, broadcasts,
  // and further message handling — the instant it's persisted, not just when the
  // close handler eventually fires. The departure `leave` is already broadcast,
  // so the ensuing close no-ops (a null actor has nothing to announce).
  detach?: boolean;
}

// Fractional map coordinate: finite and within the unit square.
function inUnit(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

// Build a dirty-only snapshot: only actors that are new or moved since the last
// broadcast. Returns null when nothing changed, so an idle room emits nothing.
export function planSnapshot(
  district: string,
  serverTs: number,
  prev: Map<string, ActorState>,
  next: Map<string, ActorState>
): Extract<ServerMsg, { type: 'snapshot' }> | null {
  const dirty = diffActors(prev, next);
  if (dirty.length === 0) return null;
  return { type: 'snapshot', district, serverTs, actors: dirty };
}

// Monotonic seq: accept a client intent only if it strictly advances the last
// one we honored. Drops replays/out-of-order (`move_to` uses this in M3).
export function isFreshSeq(prevSeq: number, incomingSeq: number): boolean {
  return Number.isFinite(incomingSeq) && incomingSeq > prevSeq;
}

// Dirty-only diff: the actors that are new or whose (x,y,seq) changed since the
// previous snapshot. Keeps M3 position broadcasts small — no full-roster spam.
export function diffActors(prev: Map<string, ActorState>, next: Map<string, ActorState>): PublicActor[] {
  const dirty: PublicActor[] = [];
  for (const [slug, a] of next) {
    const before = prev.get(slug);
    if (!before || before.x !== a.x || before.y !== a.y || before.seq !== a.seq) dirty.push(a);
  }
  return dirty;
}

function parse(raw: string): { type?: unknown; [k: string]: unknown } | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const CLOSE_POLICY = 1008; // WebSocket "policy violation"
const CLOSE_REDIRECT = 1000; // normal closure: you've been warped, reconnect elsewhere

export class RoomCore<S> {
  constructor(private district: string, private port: RoomPort<S>) {}

  // Handle one inbound frame. `attachment` is the socket's stored identity, or
  // null when it hasn't authenticated yet. `peers` is every OTHER currently
  // connected authenticated socket (used to build the welcome roster).
  async onMessage(socket: S, attachment: ActorState | null, raw: string, peers: Peer<S>[]): Promise<HandleResult> {
    const msg = parse(raw);
    if (!msg || typeof msg.type !== 'string') {
      this.port.send(socket, { type: 'error', error: 'malformed message' });
      return {};
    }

    // Unauthenticated: the ONLY accepted frame is a hello that authenticates.
    if (!attachment) {
      if (msg.type !== 'hello') {
        this.port.send(socket, { type: 'error', error: 'expected hello' });
        return { close: { code: CLOSE_POLICY, reason: 'unauthenticated' } };
      }
      const controlToken = msg.controlToken;
      if (typeof controlToken !== 'string' || controlToken.length < 8) {
        this.port.send(socket, { type: 'error', error: 'control token required' });
        return { close: { code: CLOSE_POLICY, reason: 'auth required' } };
      }
      const auth = await this.port.verify(controlToken);
      if (!auth) {
        this.port.send(socket, { type: 'error', error: 'invalid control token' });
        return { close: { code: CLOSE_POLICY, reason: 'auth failed' } };
      }
      if (auth.district !== this.district) {
        // The token is genuine but for a buddy in another town — the client
        // connected to the wrong room. Don't leak them into this one.
        this.port.send(socket, { type: 'error', error: 'wrong room for this buddy' });
        return { close: { code: CLOSE_POLICY, reason: 'wrong room' } };
      }

      const state: ActorState = { slug: auth.slug, x: ROOM_SPAWN.x, y: ROOM_SPAWN.y, seq: 0 };
      this.port.send(socket, {
        type: 'welcome',
        district: this.district,
        self: state.slug,
        actors: peers.map((p) => p.state),
      });
      this.port.broadcast({ type: 'join', actor: state }, socket);
      return { attach: state };
    }

    // Authenticated frames. M2 is presence-only; movement (move_to, using
    // isFreshSeq) and portal_enter land in M3/M4.
    switch (msg.type) {
      case 'move_to': {
        // Owner drives their own sprite. Drop stale/out-of-order intents (seq
        // must strictly advance) and reject coordinates outside the unit square.
        // The new position is coalesced into the next batched snapshot, never
        // broadcast inline.
        const { seq, x, y } = msg as { seq?: unknown; x?: unknown; y?: unknown };
        if (typeof seq !== 'number' || !isFreshSeq(attachment.seq, seq)) return {};
        if (!inUnit(x) || !inUnit(y)) return {};
        return { attach: { slug: attachment.slug, x, y, seq }, flush: true };
      }
      case 'portal_enter': {
        // The owner WALKED into a portal. seq is monotonic so a duplicated
        // portal_enter (same seq) is dropped — that's the dedupe. We consume the
        // seq on any fresh frame (success or failure) so a network-level replay
        // can't re-run the warp; only a NEW gesture (higher seq) retries.
        const { seq, to, controlToken } = msg as { seq?: unknown; to?: unknown; controlToken?: unknown };
        if (typeof seq !== 'number' || !isFreshSeq(attachment.seq, seq)) return {};
        const consume: HandleResult = { attach: { ...attachment, seq } };
        if (typeof to !== 'string') return consume;
        if (typeof controlToken !== 'string' || controlToken.length < 8) return consume;

        const warp = await this.port.warp(controlToken, to);
        if (!warp || !warp.ok || !warp.district || !warp.url) return consume;

        // Success: tell the OTHER occupants I left this town (excluding self so
        // my socket only hears the redirect), then redirect ME to the new one.
        // A DO cannot hand a socket to another DO, so there is no handoff — the
        // client closes, navigates to ?district=new, and reconnects there.
        this.port.broadcast({ type: 'leave', slug: attachment.slug }, socket);
        this.port.send(socket, {
          type: 'room_redirect',
          district: warp.district,
          url: warp.url,
          spawn: warp.spawn ?? { x: ROOM_SPAWN.x, y: ROOM_SPAWN.y },
        });
        // detach + close: the buddy no longer lives here, so clear its presence
        // (excluded from rosters/snapshots and refused if it keeps sending) and
        // close the socket. Closing forces a reconnect; a reconnect to THIS room
        // would fail the wrong-room check (the citizen's district moved). The
        // `leave` above is the single departure announcement — with the actor
        // now cleared, the close handler has nothing to re-announce.
        return { detach: true, close: { code: CLOSE_REDIRECT, reason: 'portal redirect' } };
      }
      case 'ping':
        this.port.send(socket, { type: 'pong', serverTs: this.port.now() });
        return {};
      case 'hello':
        // Already authenticated — ignore a duplicate handshake.
        return {};
      default:
        // Unknown/not-yet-supported verb: ignore rather than disconnect.
        return {};
    }
  }

  // A socket dropped. If it had joined, tell the room it left.
  onClose(attachment: ActorState | null): void {
    if (!attachment) return;
    this.port.broadcast({ type: 'leave', slug: attachment.slug });
  }
}
