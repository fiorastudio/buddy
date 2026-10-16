// src/world/worker-core.ts
// HTTP routing for Buddy World, host-agnostic: built on the standard
// Request/Response types available in both Cloudflare Workers and Node 20+.
// worker.ts (the Cloudflare entry) binds this to D1; tests bind it to SQLite.

import { D1WorldStore, type D1Like } from '../lib/world/d1-store.js';
import {
  handleTeleport,
  handleEvents,
  handleRecall,
  handleWorld,
  handleAnnouncements,
  handleAnon,
  handleBrowserLink,
  handleBrowserSession,
  handleMe,
  RateLimiter,
  type HandlerResult,
  type RoomNotifier,
} from '../lib/world/handlers.js';
import { districtForTown, TOWN_NAMES } from '../lib/world/towns.js';
import { ROOM_NOTICE_PATH } from '../lib/world/room-core.js';
import type { WorldStore } from '../lib/world/store.js';
import type { DurableObjectNamespaceLike } from './runtime.js';

export interface WorldWorkerConfig {
  db: D1Like;
  baseUrl: string;
  ratePerMinute?: number;
  // Live-room websocket upgrades per client IP per minute (default 30). Each
  // upgrade is a socket the room holds and, on hello, a D1 lookup; the plaza
  // reconnects with capped exponential backoff, so a real viewer needs few.
  upgradesPerMinute?: number;
  // Keys the anon mask (handlers.publicSlug). MUST be set in production
  // (`wrangler secret put ANON_SECRET`); absent → a public dev constant.
  anonSecret?: string;
  now?: () => number;
  // The WorldRoom Durable Object namespace. Absent in older/preview contexts —
  // the live route then reports 503 rather than crashing.
  roomNamespace?: DurableObjectNamespaceLike;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  // `authorization` so the browser can send the Bearer control token to /v1/me.
  'access-control-allow-headers': 'content-type, authorization',
};

