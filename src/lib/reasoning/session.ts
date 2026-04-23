// src/lib/reasoning/session.ts
//
// Session derivation: cwd_hash + UTC_day_bucket.
// Claims accumulate per (workspace, day). Cross-midnight loss is acceptable;
// most reasoning threads wrap inside a day.

import { createHash } from 'crypto';

const HASH_LEN = 16;

function cwdHash(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, HASH_LEN);
}

function utcDayBucket(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function deriveSessionId(cwd: string, nowMs: number = Date.now()): string {
  return `${cwdHash(cwd)}-${utcDayBucket(nowMs)}`;
}

// Parse the day-bucket back out for retention queries. Returns epoch ms at
// UTC midnight for the session's day, or null if the id doesn't parse.
export function sessionDayStartMs(sessionId: string): number | null {
  const match = /-(\d{8})$/.exec(sessionId);
  if (!match) return null;
  const s = match[1];
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  return Date.UTC(y, m, d);
}

// Shape check for session ids supplied externally (e.g. via buddy_forget).
// Accepts `<16-hex>-<YYYYMMDD>`.
export function isValidSessionId(id: string): boolean {
  return /^[0-9a-f]{16}-\d{8}$/.test(id);
}
