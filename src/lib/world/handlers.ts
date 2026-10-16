// src/lib/world/handlers.ts
// Framework-agnostic request handlers for Buddy World. The Cloudflare
// Worker (and any future host) adapts HTTP to these; all logic and
// validation lives here where it is tested against a real SQLite store.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { validateSnapshot, type WorldSnapshot } from './validate.js';
import { isNameClean } from './identity.js';
import { spendXpBudget } from './antiabuse.js';
import { levelFromXp } from '../leveling.js';
import { districtForTown, townForDistrict } from './towns.js';
import { portalBetween, spawnInto } from './portals.js';
import { DISTRICT_CAPACITY } from './districts.js';
import type { WorldStore, CitizenRow } from './store.js';

export const MAX_EVENT_BATCH = 50;

// Browser identity (M1). The control token is scoped to driving your own sprite;
// it is NOT the world token and can never teleport/recall/write XP.
export const CONTROL_TOKEN_SCOPE = 'move,portal_warp';
// Link codes are short-lived: minted by the CLI, redeemed by the browser at once.
export const LINK_CODE_TTL_MS = 30 * 60_000; // 30 minutes (single-use; roomy enough to paste a link and click it later)
// Control tokens live in localStorage across sessions, so a generous window.
export const CONTROL_TOKEN_TTL_MS = 30 * 86_400_000; // 30 days

export interface HandlerResult {
  status: number;
  body: unknown;
}

export interface HandlerOpts {
  now: number;
  baseUrl: string;
  // ISO 3166-1 alpha-2 origin of the request (Cloudflare `request.cf.country`
  // or the `cf-ipcountry` header). Server-derived from the IP, so it's not
  // client-spoofable. Absent off-Cloudflare (tests, self-host).
  country?: string;
  // Server secret keying the anon mask (see publicSlug). Production sets it
  // with `wrangler secret put ANON_SECRET`; absent → DEV_ANON_SECRET.
  anonSecret?: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// The id a citizen is known by in PUBLIC surfaces (/v1/world, announcements,
// live rooms): the real slug, or a stable `anon-xxxxxx` mask when anon. One
// definition so the room's wire identity can never drift from the plaza's.
//
// The mask is an HMAC keyed by a SERVER SECRET (B10). Slugs are public (every
// non-anon buddy shows one, and an anon buddy showed its own before toggling),
// so an unkeyed hash let anyone precompute slug → mask and unmask anon buddies.
export const DEV_ANON_SECRET = 'buddy-world-dev-anon-secret--set-ANON_SECRET-in-production';
export function publicSlug(c: { slug: string; anon: boolean }, secret?: string): string {
  if (!c.anon) return c.slug;
  const mac = createHmac('sha256', secret || DEV_ANON_SECRET).update(c.slug).digest('hex');
  return `anon-${mac.slice(0, 6)}`;
}

// The plaza's activity thresholds (world/public/plaza.js ACTIVE_WINDOW_MS /
// IDLE_SIT_MS): a glow under 15 min, a long-AFK sit from 3 h.
const ANON_ACTIVE_MS = 15 * 60_000;
const ANON_SIT_MS = 3 * 3_600_000;

// An anon buddy's last_seen_at, coarsened to the three states the plaza
// renders (active / idle / long-AFK) instead of a millisecond timestamp that
// can be matched against the owner's activity elsewhere. Each bucket sits well
// inside its band, so a client clock a few minutes off renders the same.
export function coarseLastSeen(lastSeenAt: number, now: number): number {
  const minute = now - (now % 60_000);
  const age = now - lastSeenAt;
  if (age < ANON_ACTIVE_MS) return minute;
  if (age < ANON_SIT_MS) return minute - 3_600_000;
  return minute - 24 * 3_600_000;
}

// The highest stat, ties to the first in the canonical order — the plaza's
// behavior pick (dominantStat) needs only which one leads, not the numbers.
const STAT_ORDER = ['debugging', 'patience', 'chaos', 'wisdom', 'snark'] as const;
function peakStat(stats: Record<string, number> | null | undefined): string {
  let peak: string = STAT_ORDER[0];
  for (const k of STAT_ORDER) if ((stats?.[k] ?? 0) > (stats?.[peak] ?? 0)) peak = k;
  return peak;
}

// The public view of an ANON citizen: an allow-list of what the plaza renders,
// at the coarsest grain that still renders it. Dropped: created_at, exact xp,
// the five exact stats, hat, skin, rarity, the eye glyph — together a
// fingerprint that matched the masked buddy back to its public self. Kept:
// species/level/mood/avatar/shiny (sprite and nameplate), the leading stat
// (wander behavior), coarse activity. New columns stay private by default.
function anonView(c: Omit<CitizenRow, 'id'>, opts: HandlerOpts) {
  return {
    slug: publicSlug(c, opts.anonSecret),
    name: `a wild ${c.species}`,
    species: c.species,
    level: c.level,
    mood: c.mood,
    shiny: c.shiny,
    avatar: c.avatar,
    eye: '·',
    stats: { [peakStat(c.stats as unknown as Record<string, number>)]: 1 },
    anon: true,
    country: null,
    district: c.district,
    last_seen_at: coarseLastSeen(c.last_seen_at, opts.now),
  };
}

// Privacy changes made over HTTP must reach sockets already live in a room
// (a Durable Object). The host injects this; the handlers stay host-agnostic
// and it is simply absent (no-op) where there are no rooms (tests, self-host).
//   evict   — recall/purge: drop the citizen's live socket(s) for good.
//   relabel — anon toggle: re-key the live actor under its new public slug.
export type RoomNotice =
  | { kind: 'evict'; citizenId: string }
  | { kind: 'relabel'; citizenId: string; slug: string };
export type RoomNotifier = (notice: RoomNotice) => Promise<void>;

// Sanitize an origin country to a bare ISO 3166-1 alpha-2 code, or null.
// Cloudflare uses `XX`/`T1` sentinels for unknown/Tor — those normalize away
// (not `[A-Z]{2}` real countries, or explicitly filtered) so they show no flag.
export function normalizeCountry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cc = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  if (cc === 'XX' || cc === 'T1') return null; // CF sentinels: unknown / Tor
  return cc;
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
  payload: { token?: unknown; snapshot?: unknown; district?: unknown },
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

