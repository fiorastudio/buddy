// src/lib/pending-events.ts
// Handoff file between the dependency-free PostToolUse hook (writer) and
// the MCP server (consumer). Hooks must not load native modules — the
// Windows ABI saga taught us that — so ground-truth events queue in JSONL
// at ~/.buddy/pending-events.jsonl until the next buddy_observe ingests them.

import { appendFileSync, existsSync, readFileSync, unlinkSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BUDDY_DB_PATH } from './constants.js';

export interface PendingEvent {
  type: string;
  ts: number;
}

// Derive from the DB path so the ~/.buddy location has exactly one owner
// (constants.ts) — a future env override there carries over automatically.
export const DEFAULT_PENDING_EVENTS_PATH = join(dirname(BUDDY_DB_PATH), 'pending-events.jsonl');

export function appendPendingEvent(file: string, event: PendingEvent): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(event) + '\n');
  } catch {
    // Losing an XP event is always better than breaking a hook.
  }
}

// Events older than this are dropped: stale queue contents (crash, replay,
// tampering) must not become an XP windfall on the next observe.
const MAX_EVENT_AGE_MS = 15 * 60 * 1000;
const MAX_EVENTS_PER_CONSUME = 10;

export interface PendingClaim {
  events: PendingEvent[];
  /** The award committed: drop the claimed batch for good. */
  ack(): void;
  /** The award failed: hand the claimed batch back to the live queue. */
  release(): void;
}

const EMPTY_CLAIM: PendingClaim = { events: [], ack() {}, release() {} };

/**
 * Claim the queue without deleting it. The claimed batch stays on disk until
 * the caller acks it (award committed) or releases it (award threw — the
 * lines are re-appended to the live queue so the next observe retries them).
 * Before X6 the batch was unlinked before the award ran, so an award that
 * failed (e.g. SQLITE_BUSY past busy_timeout) silently lost the events.
 */
export function claimPendingEvents(
  file: string = DEFAULT_PENDING_EVENTS_PATH,
  nowMs: number = Date.now()
): PendingClaim {
  const claimed = `${file}.${process.pid}.consuming`;
  let raw: string;
  try {
    if (!existsSync(file)) return EMPTY_CLAIM;
    // Atomic claim: rename before reading so a hook appending concurrently
    // writes to a fresh queue file instead of the batch we're working on.
    renameSync(file, claimed);
    raw = readFileSync(claimed, 'utf8');
  } catch {
    return EMPTY_CLAIM;
  }

  const events: PendingEvent[] = [];
  const seen = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.type !== 'string' || !Number.isFinite(parsed.ts)) continue;
      if (nowMs - parsed.ts > MAX_EVENT_AGE_MS) continue; // stale
      const key = `${parsed.type}:${parsed.ts}`;
      if (seen.has(key)) continue; // exact replay
      seen.add(key);
      events.push({ type: parsed.type, ts: parsed.ts });
      if (events.length >= MAX_EVENTS_PER_CONSUME) break;
    } catch {
      // skip corrupt lines
    }
  }

  let settled = false;
  return {
    events,
    ack() {
      if (settled) return;
      settled = true;
      try { unlinkSync(claimed); } catch { /* already gone */ }
    },
    release() {
      if (settled) return;
      settled = true;
      try {
        // Append, never rename back: a hook may have started a fresh queue
        // file since the claim. Stale lines are filtered again on the retry.
        if (raw.trim()) appendFileSync(file, raw.endsWith('\n') ? raw : raw + '\n');
        unlinkSync(claimed);
      } catch {
        // Leave the claimed file in place rather than lose it.
      }
    },
  };
}

/**
 * Run `fn` (the XP award) against the claimed queue. The queue is consumed
 * only if `fn` returns; if it throws, the events go back on the queue and the
 * error propagates. `fn` must have committed by the time it returns
 * (awardWithGates does — its IMMEDIATE transaction commits before returning).
 */
export function withPendingEvents<T>(
  fn: (events: PendingEvent[]) => T,
  file: string = DEFAULT_PENDING_EVENTS_PATH,
  nowMs: number = Date.now()
): T {
  const claim = claimPendingEvents(file, nowMs);
  let result: T;
  try {
    result = fn(claim.events);
  } catch (err) {
    claim.release();
    throw err;
  }
  claim.ack();
  return result;
}

/** Claim and immediately drop the queue. Awards should use withPendingEvents. */
export function consumePendingEvents(
  file: string = DEFAULT_PENDING_EVENTS_PATH,
  nowMs: number = Date.now()
): PendingEvent[] {
  const claim = claimPendingEvents(file, nowMs);
  claim.ack();
  return claim.events;
}
