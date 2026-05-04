// End-to-end exercise of the hook-driven extraction flow:
//   transcript JSONL  →  readRecentTranscript
//                     →  extractClaims (with stubbed Anthropic client)
//                     →  toBuddyShape
//                     →  runGuardPipeline (real, against an in-memory DB)
//                     →  deliverPendingFindings (verifies stdout)
//
// The Anthropic call is stubbed via the `client` injection point on
// `extractClaims`. The pipeline, store, finding selection, and delivery code
// all run for real — so this test catches wiring breaks across the
// transcript-extractor / pipeline / delivery seam that the per-module unit
// tests can't see individually.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import {
  readRecentTranscript,
  extractClaims,
  toBuddyShape,
} from '../../lib/reasoning/transcript-extractor.js';
import { runGuardPipeline } from '../../lib/reasoning/pipeline.js';
import { deliverPendingFindings } from '../../lib/reasoning/delivery.js';
import {
  telemetry,
  resetGraphCache,
} from '../../lib/reasoning/index.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name) VALUES (?, ?)`).run('c1', 'Datao');
  return db;
}

// Build a transcript JSONL where the assistant adopts a user vibes claim and
// builds 3 deductions on top of it — exactly the load_bearing_vibes pattern
// the detectors fire on.
function fakeTranscript(): string {
  const turns = [
    { role: 'user', content: 'we need auth on every endpoint, no exceptions' },
    { role: 'assistant', content: 'right. so that means we need session storage.' },
    { role: 'assistant', content: 'and rotating tokens with a refresh flow.' },
    { role: 'assistant', content: 'and per-route rate limits on top of that.' },
    { role: 'user', content: 'sounds right to me' },
  ];
  return turns.map(t => JSON.stringify(t)).join('\n');
}

// What a well-behaved Haiku call would return for the transcript above. The
// stub mirrors the Anthropic SDK Message shape just enough for extractClaims
// to find the tool_use block and parse it.
function stubClient(toolInput: unknown): any {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          { type: 'tool_use', name: 'extract_claims', input: toolInput },
        ],
        stop_reason: 'tool_use',
      }),
    },
  };
}

describe('hook-driven extraction — end to end', () => {
  let tmp: string;
  let path: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let captured: string[];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'buddy-e2e-'));
    path = join(tmp, 'transcript.jsonl');
    writeFileSync(path, fakeTranscript());

    captured = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    }) as any);

    telemetry.reset();
    resetGraphCache();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('runs Stop-hook extraction → pipeline → UserPromptSubmit delivery', async () => {
    // ── Step 1: Stop hook reads transcript + calls API stub
    const { chunk } = readRecentTranscript(path, 0);
    expect(chunk).toContain('we need auth');
    expect(chunk).toContain('rotating tokens');

    const client = stubClient({
      claims: [
        { index: 0, text: 'we need auth on every endpoint', basis: 'vibes', confidence: 'medium', speaker: 'user' },
        { index: 1, text: 'so we need session storage', basis: 'deduction', confidence: 'medium', speaker: 'assistant', depends_on_indices: [0] },
        { index: 2, text: 'so we need rotating tokens', basis: 'deduction', confidence: 'medium', speaker: 'assistant', depends_on_indices: [0] },
        { index: 3, text: 'so we need per-route rate limits', basis: 'deduction', confidence: 'medium', speaker: 'assistant', depends_on_indices: [0] },
        // Two more grounded claims — guard mode requires >=6 claims
        // (COLD_START_MIN_CLAIMS) before detectors fire.
        { index: 4, text: 'using express 5', basis: 'definition', confidence: 'high', speaker: 'assistant' },
        { index: 5, text: 'node 20', basis: 'definition', confidence: 'high', speaker: 'assistant' },
      ],
    });

    const resp = await extractClaims(chunk, [], { apiKey: 'unused', client });
    expect(resp.ok).toBe(true);
    if (!resp.ok) return; // narrow

    // ── Step 2: shape conversion
    const shaped = toBuddyShape(resp.result);
    expect(shaped.claims).toHaveLength(6);
    expect(shaped.edges).toContainEqual({ from: 'c1', to: 'c0', type: 'depends_on' });
    expect(shaped.edges).toContainEqual({ from: 'c2', to: 'c0', type: 'depends_on' });
    expect(shaped.edges).toContainEqual({ from: 'c3', to: 'c0', type: 'depends_on' });

    // ── Step 3: pipeline writes claims, picks a finding, logs it
    const db = memDb();
    const pipelineOut = runGuardPipeline(db, {
      companionId: 'c1',
      cwd: '/some/project',
      claims: shaped.claims,
      edges: shaped.edges,
    });

    expect(pipelineOut.writeResult.claimsWritten).toBe(6);
    expect(pipelineOut.writeResult.edgesWritten).toBe(3);
    expect(pipelineOut.finding).not.toBeNull();
    expect(pipelineOut.finding!.type).toBe('load_bearing_vibes');

    // Findings log row was created.
    const loggedCount = (db.prepare(
      'SELECT count(*) as n FROM reasoning_findings_log WHERE companion_id = ?'
    ).get('c1') as { n: number }).n;
    expect(loggedCount).toBe(1);

    // ── Step 4: UserPromptSubmit hook drains the finding into next-prompt context
    const delivery = deliverPendingFindings(db, 'c1');
    expect(delivery.delivered).toBe(1);
    const out = captured.join('');
    expect(out).toContain('[buddy observation]');
    expect(out).toMatch(/we need auth/);

    // ── Step 5: re-running delivery emits nothing (high-water mark holds)
    captured.length = 0;
    const second = deliverPendingFindings(db, 'c1');
    expect(second.delivered).toBe(0);
    expect(captured.join('')).toBe('');
  });

  it('records extraction telemetry across the success path', async () => {
    const client = stubClient({ claims: [] });
    telemetry.recordExtractionAttempt();
    const resp = await extractClaims('user: hello', [], { apiKey: 'unused', client });
    if (resp.ok) telemetry.recordExtractionSuccess();

    const stats = telemetry.snapshot();
    expect(stats.extraction_attempts_total).toBe(1);
    expect(stats.extraction_succeeded_total).toBe(1);
    expect(stats.extraction_failed_total).toBe(0);
  });

  it('records extraction failure telemetry with bucketed reason', async () => {
    const failingClient = {
      messages: {
        create: vi.fn().mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 })),
      },
    };
    telemetry.recordExtractionAttempt();
    const resp = await extractClaims('user: hello', [], { apiKey: 'unused', client: failingClient as any });
    expect(resp.ok).toBe(false);
    if (!resp.ok) telemetry.recordExtractionFailure(resp.reason);

    const stats = telemetry.snapshot();
    expect(stats.extraction_failed_total).toBe(1);
    expect(stats.extraction_failure_reasons.http_401).toBe(1);
  });
});
