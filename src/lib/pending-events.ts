// src/lib/pending-events.ts
// Handoff file between the dependency-free PostToolUse hook (writer) and
// the MCP server (consumer). Hooks must not load native modules — the
// Windows ABI saga taught us that — so ground-truth events queue in JSONL
// at ~/.buddy/pending-events.jsonl until the next buddy_observe ingests them.

import { appendFileSync, existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface PendingEvent {
  type: string;
  ts: number;
}

export const DEFAULT_PENDING_EVENTS_PATH = join(homedir(), '.buddy', 'pending-events.jsonl');

export function appendPendingEvent(file: string, event: PendingEvent): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(event) + '\n');
  } catch {
    // Losing an XP event is always better than breaking a hook.
  }
}

export function consumePendingEvents(file: string = DEFAULT_PENDING_EVENTS_PATH): PendingEvent[] {
  try {
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n');
    unlinkSync(file);
    const events: PendingEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.type === 'string' && Number.isFinite(parsed.ts)) events.push(parsed);
      } catch {
        // skip corrupt lines
      }
    }
    return events;
  } catch {
    return [];
  }
}
