// src/lib/world/handlers.ts
// Framework-agnostic request handlers for Buddy World. The Cloudflare
// Worker (and any future host) adapts HTTP to these; all logic and
// validation lives here where it is tested against a real SQLite store.

import { createHash } from 'node:crypto';
import { validateSnapshot, type WorldSnapshot } from './validate.js';
import { isNameClean } from './identity.js';
import { spendXpBudget } from './antiabuse.js';
import { levelFromXp } from '../leveling.js';
import type { WorldStore, CitizenRow } from './store.js';

export const MAX_EVENT_BATCH = 50;

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

// The ONLY path that may write xp/level to an existing citizen: refills the
// persisted budget, spends it on the claimed delta, re-derives level from
// granted XP, and flags anything that exceeded the budget.
async function applyClampedSnapshot(
  citizen: CitizenRow,
  snap: WorldSnapshot,
  store: WorldStore,
  now: number
): Promise<void> {
  const elapsed = now - citizen.last_seen_at;
  const requested = snap.xp - citizen.xp;
  const spend = spendXpBudget(citizen.xp_bucket, elapsed, requested);
  const decreased = requested < 0;
  const effectiveXp = decreased ? citizen.xp : citizen.xp + spend.granted;
  const effective: WorldSnapshot =
    spend.flagged || decreased || effectiveXp !== snap.xp
      ? { ...snap, xp: effectiveXp, level: levelFromXp(effectiveXp) }
      : snap;
  await store.updateSnapshot(citizen.id, effective, now, spend.budget);
  if (spend.flagged || decreased) await store.markFlagged(citizen.id);
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

  const tokenHash = hashToken(payload.token);
  // ACCEPTED RISK: a first teleport's claimed XP is trusted (the server
  // never saw the buddy's local history — that's inherent to opt-in sync
  // of a local-first game). Mitigations: level must match the XP curve,
  // fresh citizens start with a near-empty budget (no fast growth on top),
  // and analytics can segment by entry level. Post-creation changes all go
  // through the clamped path below.
  const result = await store.teleport(tokenHash, snap, opts.now);
  if (!result.created) {
    // Existing citizen: snapshot changes go through the clamp, never around it.
    const citizen = await store.findByTokenHash(tokenHash);
    if (citizen) await applyClampedSnapshot(citizen, snap, store, opts.now);
  }
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

  if (Array.isArray(payload.events) && payload.events.length > MAX_EVENT_BATCH) {
    return bad(400, `event batch exceeds ${MAX_EVENT_BATCH}`);
  }

  let accepted = 0;
  if (Array.isArray(payload.events)) {
    accepted = await store.recordEvents(citizen.id, payload.events as Array<{ type: string; ts: number }>);
  }

  if (payload.snapshot) {
    const snap = payload.snapshot as WorldSnapshot;
    const valid = validateSnapshot(snap);
    if (!valid.ok) return bad(400, valid.reason);
    await applyClampedSnapshot(citizen, snap, store, opts.now);
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
    // Internal moderation/accounting fields never leave the server.
    const { flagged: _f, hidden: _h, xp_bucket: _b, ...pub } = c;
    if (!pub.anon) return pub;
    const masked = `anon-${hashToken(pub.slug).slice(0, 6)}`;
    anonSlugByReal.set(pub.slug, masked);
    return { ...pub, name: `a wild ${pub.species}`, slug: masked };
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

  // Memory bound for attacker-minted keys: when the map hits the cap we
  // drop expired windows, and failing that, reset. Resetting briefly
  // forgives counts, which is acceptable — the XP bucket is the real
  // economic backstop; this limiter is volumetric.
  private static MAX_KEYS = 10_000;

  constructor(private max: number, private windowMs: number) {}

  allow(key: string, now: number): boolean {
    if (this.windows.size >= RateLimiter.MAX_KEYS && !this.windows.has(key)) {
      for (const [k, w] of this.windows) {
        if (now - w.start >= this.windowMs) this.windows.delete(k);
      }
      if (this.windows.size >= RateLimiter.MAX_KEYS) this.windows.clear();
    }
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