  // Optional chosen destination: an owner may pick a town by name (or plaza-N)
  // to teleport into, or move to when re-teleporting.
  let desiredDistrict: string | undefined;
  if (payload.district !== undefined && payload.district !== null && payload.district !== '') {
    if (typeof payload.district !== 'string') return bad(400, 'unknown_town');
    const resolved = districtForTown(payload.district);
    if (!resolved) return bad(400, 'unknown_town');
    // Capacity gate — but never bounce someone who already lives there.
    const counts = await store.districtCounts();
    if ((counts[resolved] ?? 0) >= DISTRICT_CAPACITY) {
      const current = await store.findByTokenHash(tokenHash);
      if (current?.district !== resolved) return bad(409, 'town_full');
    }
    desiredDistrict = resolved;
  }
  // ACCEPTED RISK: a first teleport's claimed XP is trusted (the server
  // never saw the buddy's local history — that's inherent to opt-in sync
  // of a local-first game). Mitigations: level must match the XP curve,
  // fresh citizens start with a near-empty budget (no fast growth on top),
  // and analytics can segment by entry level. Post-creation changes all go
  // through the clamped path below.
  const country = normalizeCountry(opts.country);
  const result = await store.teleport(tokenHash, snap, opts.now, desiredDistrict, country);
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
      // Link to the plaza the buddy is actually in. (A per-buddy /b/<slug> deep
      // link would need a slug→district lookup API + a focus route — not built
      // yet; this URL is guaranteed reachable and shows them wandering.)
      url: `${opts.baseUrl}/?district=${result.district}`,
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
  store: WorldStore,
  notifyRooms?: RoomNotifier
): Promise<HandlerResult> {
  if (typeof payload.token !== 'string') return bad(401, 'unknown token');
  const tokenHash = hashToken(payload.token);
  // Resolve the id BEFORE the write: a purge deletes the row.
  const citizen = await store.findByTokenHash(tokenHash);
  const ok = await store.recall(tokenHash, payload.purge === true);
  if (!ok || !citizen) return bad(401, 'unknown token');
  // The store already revoked every control token; this kicks the socket(s)
  // that are connected right now, which never re-authenticate on their own.
  await notifyRooms?.({ kind: 'evict', citizenId: citizen.id });
  return { status: 200, body: { recalled: true, purged: payload.purge === true } };
}

