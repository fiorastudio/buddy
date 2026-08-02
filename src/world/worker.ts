// src/world/worker.ts
// Cloudflare Worker entry for Buddy World. Everything testable lives in
// worker-core.ts; this file only binds the Cloudflare environment.
//
// Deploy (from world/):
//   wrangler d1 create buddy-world && wrangler d1 migrations apply buddy-world
//   wrangler deploy
// Requires compatibility_flags = ["nodejs_compat"] (node:crypto usage).

import { createWorldFetchHandler } from './worker-core.js';
import { D1WorldStore, type D1Like } from '../lib/world/d1-store.js';

interface Env {
  DB: D1Like;
  BASE_URL?: string;
}

let handler: ((req: Request) => Promise<Response>) | null = null;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    handler ??= createWorldFetchHandler({
      db: env.DB,
      baseUrl: env.BASE_URL ?? 'https://world.buddy-mcp.com',
      ratePerMinute: 60,
    });
    return handler(req);
  },

  // Nightly analytics rollup (wrangler.toml cron trigger): aggregate
  // yesterday's events into daily_rollups.
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const store = await D1WorldStore.create(env.DB);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await store.rollup(yesterday);
  },
};
