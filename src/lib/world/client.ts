// src/lib/world/client.ts
// Owner-side sync for Buddy World: opt-in config (~/.buddy/world.json),
// Companion → snapshot mapping, and a debounced fire-and-forget syncer.
// Design constraint: nothing here may ever throw into the MCP server's
// request path or block it on the network.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { Companion } from '../types.js';
import type { WorldSnapshot } from './validate.js';
import { INSTANT_WORLD_EVENTS, MAX_EVENT_BATCH } from './schema-sql.js';

// Ceiling on events held while the world is unreachable. Events are cosmetic
// (plaza feed, rollups), so past this the oldest are dropped instead of a long
// offline stretch growing the MCP server's memory without bound.
export const MAX_QUEUED_EVENTS = 500;

export interface WorldConfig {
  token: string;
  apiUrl: string;
  slug?: string;
  url?: string;
  district?: string;
  avatar?: string;
}

export const DEFAULT_WORLD_CONFIG_PATH = join(homedir(), '.buddy', 'world.json');
export const DEFAULT_API_URL = 'https://buddyworldonline.com';

export function generateToken(): string {
  return randomBytes(16).toString('hex'); // 32 hex chars
}

export function loadWorldConfig(file: string = DEFAULT_WORLD_CONFIG_PATH): WorldConfig | null {
  try {
    if (!existsSync(file)) return null;
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as WorldConfig;
    return typeof cfg.token === 'string' && typeof cfg.apiUrl === 'string' ? cfg : null;
  } catch {
    return null;
  }
}

export function saveWorldConfig(cfg: WorldConfig, file: string = DEFAULT_WORLD_CONFIG_PATH): void {
  mkdirSync(dirname(file), { recursive: true });
  // Bearer token: owner-only on POSIX; mode is ignored on Windows.
  writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    chmodSync(file, 0o600); // mode option only applies to NEW files; repair pre-existing ones
  } catch {
    // best effort (Windows)
  }
  invalidateWorldConfigCache();
}

export function deleteWorldConfig(file: string = DEFAULT_WORLD_CONFIG_PATH): void {
  try {
    unlinkSync(file);
  } catch {
    // already gone
  }
  invalidateWorldConfigCache();
}

/** Drop the 30s config cache so opt-in/opt-out takes effect immediately. */
export function invalidateWorldConfigCache(): void {
  cfgCache = null;
}

