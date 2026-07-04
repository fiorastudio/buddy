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
  handleAnon,
  RateLimiter,
  type HandlerResult,
} from '../lib/world/handlers.js';
import type { WorldStore } from '../lib/world/store.js';

export interface WorldWorkerConfig {
  db: D1Like;
  baseUrl: string;
  ratePerMinute?: number;
  now?: () => number;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(result: HandlerResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

export function createWorldFetchHandler(config: WorldWorkerConfig): (req: Request) => Promise<Response> {
  const limiter = new RateLimiter(config.ratePerMinute ?? 60, 60_000);
  const now = config.now ?? (() => Date.now());
  let storePromise: Promise<WorldStore> | null = null;

  function store(): Promise<WorldStore> {
    // Lazy: D1 migrations may not have applied when the isolate boots.
    storePromise ??= D1WorldStore.create(config.db);
    return storePromise;
  }

  return async function fetchHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const opts = { now: now(), baseUrl: config.baseUrl };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const worldMatch = url.pathname.match(/^\/v1\/world\/([a-z0-9-]+)$/);
    if (req.method === 'GET' && worldMatch) {
      return json(await handleWorld(worldMatch[1], await store(), opts));
    }

    if (req.method === 'POST' && ['/v1/teleport', '/v1/events', '/v1/recall', '/v1/anon'].includes(url.pathname)) {
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
          return json(await handleRecall(payload, s));
        case '/v1/anon':
          return json(await handleAnon(payload, s));
      }
    }

    return json({ status: 404, body: { error: 'not found' } });
  };
}
