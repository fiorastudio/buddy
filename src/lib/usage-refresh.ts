// src/lib/usage-refresh.ts — optional background refresh of Claude rate-limit usage
//
// Claude Code only caches its rate-limit utilization when it fetches it itself,
// which never happens in sessions answered through a gateway — the cached
// numbers then drift hours behind. When the user opts in, the statusline spawns
// this module as a detached child that refreshes the snapshot on its own.
//
// The render path NEVER waits on this: it reads whatever the cache holds and
// returns. A refresh started now shows up on a later render, seconds later.

import { spawn, execFileSync } from "child_process";
import { writeFileSync, renameSync, rmSync } from "fs";
import { userInfo } from "os";
import { fileURLToPath } from "url";
import {
  BUDDY_USAGE_CACHE_PATH,
  BUDDY_USAGE_LOCK_PATH,
  CLAUDE_CREDENTIALS_FILE,
} from "./constants.js";
import { decideRefresh, readJsonFile, readTimestamp } from "./usage-sources.js";

/**
 * Refreshing is on by default — stale rate-limit numbers are worse than no
 * numbers, and Claude Code's own cache goes hours stale in gateway sessions.
 * Set the flag to "0" to keep the statusline off the network entirely.
 */
export const FETCH_ENV_FLAG = "BUDDY_STATUSLINE_USAGE_FETCH";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const FETCH_TIMEOUT_MS = 8_000;
/** Refuse a token that is about to expire rather than spend a request on a 401. */
const TOKEN_SKEW_MS = 30_000;

const apiBase = () => process.env.BUDDY_USAGE_API_BASE || "https://api.anthropic.com";

export const fetchEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env[FETCH_ENV_FLAG] !== "0";

/**
 * Claude Code's OAuth credential: the macOS keychain on darwin, a file
 * elsewhere. Returns undefined whenever it is missing, unreadable, or expired —
 * the panel then keeps showing the cached numbers.
 */
export function readOAuthToken(now: number): string | undefined {
  let raw: string | undefined;

  if (process.platform === "darwin") {
    try {
      raw = execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", userInfo().username, "-w"],
        { encoding: "utf-8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch { /* not stored in the keychain */ }
  }

  const parsed = raw ? safeParse(raw) : readJsonFile(CLAUDE_CREDENTIALS_FILE);
  return pickToken(parsed, now);
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Pure token selection, so expiry handling is testable without a keychain. */
export function pickToken(credentials: unknown, now: number): string | undefined {
  if (typeof credentials !== "object" || credentials === null) return undefined;
  const oauth = (credentials as Record<string, unknown>).claudeAiOauth;
  if (typeof oauth !== "object" || oauth === null) return undefined;

  const record = oauth as Record<string, unknown>;
  const token = record.accessToken;
  if (typeof token !== "string" || !token) return undefined;

  const expiresAt = record.expiresAt;
  if (typeof expiresAt === "number" && expiresAt - TOKEN_SKEW_MS <= now) return undefined;

  return token;
}

async function fetchUtilization(token: string): Promise<unknown> {
  const response = await fetch(`${apiBase()}/api/oauth/usage`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`usage fetch failed: ${response.status}`);
  return response.json();
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

/** The detached child's whole job: fetch once, cache it, release the lock. */
export async function runRefresh(now: number = Date.now()): Promise<void> {
  try {
    const token = readOAuthToken(now);
    if (!token) return;
    const utilization = await fetchUtilization(token);
    writeJsonAtomic(BUDDY_USAGE_CACHE_PATH, { fetchedAtMs: Date.now(), source: "api", utilization });
  } catch {
    // Network down, token rejected, disk read-only — the panel falls back to
    // the previous snapshot, so a failed refresh is never worth reporting.
  } finally {
    try { rmSync(BUDDY_USAGE_LOCK_PATH, { force: true }); } catch { /* already gone */ }
  }
}

/**
 * Start a refresh if the policy allows one. Returns the decision so the caller
 * (and tests) can see why nothing happened. Never throws, never blocks.
 */
export function maybeSpawnRefresh(opts: { now: number }): string {
  try {
    const decision = decideRefresh({
      enabled: fetchEnabled(),
      cacheFetchedAtMs: readTimestamp(readJsonFile(BUDDY_USAGE_CACHE_PATH), "fetchedAtMs"),
      lockStartedAtMs: readTimestamp(readJsonFile(BUDDY_USAGE_LOCK_PATH), "startedAtMs"),
      now: opts.now,
    });
    if (decision !== "refresh") return decision;

    // Claim the lock before spawning so parallel statusline renders — one per
    // Claude Code window — cannot pile up requests on the same endpoint.
    writeJsonAtomic(BUDDY_USAGE_LOCK_PATH, { startedAtMs: opts.now, pid: process.pid });

    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--refresh"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return decision;
  } catch {
    return "error";
  }
}

// Child-process entry point. Guarded so importing the module (tests, the
// statusline itself) never kicks off a fetch.
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--refresh")) {
  void runRefresh();
}