export function buildWorldSnapshot(c: Companion, avatar?: string): WorldSnapshot {
  return {
    name: c.name,
    species: c.species,
    level: c.level,
    xp: c.xp,
    mood: c.mood,
    stats: {
      debugging: c.stats.DEBUGGING,
      patience: c.stats.PATIENCE,
      chaos: c.stats.CHAOS,
      wisdom: c.stats.WISDOM,
      snark: c.stats.SNARK,
    },
    rarity: c.rarity,
    shiny: c.shiny,
    hat: c.hat,
    eye: c.eye,
    avatar,
  };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface WorldSyncOpts {
  fetchFn?: FetchLike;
  now?: () => number;
  debounceMs?: number;
  timeoutMs?: number;
}

export class WorldSync {
  private queued: Array<{ type: string; ts: number }> = [];
  private lastFlush = 0;
  private stopped = false;
  private fetchFn: FetchLike;
  private now: () => number;
  private debounceMs: number;
  private timeoutMs: number;

  constructor(private cfg: WorldConfig, opts: WorldSyncOpts = {}) {
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => Date.now());
    this.debounceMs = opts.debounceMs ?? 60_000;
    this.timeoutMs = opts.timeoutMs ?? 4_000;
  }

  private async post(path: string, body: unknown): Promise<Response | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await this.fetchFn(`${this.cfg.apiUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null; // network failures are always non-fatal
    }
  }

  async teleport(
    snapshot: WorldSnapshot,
    opts: { district?: string } = {}
  ): Promise<{ slug: string; url: string; district: string }> {
    const res = await this.post('/v1/teleport', {
      token: this.cfg.token,
      snapshot,
      ...(opts.district ? { district: opts.district } : {}),
    });
    if (!res || res.status !== 200) {
      const detail = res ? ((await res.json()) as { error?: string }).error : 'network unreachable';
      throw new Error(`teleport failed: ${detail}`);
    }
    this.lastFlush = this.now();
    return (await res.json()) as { slug: string; url: string; district: string };
  }

  /**
   * The server answered that this buddy is recalled (hidden). Nothing it
   * queues can ever be delivered, so the sync has stopped: queued events were
   * dropped and later ones are ignored. Teleporting back un-hides the buddy;
   * the MCP glue then starts a fresh WorldSync.
   */
  get recalled(): boolean {
    return this.stopped;
  }

  queue(type: string): void {
    if (this.stopped) return;
    this.queued.push({ type, ts: this.now() });
    this.capQueue();
  }

  /** Events waiting to be delivered. */
  get pending(): number {
    return this.queued.length;
  }

  private capQueue(): void {
    const excess = this.queued.length - MAX_QUEUED_EVENTS;
    if (excess > 0) this.queued.splice(0, excess); // drop the oldest
  }

  // Worth retrying later: no response (network/timeout), 5xx, 408, 429.
  // Any other non-200 is the server rejecting the request itself, and
  // resending the same request would fail the same way forever.
  private static isTransient(res: Response | null): boolean {
    return !res || res.status >= 500 || res.status === 408 || res.status === 429;
  }

  // 409 {"error":"recalled"}: the server refuses writes for a hidden buddy.
  private static async isRecalled(res: Response): Promise<boolean> {
    if (res.status !== 409) return false;
    try {
      return ((await res.json()) as { error?: unknown }).error === 'recalled';
    } catch {
      return false;
    }
  }

  /** Debounce-aware flush; awaitable but designed to be fire-and-forget. */
  async maybeFlush(snapshot?: WorldSnapshot): Promise<void> {
    if (this.now() - this.lastFlush < this.debounceMs) return;
    await this.flush(snapshot);
  }

  /**
   * Sends at most one server-sized batch (the rest stays queued for the next
   * window). Returns true when that batch's events were delivered. Never throws.
   */
  async flush(snapshot?: WorldSnapshot): Promise<boolean> {
    if (this.stopped) return false;
    const events = this.queued.splice(0, MAX_EVENT_BATCH);
    let res = await this.post('/v1/events', {
      token: this.cfg.token,
      events,
      ...(snapshot ? { snapshot } : {}),
    });
    // A 400 with a snapshot attached is most likely the snapshot (e.g. a name
    // the server's validator rejects). The server writes nothing on a 400, so
    // resend the events alone once rather than lose them with it.
    if (res?.status === 400 && snapshot && events.length > 0) {
      res = await this.post('/v1/events', { token: this.cfg.token, events });
    }
    if (res?.status === 200) {
      this.lastFlush = this.now();
      return true;
    }
    if (WorldSync.isTransient(res)) {
      this.queued = events.concat(this.queued); // requeue for the next window
      this.capQueue();
    } else if (res && (await WorldSync.isRecalled(res))) {
      // Recalled server-side (maybe by another process): drop everything and
      // stop — no amount of retrying delivers events for a hidden buddy.
      this.queued = [];
      this.stopped = true;
    } else {
      // Rejected outright (4xx): it can never succeed, so drop the batch rather
      // than wedge the queue behind it. Start a new debounce window too, so a
      // permanently refused token isn't retried on every single tool call.
      this.lastFlush = this.now();
    }
    return false;
  }

  async recall(purge: boolean): Promise<boolean> {
    const res = await this.post('/v1/recall', { token: this.cfg.token, purge });
    return res?.status === 200;
  }

  async setAnon(anon: boolean): Promise<boolean> {
    const res = await this.post('/v1/anon', { token: this.cfg.token, anon });
    return res?.status === 200;
  }

  /**
   * Mint a personal, one-time browser-link URL. Auth'd by the real world token
   * server-side; the returned URL carries a short-lived code in its fragment
   * that the browser exchanges for a scoped control token. Never throws.
   */
  async mintBrowserLink(): Promise<{ code: string; url: string; district: string } | null> {
    const res = await this.post('/v1/browser-link', { token: this.cfg.token });
    if (!res || res.status !== 200) return null;
    return (await res.json()) as { code: string; url: string; district: string };
  }
}

// ── MCP server glue ──────────────────────────────────────────────────────
// One WorldSync per process, created lazily when world.json appears.
// Every failure mode is swallowed: world sync must never break buddy.

let processSync: WorldSync | null = null;
let processSyncToken: string | null = null;
let cfgCache: { cfg: WorldConfig | null; at: number; path: string | undefined } | null = null;
const CFG_CACHE_MS = 30_000;

// Config reads happen on the MCP request path: hydrate at most once per 30s.
function cachedConfig(path: string | undefined, nowMs: number): WorldConfig | null {
  if (!cfgCache || cfgCache.path !== path || nowMs - cfgCache.at > CFG_CACHE_MS) {
    cfgCache = { cfg: loadWorldConfig(path), at: nowMs, path };
  }
  return cfgCache.cfg;
}

export interface AutoSyncDeps extends WorldSyncOpts {
  configPath?: string;
  /** Force an immediate flush (e.g. the awarding call just caused a level-up). */
  instant?: boolean;
}

/** Teleported buddies earn the +10% XP blessing. Cached like autoSync. */
export function isWorldBlessed(configPath?: string): boolean {
  return cachedConfig(configPath, Date.now()) !== null;
}

export async function autoSyncWorld(
  companion: Companion,
  eventType: string,
  deps: AutoSyncDeps = {}
): Promise<void> {
  try {
    const now = (deps.now ?? Date.now)();
    const cfg = cachedConfig(deps.configPath, now);
    if (!cfg) return;
    if (!processSync || processSyncToken !== cfg.token) {
      processSync = new WorldSync(cfg, deps);
      processSyncToken = cfg.token;
    }
    const sync = processSync;
    sync.queue(eventType);
    const snapshot = buildWorldSnapshot(companion, cfg.avatar);
    if (deps.instant || INSTANT_WORLD_EVENTS.has(eventType as never)) {
      await sync.flush(snapshot);
    } else {
      await sync.maybeFlush(snapshot);
    }
    if (sync.recalled && processSync === sync) {
      // The server says this buddy was recalled even though the cached
      // world.json still says otherwise. Treat it as out of the world (no
      // sync, no blessing) until the cache next reloads world.json; a buddy
      // that has since teleported back then gets a fresh WorldSync.
      processSync = null;
      processSyncToken = null;
      cfgCache = { cfg: null, at: now, path: deps.configPath };
    }
  } catch {
    // never let plaza problems reach the buddy
  }
}
