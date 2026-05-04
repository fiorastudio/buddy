// src/lib/reasoning/delivery.ts
//
// Out-of-band finding delivery. Hook-driven extraction logs findings into
// `reasoning_findings_log` from the Stop hook; this module is what the
// UserPromptSubmit hook calls to drain those findings into the next prompt's
// context as a system-reminder injection.
//
// State: `reasoning_observe_seq.last_delivered_finding_id` is a per-companion
// high-water mark. Anything with a higher row id is unseen; we render, emit,
// and bump the mark.
//
// The renderer reuses buddy's existing `phraseFinding` so injected text
// keeps the in-character voice. Plain stdout output — UserPromptSubmit hook
// stdout becomes a system-reminder block in the next assistant turn.

import type Database from 'better-sqlite3';
import { phraseFinding } from './phrasings.js';
import type { FindingType } from './types.js';
import * as telemetry from './telemetry.js';
import * as state from './extraction-state.js';

type PendingFinding = {
  id: number;
  finding_type: FindingType;
  anchor_claim_id: string;
  // Joined from reasoning_claims so we can pass claim text to phraseFinding.
  claim_text: string | null;
};

export type DeliveryResult = {
  delivered: number;
  highestId: number;
};

/**
 * Read pending findings (id > last_delivered_finding_id) for the given
 * companion, render them, and write the rendered block to stdout. Bumps the
 * high-water mark only if at least one finding was rendered.
 *
 * Returns counts so the hook can log non-fatally.
 */
export function deliverPendingFindings(
  db: Database.Database,
  companionId: string,
): DeliveryResult {
  const seqRow = db.prepare(
    `SELECT last_delivered_finding_id FROM reasoning_observe_seq WHERE companion_id = ?`,
  ).get(companionId) as { last_delivered_finding_id: number } | undefined;

  const lastId = seqRow?.last_delivered_finding_id ?? 0;

  const pending = db.prepare(
    `SELECT f.id, f.finding_type, f.anchor_claim_id, c.text AS claim_text
       FROM reasoning_findings_log f
  LEFT JOIN reasoning_claims c ON c.id = f.anchor_claim_id
      WHERE f.companion_id = ?
        AND f.id > ?
   ORDER BY f.id ASC`,
  ).all(companionId, lastId) as PendingFinding[];

  if (pending.length === 0) return { delivered: 0, highestId: lastId };

  const block = renderInjectionBlock(pending);
  if (block) {
    process.stdout.write(block);
  }

  const highestId = pending[pending.length - 1].id;
  upsertHighWaterMark(db, companionId, highestId);
  telemetry.recordFindingsDelivered(pending.length);
  state.recordFindingsDelivered(db, companionId, pending.length);

  return { delivered: pending.length, highestId };
}

function renderInjectionBlock(findings: PendingFinding[]): string {
  const lines: string[] = [];
  for (const f of findings) {
    const claimText = f.claim_text ?? '';
    if (!claimText) continue; // anchor claim was pruned — skip silently
    const phrased = phraseFinding(f.finding_type, 'neutral', claimText, f.id);
    lines.push(`- ${phrased}`);
  }
  if (lines.length === 0) return '';

  // The header makes the injection legible to the model as a buddy-sourced
  // observation rather than an arbitrary system note. Keep it terse — long
  // headers eat prompt budget for no gain.
  return `[buddy observation]\n${lines.join('\n')}\n`;
}

function upsertHighWaterMark(
  db: Database.Database,
  companionId: string,
  highestId: number,
): void {
  db.prepare(
    `INSERT INTO reasoning_observe_seq (companion_id, seq, last_claims_received_seq, last_delivered_finding_id)
     VALUES (?, 0, 0, ?)
     ON CONFLICT(companion_id) DO UPDATE SET last_delivered_finding_id = excluded.last_delivered_finding_id`,
  ).run(companionId, highestId);
}