export async function handleAnon(
  payload: { token?: unknown; anon?: unknown },
  store: WorldStore,
  notifyRooms?: RoomNotifier,
  opts: Pick<HandlerOpts, 'anonSecret'> = {}
): Promise<HandlerResult> {
  if (typeof payload.token !== 'string') return bad(401, 'unknown token');
  const anon = payload.anon === true;
  const tokenHash = hashToken(payload.token);
  const ok = await store.setAnon(tokenHash, anon);
  if (!ok) return bad(401, 'unknown token');
  const citizen = await store.findByTokenHash(tokenHash);
  // A live socket keeps the identity it joined with; re-key it to the new
  // public slug (masked exactly like /v1/world) so `anon on` takes effect now.
  if (citizen) await notifyRooms?.({ kind: 'relabel', citizenId: citizen.id, slug: publicSlug({ ...citizen, anon }, opts.anonSecret) });
  return { status: 200, body: { anon } };
}

// browser-link: the owner proves control with the REAL world token and gets a
// short-lived, single-use code embedded in a personal plaza URL. The world token
// itself never reaches the browser.
export async function handleBrowserLink(
  payload: { token?: unknown },
  store: WorldStore,
  opts: HandlerOpts
): Promise<HandlerResult> {
  if (typeof payload.token !== 'string' || payload.token.length < 8) {
    return bad(400, 'missing or malformed token');
  }
  const citizen = await store.findByTokenHash(hashToken(payload.token));
  if (!citizen) return bad(401, 'unknown token');

  const code = randomBytes(16).toString('hex');
  await store.createLinkCode(citizen.id, hashToken(code), opts.now + LINK_CODE_TTL_MS);
  // Code rides in the URL fragment (never sent to the server on navigation);
  // the browser reads it, exchanges it via /v1/browser-session, then drops it.
  return {
    status: 200,
    body: {
      code,
      district: citizen.district,
      url: `${opts.baseUrl}/?district=${citizen.district}#code=${code}`,
    },
  };
}

// browser-session: exchange a one-time code for a scoped control token. The
// consume is atomic and single-use — a replayed code fails here.
export async function handleBrowserSession(
  payload: { code?: unknown },
  store: WorldStore,
  opts: HandlerOpts
): Promise<HandlerResult> {
  if (typeof payload.code !== 'string' || payload.code.length < 8) {
    return bad(400, 'missing or malformed code');
  }
  const citizenId = await store.consumeLinkCode(hashToken(payload.code), opts.now);
  if (!citizenId) return bad(401, 'invalid or expired code');

  const controlToken = randomBytes(24).toString('hex');
  await store.createBrowserSession(
    citizenId,
    hashToken(controlToken),
    CONTROL_TOKEN_SCOPE,
    opts.now + CONTROL_TOKEN_TTL_MS
  );
  return {
    status: 200,
    body: { controlToken, scope: CONTROL_TOKEN_SCOPE, capabilities: CONTROL_TOKEN_SCOPE.split(',') },
  };
}

// me: a Bearer control token → who am I. Deliberately BYPASSES anon masking so
// the owner learns their own real slug even while anon to spectators.
export async function handleMe(
  controlToken: string | undefined,
  store: WorldStore,
  opts: HandlerOpts
): Promise<HandlerResult> {
  if (typeof controlToken !== 'string' || controlToken.length < 8) {
    return bad(401, 'missing control token');
  }
  const found = await store.findCitizenByBrowserToken(hashToken(controlToken), opts.now);
  if (!found) return bad(401, 'invalid control token');
  return {
    status: 200,
    body: {
      slug: found.citizen.slug,
      district: found.citizen.district,
      capabilities: found.scope.split(','),
    },
  };
}

