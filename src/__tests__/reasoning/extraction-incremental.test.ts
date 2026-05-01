// Multi-call extraction harness — verifies that consecutive Stop hooks on a
// growing transcript do NOT produce duplicate claims, and that cross-batch
// edges resolve via the existing-claims context. Without the cursor +
// existing-claims wiring this test would catch:
//   - Same claim text getting written twice with fresh UUIDs
//   - Cross-turn edges never resolving (every batch is an island)
//
// The unit tests in extraction-state.test.ts cover the cursor + stats
// primitives in isolation; this test wires them together with the real
// readRecentTranscript / extractClaims (stubbed SDK) / toBuddyShape /
// runGuardPipeline / writeClaims path on top of the schema.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import {
  readRecentTranscript,
  countTranscriptTurns,
  extractClaims,
  toBuddyShape,
} from '../../lib/reasoning/transcript-extractor.js';
import { runGuardPipeline } from '../../lib/reasoning/pipeline.js';
import { resetGraphCache } from '../../lib/reasoning/index.js';
import { loadRecentClaims } from '../../lib/reasoning/writer.js';
import { getCursor, bumpCursor } from '../../lib/reasoning/extraction-state.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name) VALUES (?, ?)`).run('c1', 'Datao');
  return db;
}

function appendTurn(path: string, role: 'user' | 'assistant', content: string): void {
  appendFileSync(path, JSON.stringify({ role, content }) + '\n');
}

// Returns a stubbed Anthropic client whose `messages.create` returns whichever
// claims/edges the test wants for each call in order. If the test makes more
// calls than payloads provided, last is reused.
function sequencedClient(payloads: Array<{ claims: any[] }>) {
  let i = 0;
  return {
    messages: {
      create: vi.fn().mockImplementation(async () => {
        const payload = payloads[Math.min(i, payloads.length - 1)];
        i++;
        return {
          content: [{ type: 'tool_use', name: 'extract_claims', input: payload }],
          stop_reason: 'tool_use',
        };
      }),
    },
  };
}

