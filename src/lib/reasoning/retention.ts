// src/lib/reasoning/retention.ts
//
// Prune data older than SESSION_RETENTION_DAYS and provide a purge surface
// for the buddy_forget tool. Called on startup and on explicit user request.

import type Database from 'better-sqlite3';
import { REASONING_CONFIG } from './config.js';
import { sessionDayStartMs } from './session.js';

export type PurgeScope = 'session' | 'all';

export type PurgeResult = {
  claims: number;
  edges: number;
  findings: number;
};

export function pruneOldSessions(db: Database.Database, nowMs: number = Date.now()): PurgeResult {
  const cutoffMs = nowMs - REASONING_CONFIG.SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const sessionRows = db.prepare(
    `SELECT DISTINCT session_id FROM reasoning_claims`
  ).all() as Array<{ session_id: string }>;

  const toDelete: string[] = [];
  for (const r of sessionRows) {
    const start = sessionDayStartMs(r.session_id);
    if (start !== null && start < cutoffMs) toDelete.push(r.session_id);
  }
  if (toDelete.length === 0) return { claims: 0, edges: 0, findings: 0 };

  return purgeSessions(db, toDelete);
}

function purgeSessions(db: Database.Database, sessionIds: string[]): PurgeResult {
  let claims = 0, edges = 0, findings = 0;
  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) {
      const cRes = db.prepare(`DELETE FROM reasoning_claims WHERE session_id = ?`).run(id);
      const eRes = db.prepare(`DELETE FROM reasoning_edges WHERE session_id = ?`).run(id);
      const fRes = db.prepare(`DELETE FROM reasoning_findings_log WHERE session_id = ?`).run(id);
      claims += cRes.changes ?? 0;
      edges += eRes.changes ?? 0;
      findings += fRes.changes ?? 0;
    }
  });
  try { tx(sessionIds); } catch { /* best-effort */ }
  return { claims, edges, findings };
}

export function purge(db: Database.Database, scope: PurgeScope, sessionId?: string): PurgeResult {
  if (scope === 'session') {
    if (!sessionId) return { claims: 0, edges: 0, findings: 0 };
    return purgeSessions(db, [sessionId]);
  }
  // scope === 'all'
  let claims = 0, edges = 0, findings = 0;
  const tx = db.transaction(() => {
    const cRes = db.prepare(`DELETE FROM reasoning_claims`).run();
    const eRes = db.prepare(`DELETE FROM reasoning_edges`).run();
    const fRes = db.prepare(`DELETE FROM reasoning_findings_log`).run();
    claims = cRes.changes ?? 0;
    edges = eRes.changes ?? 0;
    findings = fRes.changes ?? 0;
  });
  try { tx(); } catch { /* best-effort */ }
  return { claims, edges, findings };
}
