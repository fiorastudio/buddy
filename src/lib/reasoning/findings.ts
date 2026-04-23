// src/lib/reasoning/findings.ts
//
// Selection layer. Given candidate findings from all detectors and the
// recent findings log, pick at most one to surface. Enforces:
//   - per-anchor cooldown (different cooldowns for dark vs bright)
//   - bright bias when recent window is dark-heavy
//   - dark-weighted tie-break when both fire

import type Database from 'better-sqlite3';
import { type Finding, type FindingType, isDark } from './types.js';
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
  const window = isDark(finding.type)
    ? REASONING_CONFIG.DARK_COOLDOWN_OBSERVES
    : REASONING_CONFIG.BRIGHT_COOLDOWN_OBSERVES;
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
      REASONING_CONFIG.DARK_COOLDOWN_OBSERVES,
      REASONING_CONFIG.BRIGHT_COOLDOWN_OBSERVES,
      REASONING_CONFIG.BRIGHT_BIAS_WINDOW,
    ),
  );

  // Filter out candidates on cooldown.
  const eligible = candidates.filter(c => !isOnCooldown(c, recent, currentSeq));
  if (eligible.length === 0) return null;

  const darkCands = eligible.filter(c => isDark(c.type));
  const brightCands = eligible.filter(c => !isDark(c.type));

  // Bright bias: if last BRIGHT_BIAS_WINDOW observes had >= threshold dark
  // findings and zero bright, next finding must be bright if one is available.
  // Uses the same strict-less-than boundary as cooldown for consistency.
  const windowCount = (type: 'dark' | 'bright'): number =>
    recent.filter(r => (type === 'dark' ? isDark(r.finding_type) : !isDark(r.finding_type)))
      .filter(r => currentSeq - r.observe_seq < REASONING_CONFIG.BRIGHT_BIAS_WINDOW)
      .length;

  const recentDark = windowCount('dark');
  const recentBright = windowCount('bright');

  if (
    brightCands.length > 0 &&
    recentDark >= REASONING_CONFIG.BRIGHT_BIAS_DARK_THRESHOLD &&
    recentBright === 0
  ) {
    return brightCands[0];
  }

  // Tie-break: if both pools are non-empty, weight toward dark but leave
  // room for bright. Deterministic pick based on (currentSeq + dark count)
  // so behavior is reproducible without a PRNG dependency.
  if (darkCands.length > 0 && brightCands.length > 0) {
    const pickBright = ((currentSeq * 37 + recentDark) % 100) < (REASONING_CONFIG.BRIGHT_TIE_BREAK_WEIGHT * 100);
    return pickBright ? brightCands[0] : darkCands[0];
  }

  return (darkCands[0] ?? brightCands[0]) ?? null;
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
