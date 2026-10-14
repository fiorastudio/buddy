// src/lib/usage-sources.ts — where the usage panel's numbers come from
//
// Reading files is the only side effect here; every read is best-effort and
// returns undefined instead of throwing, because the statusline must render
// even when Claude Code's config is missing, partial, or mid-write.

import { readFileSync } from "fs";
import { CLAUDE_CONFIG_FILE, BUDDY_USAGE_CACHE_PATH } from "./constants.js";
import type { UsageSources } from "./usage.js";

/** How long a fetched utilization snapshot is considered current. */
export const USAGE_CACHE_TTL_MS = 60_000;
/** How long a refresh is assumed to still be running before another may start. */
export const REFRESH_LOCK_TTL_MS = 15_000;

export function readJsonFile(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
}

function parseStdin(stdinData: string): unknown | undefined {
  if (!stdinData) return undefined;
  try {
    return JSON.parse(stdinData);
  } catch {
    return undefined;
  }
}

/** Gather every input the panel can draw from. Missing sources are simply absent. */
export function collectUsageSources(stdinData: string): UsageSources {
  return {
    stdin: parseStdin(stdinData),
    config: readJsonFile(CLAUDE_CONFIG_FILE),
    cache: readJsonFile(BUDDY_USAGE_CACHE_PATH),
  };
}

export type RefreshDecision = "disabled" | "fresh" | "in-flight" | "refresh";

/**
 * Decide whether a background refresh is worth starting. Pure so the policy can
 * be tested without touching the network, the clock, or the filesystem.
 *
 * Live numbers on stdin are not a reason to skip the fetch: that payload covers
 * the two plan-wide windows only, so the model-scoped cap would go stale in
 * exactly the sessions Claude Code reports limits for. The TTL and the lock are
 * what keep the request rate down.
 *
 * `cacheFetchedAtMs` / `lockStartedAtMs` are undefined when the file is absent.
 */
export function decideRefresh(opts: {
  enabled: boolean;
  cacheFetchedAtMs?: number;
  lockStartedAtMs?: number;
  now: number;
}): RefreshDecision {
  if (!opts.enabled) return "disabled";

  if (opts.lockStartedAtMs !== undefined && opts.now - opts.lockStartedAtMs < REFRESH_LOCK_TTL_MS) {
    return "in-flight";
  }
  if (opts.cacheFetchedAtMs !== undefined && opts.now - opts.cacheFetchedAtMs < USAGE_CACHE_TTL_MS) {
    return "fresh";
  }
  return "refresh";
}

/** Timestamp helper shared by the cache and lock files; undefined when unreadable. */
export function readTimestamp(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const ts = (value as Record<string, unknown>)[key];
  return typeof ts === "number" ? ts : undefined;
}
