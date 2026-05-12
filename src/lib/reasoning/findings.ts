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

export type SelectionResult = {
  finding: Finding | null;
  suppression: 'no_candidates' | 'cooldown' | null;
};

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
    if (currentSeq - r.observe_seq < window) return true;
  }
  return false;
}

export function selectFindingDetailed(
  db: Database.Database,
  companionId: string,
  currentSeq: number,
  candidates: Finding[],
): SelectionResult {
  if (candidates.length === 0) return { finding: null, suppression: 'no_candidates' };

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

  const eligible = candidates.filter(c => !isOnCooldown(c, recent, currentSeq));
  if (eligible.length === 0) return { finding: null, suppression: 'cooldown' };

  const cautionCands = eligible.filter(c => isCaution(c.type));
  const kudosCands = eligible.filter(c => !isCaution(c.type));

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
    return { finding: kudosCands[0], suppression: null };
  }

  if (cautionCands.length > 0 && kudosCands.length > 0) {
    const pickKudos = ((currentSeq * 37 + recentCaution) % 100) < (REASONING_CONFIG.KUDOS_TIE_BREAK_WEIGHT * 100);
    return { finding: pickKudos ? kudosCands[0] : cautionCands[0], suppression: null };
  }

  return { finding: (cautionCands[0] ?? kudosCands[0]) ?? null, suppression: null };
}

export function selectFinding(
  db: Database.Database,
  companionId: string,
  currentSeq: number,
  candidates: Finding[],
): Finding | null {
  return selectFindingDetailed(db, companionId, currentSeq, candidates).finding;
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