describe('multi-call extraction (incremental cursor + existing-claims)', () => {
  let tmp: string;
  let path: string;
  let db: Database.Database;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'buddy-incr-'));
    path = join(tmp, 'transcript.jsonl');
    writeFileSync(path, '');
    db = memDb();
    resetGraphCache();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // Simulate one Stop-hook fire: read since cursor, call stub, write to pipeline,
  // bump cursor. Mirrors the real handler in stop-handler.ts:runExtractionForStop
  // minus the gating/telemetry concerns those have their own tests for.
  // Returns the actual session_id the pipeline used so the caller can query
  // the graph without having to know cwd-resolution details.
  async function fireHook(client: any, hostSessionId: string, knownSessionId?: string): Promise<{
    claimsWritten: number; edgesWritten: number; chunkContent: string;
    sessionId: string;
  }> {
    const cursor = getCursor(db, hostSessionId);
    const chunk = readRecentTranscript(path, cursor.lastExtractedTurnCount);
    if (!chunk.trim()) return { claimsWritten: 0, edgesWritten: 0, chunkContent: '', sessionId: knownSessionId ?? '' };

    // For existing-claims context we need to know the session id. On first
    // fire there are no claims yet so the lookup returns empty either way.
    const sessionForLookup = knownSessionId ?? '';
    const recentClaims = sessionForLookup ? loadRecentClaims(db, sessionForLookup, 10) : [];
    const existing = recentClaims.map(c => ({ id: c.id.slice(0, 8), text: c.text, basis: c.basis }));

    const resp = await extractClaims(chunk, existing, { apiKey: 'unused', client });
    expect(resp.ok).toBe(true);
    if (!resp.ok) return { claimsWritten: 0, edgesWritten: 0, chunkContent: chunk, sessionId: sessionForLookup };

    const newCount = countTranscriptTurns(path);
    bumpCursor(db, hostSessionId, newCount);

    const shaped = toBuddyShape(resp.result);
    if (shaped.claims.length === 0) return { claimsWritten: 0, edgesWritten: 0, chunkContent: chunk, sessionId: sessionForLookup };

    const out = runGuardPipeline(db, {
      companionId: 'c1', cwd: '/p', claims: shaped.claims, edges: shaped.edges,
    });
    return {
      claimsWritten: out.writeResult.claimsWritten,
      edgesWritten: out.writeResult.edgesWritten,
      chunkContent: chunk,
      sessionId: out.sessionId,
    };
  }

  it('does not duplicate claims across consecutive Stop hooks', async () => {
    // ── Turn 1: user makes a vibes claim, assistant deduces.
    appendTurn(path, 'user', 'we need authentication on every endpoint');
    appendTurn(path, 'assistant', 'so we need session storage too');

    const client = sequencedClient([
      { claims: [
        { index: 0, text: 'we need authentication on every endpoint', basis: 'vibes', confidence: 'medium', speaker: 'user' },
        { index: 1, text: 'so we need session storage', basis: 'deduction', confidence: 'medium', speaker: 'assistant', depends_on_indices: [0] },
      ] },
      // ── Turn 2 stub: only NEW claims (LLM-side), referencing existing via _existing.
      // The existing claim's 8-char prefix gets sent in the prompt — we can't predict
      // the UUID at test-write time, so we don't reference _existing here. The point
      // is the LLM must NOT re-emit claim 0 because the cursor advances.
      { claims: [
        { index: 0, text: 'and rotating tokens with refresh', basis: 'deduction', confidence: 'medium', speaker: 'assistant' },
      ] },
    ]);

    const r1 = await fireHook(client, 'host-session-A');
    expect(r1.claimsWritten).toBe(2);
    expect(r1.chunkContent).toContain('authentication on every endpoint');
    const sessionId = r1.sessionId;

    // ── Turn 2: user adds a follow-up. The hook should ONLY see this turn.
    appendTurn(path, 'user', 'and rotating tokens with refresh');

    const r2 = await fireHook(client, 'host-session-A', sessionId);
    expect(r2.claimsWritten).toBe(1);
    // The chunk fed to the LLM on call #2 must be ONLY the new turn — turns
    // 1 and 2 must be excluded by the cursor.
    expect(r2.chunkContent).not.toContain('authentication on every endpoint');
    expect(r2.chunkContent).not.toContain('session storage too');
    expect(r2.chunkContent).toContain('rotating tokens');

    // ── Final graph: 3 distinct claims, no duplicates.
    const claimRows = db.prepare(
      `SELECT text FROM reasoning_claims WHERE session_id = ? ORDER BY created_at ASC`,
    ).all(sessionId) as Array<{ text: string }>;
    expect(claimRows).toHaveLength(3);
    const texts = claimRows.map(r => r.text);
    expect(texts.filter(t => t.includes('authentication on every endpoint'))).toHaveLength(1);
    expect(texts.filter(t => t.includes('session storage'))).toHaveLength(1);
    expect(texts.filter(t => t.includes('rotating tokens'))).toHaveLength(1);
  });

  it('passes prior-turn claims to extractClaims so the LLM can edge into them', async () => {
    // ── Turn 1: seed a claim through the real pipeline so we capture both
    // its actual UUID and the actual session_id the pipeline derives.
    appendTurn(path, 'user', 'auth must be on every endpoint');
    const seedClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'tool_use', name: 'extract_claims',
            input: { claims: [
              { index: 0, text: 'auth must be on every endpoint', basis: 'vibes', confidence: 'medium', speaker: 'user' },
            ] },
          }],
          stop_reason: 'tool_use',
        }),
      },
    };
    const r1 = await fireHook(seedClient, 'host-session-B');
    expect(r1.claimsWritten).toBe(1);
    const sessionId = r1.sessionId;
    const seededRow = db.prepare(`SELECT id FROM reasoning_claims WHERE session_id = ?`).get(sessionId) as { id: string };
    const seededPrefix = seededRow.id.slice(0, 8);

    // ── Turn 2: assistant builds on it. Stub captures the prompt body so we
    // can verify the existing-claim block was injected, and emits a claim
    // that depends_on_existing the seeded claim's prefix.
    appendTurn(path, 'assistant', 'so we need rotating tokens');
    const seen = { promptBodies: [] as string[] };
    const client = {
      messages: {
        create: vi.fn().mockImplementation(async (params: any) => {
          seen.promptBodies.push(params.messages?.[0]?.content ?? '');
          return {
            content: [{
              type: 'tool_use', name: 'extract_claims',
              input: { claims: [
                { index: 0, text: 'so we need rotating tokens', basis: 'deduction', confidence: 'medium', speaker: 'assistant',
                  depends_on_existing: [seededPrefix] },
              ] },
            }],
            stop_reason: 'tool_use',
          };
        }),
      },
    };

    const out = await fireHook(client, 'host-session-B', sessionId);

    // The LLM-facing prompt MUST contain the prior claim ID prefix and text,
    // otherwise the LLM has no way to draw cross-turn edges.
    const body = seen.promptBodies[0] ?? '';
    expect(body).toContain(seededPrefix);
    expect(body).toContain('auth must be on every endpoint');

    // The cross-turn edge must have landed (resolved by writeClaims via the
    // 8-char UUID prefix lookup). Without existing-claims wiring, this edge
    // would be silently dropped.
    expect(out.edgesWritten).toBe(1);
    const edges = db.prepare(`SELECT from_claim, to_claim FROM reasoning_edges`).all() as Array<{ from_claim: string; to_claim: string }>;
    expect(edges).toHaveLength(1);
    expect(edges[0].to_claim).toBe(seededRow.id);
  });

  it('different host sessions get independent cursors', async () => {
    appendTurn(path, 'user', 'turn 1');
    const client = sequencedClient([
      { claims: [{ index: 0, text: 'claim from session A turn 1', basis: 'vibes', confidence: 'low', speaker: 'user' }] },
      { claims: [{ index: 0, text: 'claim from session B turn 1', basis: 'vibes', confidence: 'low', speaker: 'user' }] },
    ]);

    // Session A starts at cursor 0, processes turn 1.
    await fireHook(client, 'host-A', 'p-20260501');
    expect(getCursor(db, 'host-A').lastExtractedTurnCount).toBe(1);
    // Session B has its own cursor — also starts at 0.
    expect(getCursor(db, 'host-B').lastExtractedTurnCount).toBe(0);

    // Now session B processes — should ALSO see turn 1 because its cursor was 0.
    const r = await fireHook(client, 'host-B', 'p-20260501');
    expect(r.chunkContent).toContain('turn 1');
    expect(getCursor(db, 'host-B').lastExtractedTurnCount).toBe(1);
  });
});