// Push a recall/anon change into the live rooms. EVERY town's room is told, not
// just the citizen's stored district: a socket is only district-checked at
// hello, so one can still be live in a town its owner has since teleported out
// of. Six rooms, rare action — cheap. Best-effort: the D1 write (and token
// revocation) already happened, so a room that can't be reached must not fail
// the owner's request.
export function roomNotifier(ns: DurableObjectNamespaceLike | undefined): RoomNotifier | undefined {
  if (!ns) return undefined;
  return async (notice) => {
    const body = JSON.stringify(notice);
    const results = await Promise.allSettled(
      TOWN_NAMES.map(async (_, i) => {
        const district = `plaza-${i + 1}`;
        const stub = ns.get(ns.idFromName(district));
        const res = await stub.fetch(
          new Request(`https://room.internal${ROOM_NOTICE_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
        );
        // Always drain the body: an unread DO response keeps the subrequest
        // open (and the room unable to hibernate) until it is GC'd.
        await res.text();
        if (!res.ok) throw new Error(`room ${district} answered ${res.status}`);
      })
    );
    for (const r of results) {
      if (r.status === 'rejected') console.error('buddy-world room notice failed:', r.reason);
    }
  };
}

function json(result: HandlerResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

export function createWorldFetchHandler(config: WorldWorkerConfig): (req: Request) => Promise<Response> {
  const limiter = new RateLimiter(config.ratePerMinute ?? 60, 60_000);
  const upgradeLimiter = new RateLimiter(config.upgradesPerMinute ?? 30, 60_000);
  const now = config.now ?? (() => Date.now());
  let storePromise: Promise<WorldStore> | null = null;
  const notifyRooms = roomNotifier(config.roomNamespace);

  function store(): Promise<WorldStore> {
    // Lazy: D1 migrations may not have applied when the isolate boots. Clear the
    // cache on failure so a transient init error doesn't poison the isolate for
    // its whole lifetime — the next request retries instead of reusing a
    // rejected promise.
    storePromise ??= D1WorldStore.create(config.db).catch((err) => {
      storePromise = null;
      throw err;
    });
    return storePromise;
  }

  return async function fetchHandler(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      // Cloudflare fills `request.cf.country` (ISO 3166-1 alpha-2) for free,
      // derived server-side from the IP; the `cf-ipcountry` header is the
      // fallback. Absent off-Cloudflare — handlers treat undefined as "no flag".
      const cf = (req as { cf?: { country?: string } }).cf;
      const country = cf?.country ?? req.headers.get('cf-ipcountry') ?? undefined;
      const opts = { now: now(), baseUrl: config.baseUrl, country, anonSecret: config.anonSecret };

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // WebSocket upgrade for the live room — MUST come before the JSON routes:
      // the 101 handshake response is returned RAW (no json()/CORS wrapping), and
      // a Durable Object cannot be reached through the D1 store path.
      const liveMatch = url.pathname.match(/^\/v1\/live\/([a-z0-9-]+)$/);
      if (liveMatch && req.headers.get('Upgrade') === 'websocket') {
        const district = districtForTown(liveMatch[1]);
        if (!district) return json({ status: 404, body: { error: 'unknown town' } });
        if (!config.roomNamespace) return json({ status: 503, body: { error: 'rooms unavailable' } });
        const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
        if (!upgradeLimiter.allow(`ip:${ip}`, opts.now)) {
          return json({ status: 429, body: { error: 'rate limited' } });
        }
        // Key the room by the VALIDATED district and forward it explicitly so the
        // DO trusts the worker's validation, not raw path input.
        const roomUrl = new URL(req.url);
        roomUrl.searchParams.set('district', district);
        const stub = config.roomNamespace.get(config.roomNamespace.idFromName(district));
        return stub.fetch(new Request(roomUrl.toString(), req));
      }

      const worldMatch = url.pathname.match(/^\/v1\/world\/([a-z0-9-]+)$/);
      if (req.method === 'GET' && worldMatch) {
        return json(await handleWorld(worldMatch[1], await store(), opts));
      }

      // Global celebration feed for the RO-yellow broadcast banner (M6). GET,
      // cross-town, no district in the path — one feed shared by every town.
      if (req.method === 'GET' && url.pathname === '/v1/announcements') {
        return json(await handleAnnouncements(await store(), opts));
      }

      // Bearer control token (browser can't set headers on WS, but this is HTTP).
      if (req.method === 'GET' && url.pathname === '/v1/me') {
        const auth = req.headers.get('authorization') ?? '';
        const controlToken = auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
        return json(await handleMe(controlToken, await store(), opts));
      }

      if (
        req.method === 'POST' &&
        ['/v1/teleport', '/v1/events', '/v1/recall', '/v1/anon', '/v1/browser-link', '/v1/browser-session'].includes(
          url.pathname
        )
      ) {
        let payload: Record<string, unknown>;
        try {
          payload = (await req.json()) as Record<string, unknown>;
        } catch {
          return json({ status: 400, body: { error: 'invalid JSON' } });
        }

        // IP limit first — attacker-chosen tokens must not mint fresh buckets
        // (limiter-rotation finding). Token bucket is a secondary, tighter
        // scope for legitimate multi-user NATs.
        const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
        if (!limiter.allow(`ip:${ip}`, opts.now)) {
          return json({ status: 429, body: { error: 'rate limited' } });
        }
        if (typeof payload.token === 'string' && !limiter.allow(`t:${payload.token}`, opts.now)) {
          return json({ status: 429, body: { error: 'rate limited' } });
        }

        const s = await store();
        switch (url.pathname) {
          case '/v1/teleport':
            return json(await handleTeleport(payload, s, opts));
          case '/v1/events':
            return json(await handleEvents(payload, s, opts));
          case '/v1/recall':
            return json(await handleRecall(payload, s, notifyRooms));
          case '/v1/anon':
            return json(await handleAnon(payload, s, notifyRooms, opts));
          case '/v1/browser-link':
            return json(await handleBrowserLink(payload, s, opts));
          case '/v1/browser-session':
            return json(await handleBrowserSession(payload, s, opts));
        }
      }

      return json({ status: 404, body: { error: 'not found' } });
    } catch (err) {
      // Controlled failure: never leak a raw Cloudflare 1101. Log the real
      // exception for `wrangler tail` and return JSON (with CORS) to callers.
      console.error('buddy-world worker error:', err);
      return json({ status: 500, body: { error: 'internal error' } });
    }
  };
}
