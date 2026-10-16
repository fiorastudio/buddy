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
  handleRevokeBrowserSessions,
  handleMe,
  RateLimiter,
  NEW_CITIZENS_PER_IP_PER_DAY,
  NEW_CITIZEN_WINDOW_MS,
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
  // Brand-new citizens one IP may create per day (default NEW_CITIZENS_PER_IP_PER_DAY).
  newCitizensPerDay?: number;
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

// Request body cap for the JSON POST routes (B16). The largest legitimate body
// is /v1/events with a full batch: MAX_EVENT_BATCH (50) events of roughly 45
// bytes each, plus a snapshot of about 350 bytes and a 32-hex token. That is
// about 3 KB (see the worker test that builds the worst case). 16 KB leaves
// more than 5x headroom for future fields while bounding how much an anonymous
// caller can make the isolate buffer and parse.
export const MAX_BODY_BYTES = 16 * 1024;

type ParsedBody = { ok: true; payload: Record<string, unknown> } | { ok: false; result: HandlerResult };

// Read at most `limit` bytes of the body and parse it as a JSON object.
// Content-Length is checked up front, but it may be absent (chunked) or lie,
// so the byte count is enforced again while streaming: we stop reading (and
// cancel the stream) as soon as it goes over.
async function readJsonObject(req: Request, limit: number): Promise<ParsedBody> {
  const tooLarge: ParsedBody = {
    ok: false,
    result: { status: 413, body: { error: `request body exceeds ${limit} bytes` } },
  };
  const invalid: ParsedBody = { ok: false, result: { status: 400, body: { error: 'invalid JSON' } } };

  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) return tooLarge;
  if (!req.body) return invalid;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return tooLarge;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return invalid;
  }
  // Every route reads named fields off the payload; a bare string, number,
  // array or null is a client bug (or a probe), not a request.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, result: { status: 400, body: { error: 'request body must be a JSON object' } } };
  }
  return { ok: true, payload: value as Record<string, unknown> };
}

export function createWorldFetchHandler(config: WorldWorkerConfig): (req: Request) => Promise<Response> {
  const limiter = new RateLimiter(config.ratePerMinute ?? 60, 60_000);
  const newCitizenLimiter = new RateLimiter(
    config.newCitizensPerDay ?? NEW_CITIZENS_PER_IP_PER_DAY,
    NEW_CITIZEN_WINDOW_MS
  );
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
        [
          '/v1/teleport',
          '/v1/events',
          '/v1/recall',
          '/v1/anon',
          '/v1/browser-link',
          '/v1/browser-session',
          '/v1/browser-sessions/revoke',
        ].includes(url.pathname)
      ) {
        // IP limit first, BEFORE the body is read or parsed (B16): a limited
        // client must not get the server to buffer and parse its payload. It
        // also comes before the token limit so attacker-chosen tokens can't
        // mint fresh buckets (limiter-rotation finding).
        const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
        if (!limiter.allow(`ip:${ip}`, opts.now)) {
          return json({ status: 429, body: { error: 'rate limited' } });
        }

        const parsed = await readJsonObject(req, MAX_BODY_BYTES);
        if (!parsed.ok) return json(parsed.result);
        const payload = parsed.payload;

        // Token bucket: a secondary, tighter scope for legitimate multi-user NATs.
        if (typeof payload.token === 'string' && !limiter.allow(`t:${payload.token}`, opts.now)) {
          return json({ status: 429, body: { error: 'rate limited' } });
        }

        const s = await store();
        switch (url.pathname) {
          case '/v1/teleport':
            // Per-IP new-citizen throttle: consulted only when this teleport
            // would mint a NEW citizen (re-teleports never spend it).
            return json(
              await handleTeleport(payload, s, {
                ...opts,
                allowNewCitizen: () => newCitizenLimiter.allow(`new:${ip}`, opts.now),
              })
            );
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
          case '/v1/browser-sessions/revoke':
            return json(await handleRevokeBrowserSessions(payload, s, notifyRooms));
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
