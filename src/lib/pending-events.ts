// src/lib/pending-events.ts
// Handoff file between the dependency-free PostToolUse hook (writer) and
// the MCP server (consumer). Hooks must not load native modules — the
// Windows ABI saga taught us that — so ground-truth events queue in JSONL
// at ~/.buddy/pending-events.jsonl until the next buddy_observe ingests them.

import { appendFileSync, existsSync, readFileSync, unlinkSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { BUDDY_PENDING_EVENTS_PATH } from './constants.js';

export interface PendingEvent {
  type: string;
  ts: number;
}

// Owned by constants.ts: next to the DB, so a BUDDY_DB_PATH override carries
// over, unless BUDDY_PENDING_EVENTS_PATH overrides it directly.
export const DEFAULT_PENDING_EVENTS_PATH = BUDDY_PENDING_EVENTS_PATH;

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

export function consumePendingEvents(
  file: string = DEFAULT_PENDING_EVENTS_PATH,
  nowMs: number = Date.now()
): PendingEvent[] {
  try {
    if (!existsSync(file)) return [];
    // Atomic claim: rename before reading so a hook appending concurrently
    // writes to a fresh queue file instead of one we're about to delete.
    const claimed = `${file}.${process.pid}.consuming`;
    renameSync(file, claimed);
    const lines = readFileSync(claimed, 'utf8').split('\n');
    unlinkSync(claimed);

    const events: PendingEvent[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
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
    return events;
  } catch {
    return [];
  }
}
