// src/lib/reasoning/writer.ts
//
// Accepts ClaimInput[] / EdgeInput[] from the host, sanitizes, resolves
// external_ids to UUIDs (including cross-payload references to prior UUIDs),
// and writes to SQLite. Strictly additive: any failure drops the write and
// returns — observe must never fail because of this path.
//
// Transaction scope: claims AND edges write in ONE transaction. If the
// edge batch fails, the claim batch rolls back too, so we never leave the
// graph half-ingested with orphan nodes from a payload the host intended
// to be coherent.

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  type ClaimInput, type EdgeInput, type StoredClaim,
  BASIS_VALUES, EDGE_TYPES, SPEAKERS, CONFIDENCES,
} from './types.js';
import { sanitizeClaim } from './sanitize.js';
import { REASONING_CONFIG } from './config.js';
import { bumpGeneration } from './graph-cache.js';

export type WriteResult = {
  claimsWritten: number;
  edgesWritten: number;
  claimsDropped: number;
  edgesDropped: number;
};

function isValidBasis(v: unknown): v is (typeof BASIS_VALUES)[number] {
  return typeof v === 'string' && (BASIS_VALUES as readonly string[]).includes(v);
}
function isValidEdgeType(v: unknown): v is (typeof EDGE_TYPES)[number] {
  return typeof v === 'string' && (EDGE_TYPES as readonly string[]).includes(v);
}
function isValidSpeaker(v: unknown): v is (typeof SPEAKERS)[number] {
  return typeof v === 'string' && (SPEAKERS as readonly string[]).includes(v);
}
function isValidConfidence(v: unknown): v is (typeof CONFIDENCES)[number] {
  return typeof v === 'string' && (CONFIDENCES as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const UUID_PREFIX_RE = /^[0-9a-f]{8}$/i;

export function writeClaims(
  db: Database.Database,
  sessionId: string,
  claims: unknown,
  edges: unknown,
): WriteResult {
  const result: WriteResult = { claimsWritten: 0, edgesWritten: 0, claimsDropped: 0, edgesDropped: 0 };

  const claimsArr = Array.isArray(claims) ? (claims as ClaimInput[]) : [];
  const edgesArr = Array.isArray(edges) ? (edges as EdgeInput[]) : [];
  if (claimsArr.length === 0 && edgesArr.length === 0) return result;

  const now = Date.now();
  const externalIdToUuid = new Map<string, string>();

  // Pre-look up which prior-UUID prefixes exist in this session, so edges
  // referencing them by short prefix can resolve.
  const priorPrefixMap = new Map<string, string>();
  if (edgesArr.length > 0) {
    const rows = db.prepare(
      `SELECT id FROM reasoning_claims WHERE session_id = ?`
    ).all(sessionId) as Array<{ id: string }>;
    for (const r of rows) priorPrefixMap.set(r.id.slice(0, 8).toLowerCase(), r.id);
  }

  const insertClaim = db.prepare(
    `INSERT INTO reasoning_claims (id, session_id, speaker, text, basis, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertEdge = db.prepare(
    `INSERT INTO reasoning_edges (id, session_id, from_claim, to_claim, type, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // Resolve an edge endpoint: external_id → new UUID; UUID prefix → full
  // prior UUID; full UUID → verify it exists in-session, else drop.
  const resolveEndpoint = (ref: string): string | null => {
    if (externalIdToUuid.has(ref)) return externalIdToUuid.get(ref)!;
    const low = ref.toLowerCase();
    if (UUID_PREFIX_RE.test(low) && priorPrefixMap.has(low)) return priorPrefixMap.get(low)!;
    if (UUID_RE.test(low)) {
      const row = db.prepare(`SELECT 1 FROM reasoning_claims WHERE session_id = ? AND id = ? LIMIT 1`)
        .get(sessionId, low) as any;
      if (row) return low;
    }
    return null;
  };

  // BUDDY_DEBUG=1 surfaces the per-field drop reason for any claim that
  // doesn't make it into the graph. Without this, a host calling
  // buddy_observe with the wrong shape (e.g. v7-style `index` instead of
  // `external_id`, or a missing basis enum value) sees claimsDropped=N
  // and has no way to tell which field failed validation.
  //
  // Defense-in-depth: the dropped payload is user-supplied content
  // (could be claim text quoted from a transcript). If the user happens
  // to have pasted an Anthropic key into their conversation, we don't
  // want it appearing in the diagnostic stderr. Redact `sk-(?:ant-)?…`
  // patterns before logging.
  const debug = !!process.env.BUDDY_DEBUG;
  const KEY_PATTERN = /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g;
  const safeStringify = (payload: unknown): string => {
    try {
      const raw = JSON.stringify(payload) ?? String(payload);
      return raw.slice(0, 200).replace(KEY_PATTERN, 'sk-***REDACTED***');
    } catch {
      return '<unserializable>';
    }
  };
  const drop = (reason: string, payload: unknown): void => {
    result.claimsDropped++;
    if (debug) console.error(`[buddy] writeClaims dropped: ${reason} — ${safeStringify(payload)}`);
  };
  const dropEdge = (reason: string, payload: unknown): void => {
    result.edgesDropped++;
    if (debug) console.error(`[buddy] writeClaims dropped edge: ${reason} — ${safeStringify(payload)}`);
  };

  // Single transaction covers claims + edges. Validation/sanitization per
  // item; malformed items are dropped individually but don't abort the
  // batch. A SQL-level failure rolls back the whole payload.
  const writeBatch = db.transaction(() => {
    // Claims first — their UUIDs must exist before we resolve edges.
    for (const c of claimsArr) {
      if (!c || typeof c !== 'object') { drop('not-an-object', c); continue; }
      const raw = c as any;
      const text = sanitizeClaim(raw.text);
      if (!text) { drop('empty/sanitized-away text', raw); continue; }
      if (!isValidBasis(raw.basis)) { drop(`invalid basis ${JSON.stringify(raw.basis)}`, raw); continue; }
      if (!isValidSpeaker(raw.speaker)) { drop(`invalid speaker ${JSON.stringify(raw.speaker)}`, raw); continue; }
      if (!isValidConfidence(raw.confidence)) { drop(`invalid confidence ${JSON.stringify(raw.confidence)}`, raw); continue; }
      const extId = typeof raw.external_id === 'string' ? raw.external_id : '';
      if (!extId) { drop('missing external_id (need a unique string per claim)', raw); continue; }

      // Duplicate external_id in the same payload: keep the first, drop
      // subsequent. Silent overwrite is worse — it would misdirect edges.
      if (externalIdToUuid.has(extId)) { drop(`duplicate external_id "${extId}"`, raw); continue; }

      const uuid = randomUUID();
      insertClaim.run(uuid, sessionId, raw.speaker, text, raw.basis, raw.confidence, now);
      externalIdToUuid.set(extId, uuid);
      priorPrefixMap.set(uuid.slice(0, 8).toLowerCase(), uuid);
      result.claimsWritten++;
    }

    // Edges second — same-payload and prior-UUID refs now all resolve.
    for (const e of edgesArr) {
      if (!e || typeof e !== 'object') { dropEdge('not-an-object', e); continue; }
      const raw = e as any;
      if (!isValidEdgeType(raw.type)) { dropEdge(`invalid type ${JSON.stringify(raw.type)}`, raw); continue; }
      const fromRef = typeof raw.from === 'string' ? raw.from : '';
      const toRef = typeof raw.to === 'string' ? raw.to : '';
      if (!fromRef || !toRef) { dropEdge('missing from/to (need string external_id or claim UUID)', raw); continue; }
      const fromUuid = resolveEndpoint(fromRef);
      const toUuid = resolveEndpoint(toRef);
      if (!fromUuid) { dropEdge(`unresolved from="${fromRef}" (no matching claim in this payload or session)`, raw); continue; }
      if (!toUuid) { dropEdge(`unresolved to="${toRef}" (no matching claim in this payload or session)`, raw); continue; }
      if (fromUuid === toUuid) { dropEdge('self-loop', raw); continue; }
      insertEdge.run(randomUUID(), sessionId, fromUuid, toUuid, raw.type, now);
      result.edgesWritten++;
    }
  });

  try {
    writeBatch();
  } catch {
    // Transaction-level failure: best-effort reset of counters so callers
    // see "nothing landed" rather than "some landed."
    result.claimsWritten = 0;
    result.edgesWritten = 0;
    result.claimsDropped = claimsArr.length;
    result.edgesDropped = edgesArr.length;
    return result;
  }

  pruneSessionCap(db, sessionId);
  // Invalidate the cached graph for this session so the next load pulls
  // fresh rows. No-op if no one has cached this session yet.
  if (result.claimsWritten > 0 || result.edgesWritten > 0) {
    bumpGeneration(sessionId);
  }
  return result;
}

function pruneSessionCap(db: Database.Database, sessionId: string): void {
  const row = db.prepare(
    `SELECT count(*) as n FROM reasoning_claims WHERE session_id = ?`
  ).get(sessionId) as { n: number };
  if (row.n <= REASONING_CONFIG.MAX_CLAIMS_PER_SESSION) return;
  const toDelete = row.n - REASONING_CONFIG.MAX_CLAIMS_PER_SESSION;
  const idsToDelete = db.prepare(
    `SELECT id FROM reasoning_claims WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`
  ).all(sessionId, toDelete) as Array<{ id: string }>;
  if (idsToDelete.length === 0) return;
  const del = db.prepare(`DELETE FROM reasoning_claims WHERE id = ?`);
  const delEdges = db.prepare(
    `DELETE FROM reasoning_edges WHERE session_id = ? AND (from_claim = ? OR to_claim = ?)`
  );
  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) { delEdges.run(sessionId, id, id); del.run(id); }
  });
  try { tx(idsToDelete.map(r => r.id)); } catch { /* best-effort */ }
}

export function loadRecentClaims(
  db: Database.Database, sessionId: string, limit: number,
): StoredClaim[] {
  const rows = db.prepare(
    `SELECT id, session_id, speaker, text, basis, confidence, created_at
     FROM reasoning_claims WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(sessionId, limit) as StoredClaim[];
  return rows.reverse();
}

export function countClaims(db: Database.Database, sessionId: string): number {
  const r = db.prepare(`SELECT count(*) as n FROM reasoning_claims WHERE session_id = ?`).get(sessionId) as { n: number };
  return r.n;
}
