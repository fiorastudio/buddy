// src/lib/world/client.ts
// Owner-side sync for Buddy World: opt-in config (~/.buddy/world.json),
// Companion → snapshot mapping, and a debounced fire-and-forget syncer.
// Design constraint: nothing here may ever throw into the MCP server's
// request path or block it on the network.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { Companion } from '../types.js';
import type { WorldSnapshot } from './validate.js';

export interface WorldConfig {
  token: string;
  apiUrl: string;
  slug?: string;
  url?: string;
  district?: string;
  avatar?: string;
}

export const DEFAULT_WORLD_CONFIG_PATH = join(homedir(), '.buddy', 'world.json');
export const DEFAULT_API_URL = 'https://world.buddy-mcp.com';

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
}

export function deleteWorldConfig(file: string = DEFAULT_WORLD_CONFIG_PATH): void {
  try {
    unlinkSync(file);
  } catch {
    // already gone
  }
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

  async teleport(snapshot: WorldSnapshot): Promise<{ slug: string; url: string; district: string }> {
    const res = await this.post('/v1/teleport', { token: this.cfg.token, snapshot });
    if (!res || res.status !== 200) {
      const detail = res ? ((await res.json()) as { error?: string }).error : 'network unreachable';
      throw new Error(`teleport failed: ${detail}`);
    }
    this.lastFlush = this.now();
    return (await res.json()) as { slug: string; url: string; district: string };
  }

  queue(type: string): void {
    this.queued.push({ type, ts: this.now() });
  }

  /** Debounce-aware flush; awaitable but designed to be fire-and-forget. */
  async maybeFlush(snapshot?: WorldSnapshot): Promise<void> {
    if (this.now() - this.lastFlush < this.debounceMs) return;
    await this.flush(snapshot);
  }

  /** Returns true when the batch was delivered. Never throws. */
  async flush(snapshot?: WorldSnapshot): Promise<boolean> {
    const events = this.queued;
    this.queued = [];
    const res = await this.post('/v1/events', {
      token: this.cfg.token,
      events,
      ...(snapshot ? { snapshot } : {}),
    });
    if (!res || res.status !== 200) {
      this.queued = events.concat(this.queued); // requeue for the next window
      return false;
    }
    this.lastFlush = this.now();
    return true;
  }

  async recall(purge: boolean): Promise<boolean> {
    const res = await this.post('/v1/recall', { token: this.cfg.token, purge });
    return res?.status === 200;
  }

  async setAnon(anon: boolean): Promise<boolean> {
    const res = await this.post('/v1/anon', { token: this.cfg.token, anon });
    return res?.status === 200;
  }
}

// ── MCP server glue ──────────────────────────────────────────────────────
// One WorldSync per process, created lazily when world.json appears.
// Every failure mode is swallowed: world sync must never break buddy.

let processSync: WorldSync | null = null;
let processSyncToken: string | null = null;
let cfgCache: { cfg: WorldConfig | null; at: number; path: string | undefined } | null = null;
const CFG_CACHE_MS = 30_000;

export interface AutoSyncDeps extends WorldSyncOpts {
  configPath?: string;
}

/** Teleported buddies earn the +10% XP blessing. Cached like autoSync. */
export function isWorldBlessed(configPath?: string): boolean {
  const now = Date.now();
  if (!cfgCache || cfgCache.path !== configPath || now - cfgCache.at > CFG_CACHE_MS) {
    cfgCache = { cfg: loadWorldConfig(configPath), at: now, path: configPath };
  }
  return cfgCache.cfg !== null;
}

// Celebration-worthy events skip the debounce so fireworks land within one
// plaza poll (~10s) of the real moment instead of a minute later.
const INSTANT_TYPES = new Set(['deploy', 'level_up', 'streak_7']);

export async function autoSyncWorld(
  companion: Companion,
  eventType: string,
  deps: AutoSyncDeps = {}
): Promise<void> {
  try {
    // Cache the config read: this runs on the MCP request path, so keep
    // filesystem touches to once per 30s, not once per XP event.
    const now = (deps.now ?? Date.now)();
    if (!cfgCache || cfgCache.path !== deps.configPath || now - cfgCache.at > CFG_CACHE_MS) {
      cfgCache = { cfg: loadWorldConfig(deps.configPath), at: now, path: deps.configPath };
    }
    const cfg = cfgCache.cfg;
    if (!cfg) return;
    if (!processSync || processSyncToken !== cfg.token) {
      processSync = new WorldSync(cfg, deps);
      processSyncToken = cfg.token;
    }
    processSync.queue(eventType);
    const snapshot = buildWorldSnapshot(companion, cfg.avatar);
    if (INSTANT_TYPES.has(eventType)) {
      await processSync.flush(snapshot);
    } else {
      await processSync.maybeFlush(snapshot);
    }
  } catch {
    // never let plaza problems reach the buddy
  }
}
