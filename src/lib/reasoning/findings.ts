// src/lib/reasoning/findings.ts
//
// Selection layer. Given candidate findings from all detectors and the
// recent findings log, pick at most one to surface. Enforces:
//   - per-anchor cooldown (different cooldowns for caution vs kudos)
//   - kudos bias when recent window is caution-heavy
//   - caution-weighted tie-break when both fire

import type Database from 'better-sqlite3';
import { type Finding, type FindingType, isCaution } from './types.js';
import { REASONING_CONFIG } from './config.js';

type RecentFinding = {
  finding_type: FindingType;
  anchor_claim_id: string;
  observe_seq: number;
};

// Boundary semantics: "within the last N observes" means currentSeq - r < N.
// That is, a cooldown of 10 blocks the same anchor for the next 9 observes
// after the fire (fire at seq=5 → blocked at seq=6..14, eligible at seq=15).
// Load and check use the same < comparison so the boundary is consistent.
function loadRecentFindings(db: Database.Database, companionId: string, currentSeq: number, window: number): RecentFinding[] {
  const rows = db.prepare(
    `SELECT finding_type, anchor_claim_id, observe_seq
     FROM reasoning_findings_log
     WHERE companion_id = ? AND observe_seq > ?
     ORDER BY observe_seq DESC`
  ).all(companionId, currentSeq - window) as RecentFinding[];
  return rows;
}

function isOnCooldown(finding: Finding, recent: RecentFinding[], currentSeq: number): boolean {
  const window = isCaution(finding.type)
    ? REASONING_CONFIG.CAUTION_COOLDOWN_OBSERVES
    : REASONING_CONFIG.KUDOS_COOLDOWN_OBSERVES;
  for (const r of recent) {
    if (r.anchor_claim_id !== finding.anchor_claim_id) continue;
    // Strict-less-than matches the load query's `observe_seq > currentSeq - window`.
    if (currentSeq - r.observe_seq < window) return true;
  }
  return false;
}

export function selectFinding(
  db: Database.Database,
  companionId: string,
  currentSeq: number,
  candidates: Finding[],
): Finding | null {
  if (candidates.length === 0) return null;

  const recent = loadRecentFindings(
    db,
    companionId,
    currentSeq,
    Math.max(
      REASONING_CONFIG.CAUTION_COOLDOWN_OBSERVES,
      REASONING_CONFIG.KUDOS_COOLDOWN_OBSERVES,
      REASONING_CONFIG.KUDOS_BIAS_WINDOW,
    ),
  );

  // Filter out candidates on cooldown.
  const eligible = candidates.filter(c => !isOnCooldown(c, recent, currentSeq));
  if (eligible.length === 0) return null;

  const cautionCands = eligible.filter(c => isCaution(c.type));
  const kudosCands = eligible.filter(c => !isCaution(c.type));

  // Kudos bias: if last KUDOS_BIAS_WINDOW observes had >= threshold caution
  // findings and zero kudos, next finding must be kudos if one is available.
  // Uses the same strict-less-than boundary as cooldown for consistency.
  const windowCount = (type: 'caution' | 'kudos'): number =>
    recent.filter(r => (type === 'caution' ? isCaution(r.finding_type) : !isCaution(r.finding_type)))
      .filter(r => currentSeq - r.observe_seq < REASONING_CONFIG.KUDOS_BIAS_WINDOW)
      .length;

  const recentCaution = windowCount('caution');
  const recentKudos = windowCount('kudos');

  if (
    kudosCands.length > 0 &&
    recentCaution >= REASONING_CONFIG.KUDOS_BIAS_CAUTION_THRESHOLD &&
    recentKudos === 0
  ) {
    return kudosCands[0];
  }

  // Tie-break: if both pools are non-empty, weight toward caution but leave
  // room for kudos. Deterministic pick based on (currentSeq + caution count)
  // so behavior is reproducible without a PRNG dependency.
  if (cautionCands.length > 0 && kudosCands.length > 0) {
    const pickKudos = ((currentSeq * 37 + recentCaution) % 100) < (REASONING_CONFIG.KUDOS_TIE_BREAK_WEIGHT * 100);
    return pickKudos ? kudosCands[0] : cautionCands[0];
  }

  return (cautionCands[0] ?? kudosCands[0]) ?? null;
}

export function logFinding(
  db: Database.Database,
  companionId: string,
  sessionId: string,
  finding: Finding,
  observeSeq: number,
): void {
  try {
    db.prepare(
      `INSERT INTO reasoning_findings_log
       (companion_id, session_id, finding_type, anchor_claim_id, observe_seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(companionId, sessionId, finding.type, finding.anchor_claim_id, observeSeq, Date.now());
  } catch { /* best-effort */ }
}
