// src/lib/world/handlers.ts
// Framework-agnostic request handlers for Buddy World. The Cloudflare
// Worker (and any future host) adapts HTTP to these; all logic and
// validation lives here where it is tested against a real SQLite store.

import { createHash } from 'node:crypto';
import { validateSnapshot, type WorldSnapshot } from './validate.js';
import { isNameClean } from './identity.js';
import { clampXpDelta } from './antiabuse.js';
import { levelFromXp } from '../leveling.js';
import type { WorldStore } from './store.js';

export interface HandlerResult {
  status: number;
  body: unknown;
}

export interface HandlerOpts {
  now: number;
  baseUrl: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function bad(status: number, error: string): HandlerResult {
  return { status, body: { error } };
}

export async function handleTeleport(
  payload: { token?: unknown; snapshot?: unknown },
  store: WorldStore,
  opts: HandlerOpts
): Promise<HandlerResult> {
  if (typeof payload.token !== 'string' || payload.token.length < 8) {
    return bad(400, 'missing or malformed token');
  }
  const snap = payload.snapshot as WorldSnapshot;
  const valid = validateSnapshot(snap);
  if (!valid.ok) return bad(400, valid.reason);
  if (!isNameClean(snap.name)) return bad(400, 'name rejected by filter');

  const result = await store.teleport(hashToken(payload.token), snap, opts.now);
  return {
    status: 200,
    body: {
      slug: result.slug,
      district: result.district,
      url: `${opts.baseUrl}/b/${result.slug}`,
      created: result.created,
    },
  };
}

export async function handleEvents(
  payload: { token?: unknown; events?: unknown; snapshot?: unknown },
  store: WorldStore,
  opts: HandlerOpts
): Promise<HandlerResult> {
  if (typeof payload.token !== 'string') return bad(401, 'unknown token');
  const citizen = await store.findByTokenHash(hashToken(payload.token));
  if (!citizen) return bad(401, 'unknown token');

  let accepted = 0;
  if (Array.isArray(payload.events)) {
    accepted = await store.recordEvents(citizen.id, payload.events as Array<{ type: string; ts: number }>);
  }

  if (payload.snapshot) {
    const snap = payload.snapshot as WorldSnapshot;
    const valid = validateSnapshot(snap);
    if (!valid.ok) return bad(400, valid.reason);

    const clamp = clampXpDelta(citizen.xp, snap.xp, opts.now - citizen.last_seen_at);
    const effective: WorldSnapshot = clamp.flagged
      ? { ...snap, xp: clamp.xp, level: levelFromXp(clamp.xp) }
      : snap;
    await store.updateSnapshot(citizen.id, effective, opts.now);
    if (clamp.flagged) await store.markFlagged(citizen.id);
  }

  return { status: 200, body: { accepted } };
}

export async function handleRecall(
  payload: { token?: unknown; purge?: unknown },
  store: WorldStore
): Promise<HandlerResult> {
  if (typeof payload.token !== 'string') return bad(401, 'unknown token');
  const ok = await store.recall(hashToken(payload.token), payload.purge === true);
  if (!ok) return bad(401, 'unknown token');
  return { status: 200, body: { recalled: true, purged: payload.purge === true } };
}

export async function handleAnon(
  payload: { token?: unknown; anon?: unknown },
  store: WorldStore
): Promise<HandlerResult> {
  if (typeof payload.token !== 'string') return bad(401, 'unknown token');
  const ok = await store.setAnon(hashToken(payload.token), payload.anon === true);
  if (!ok) return bad(401, 'unknown token');
  return { status: 200, body: { anon: payload.anon === true } };
}

export async function handleWorld(
  district: string,
  store: WorldStore,
  _opts: HandlerOpts
): Promise<HandlerResult> {
  const view = await store.district(district, _opts.now - 3_600_000);
  const anonSlugByReal = new Map<string, string>();

  const citizens = view.citizens.map((c) => {
    if (!c.anon) return c;
    const masked = `anon-${hashToken(c.slug).slice(0, 6)}`;
    anonSlugByReal.set(c.slug, masked);
    return { ...c, name: `a wild ${c.species}`, slug: masked };
  });

  const events = view.events.map((e) =>
    anonSlugByReal.has(e.citizen_slug) ? { ...e, citizen_slug: anonSlugByReal.get(e.citizen_slug)! } : e
  );

  return { status: 200, body: { district, citizens, events } };
}

// Fixed-window rate limiter. Per-isolate in the Worker: best-effort, which
// is the right cost/benefit for a toy world (real abuse gets the XP clamp).
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(private max: number, private windowMs: number) {}

  allow(key: string, now: number): boolean {
    const win = this.windows.get(key);
    if (!win || now - win.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    if (win.count >= this.max) return false;
    win.count++;
    return true;
  }
}
