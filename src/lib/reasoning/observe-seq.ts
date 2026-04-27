// src/lib/reasoning/observe-seq.ts
//
// Per-companion observe counter. Persists across server restarts so the
// doctor's inert-insight-mode check keeps working after a relaunch.

import type Database from 'better-sqlite3';

export function getAndBumpObserveSeq(
  db: Database.Database,
  companionId: string,
  claimsReceived: boolean,
): { seq: number; lastClaimsSeq: number } {
  const existing = db.prepare(
    `SELECT seq, last_claims_received_seq FROM reasoning_observe_seq WHERE companion_id = ?`
  ).get(companionId) as { seq: number; last_claims_received_seq: number } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO reasoning_observe_seq (companion_id, seq, last_claims_received_seq) VALUES (?, ?, ?)`
    ).run(companionId, 1, claimsReceived ? 1 : 0);
    return { seq: 1, lastClaimsSeq: claimsReceived ? 1 : 0 };
  }

  const nextSeq = existing.seq + 1;
  const nextLastClaims = claimsReceived ? nextSeq : existing.last_claims_received_seq;
  db.prepare(
    `UPDATE reasoning_observe_seq SET seq = ?, last_claims_received_seq = ? WHERE companion_id = ?`
  ).run(nextSeq, nextLastClaims, companionId);
  return { seq: nextSeq, lastClaimsSeq: nextLastClaims };
}