// portal-warp: the buddy WALKED into a portal (validated + relayed by the room
// over the live socket). Authenticated by the SCOPED control token — it may
// move only its OWN citizen and never writes xp/level. Mirrors the teleport
// capacity gate (409 when the destination is full) with the same "never bounce
// someone already there" exception, and is IDEMPOTENT: a buddy already in the
// destination gets success, not a capacity failure. Updates D1 `district` only.
// `citizenId` is the live socket's owner (the room passes it): the token must
// resolve to that same citizen, so a socket can't warp a buddy it doesn't own
// with someone else's token (B15).
export async function handlePortalWarp(
  payload: { controlToken?: unknown; to?: unknown; citizenId?: string },
  store: WorldStore,
  opts: HandlerOpts
): Promise<HandlerResult> {
  if (typeof payload.controlToken !== 'string' || payload.controlToken.length < 8) {
    return bad(401, 'missing control token');
  }
  const found = await store.findCitizenByBrowserToken(hashToken(payload.controlToken), opts.now);
  if (!found) return bad(401, 'invalid control token');
  if (payload.citizenId !== undefined && found.citizen.id !== payload.citizenId) {
    return bad(403, 'not_your_buddy');
  }
  // Scope belt-and-braces: a control token minted for anything other than
  // portal_warp cannot drive this path (today all tokens carry both scopes).
  if (!found.scope.split(',').includes('portal_warp')) return bad(403, 'insufficient scope');

  if (typeof payload.to !== 'string') return bad(400, 'unknown_town');
  const target = districtForTown(payload.to);
  if (!target) return bad(400, 'unknown_town');

  const citizen = found.citizen;
  const from = citizen.district;

  const redirect = (district: string) => ({
    status: 200,
    body: {
      district,
      url: `${opts.baseUrl}/?district=${district}`,
      spawn: spawnInto(from, district),
    },
  });

  // Idempotent: already in the destination → success (no capacity check, so a
  // duplicate portal_enter or a re-warp into your own town never 409s).
  if (from === target) return redirect(target);

  // Enforce the hub-and-spoke topology SERVER-SIDE: `to` must be reachable from
  // the citizen's CURRENT town by a real portal edge. `from` is server-derived
  // (the stored district), so a forged frame can't claim a satellite→satellite
  // hop the map never offers — the client-rendered graph is not the authority.
  if (!portalBetween(from, target)) return bad(400, 'no_portal');

  // Capacity gate. `from !== target` here, so this citizen is genuinely moving
  // in and legitimately counts against the cap — mirroring handleTeleport.
  const counts = await store.districtCounts();
  if ((counts[target] ?? 0) >= DISTRICT_CAPACITY) return bad(409, 'town_full');

  // District-ONLY write: the scoped token must never touch xp/level.
  await store.setDistrict(citizen.id, target);
  return redirect(target);
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
    // Anon = minimal identity: no real name, no country flag, nothing that
    // fingerprints the buddy back to its public self (anonView).
    const view = anonView(c, _opts);
    anonSlugByReal.set(c.slug, view.slug);
    return view;
  });

  const events = view.events.map((e) =>
    anonSlugByReal.has(e.citizen_slug) ? { ...e, citizen_slug: anonSlugByReal.get(e.citizen_slug)! } : e
  );

  return { status: 200, body: { district, citizens, events } };
}

// How many celebrations the global feed returns. Enough to fill a fresh
// viewer's banner backlog without shipping a wall of history.
export const ANNOUNCE_LIMIT = 30;

// announcements: the GLOBAL celebration feed powering the RO-yellow broadcast
// banner (M6). Cross-town (never scoped to one district) — a level-up in Payon
// is announced in Prontera too. Anon buddies are masked EXACTLY like handleWorld
// (never the real name/slug), and the stored `plaza-N` district is surfaced as
// its RO town name for the broadcast phrasing.
export async function handleAnnouncements(
  store: WorldStore,
  _opts: HandlerOpts,
  limit: number = ANNOUNCE_LIMIT
): Promise<HandlerResult> {
  const rows = await store.announcements(limit);
  const announcements = rows.map((r) => {
    const town = townForDistrict(r.district) ?? r.district;
    // `id` is the stable per-event key the client de-dupes on (so two
    // same-ms celebrations don't collapse). It's an opaque sequence number —
    // no citizen identity — so it's safe to surface even for anon buddies.
    const base = { id: r.id, type: r.type, ts: r.ts, level: r.level, town };
    if (!r.anon) return { ...base, name: r.name, slug: r.slug };
    // Anon = minimal identity: broadcast as "a wild <species>", masked slug —
    // the same masking handleWorld applies to the per-town event stream.
    return { ...base, name: `a wild ${r.species}`, slug: publicSlug(r, _opts.anonSecret) };
  });
  return { status: 200, body: { announcements } };
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
