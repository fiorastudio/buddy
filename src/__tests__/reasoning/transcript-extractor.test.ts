import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readRecentTranscript,
  countTranscriptTurns,
  toBuddyShape,
  extractClaims,
} from '../../lib/reasoning/transcript-extractor.js';
import type { ExtractionResult } from '../../lib/reasoning/extract-prompt-v7.js';

describe('readRecentTranscript', () => {
  let tmp: string;
  let path: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'buddy-tx-'));
    path = join(tmp, 'transcript.jsonl');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('returns empty string when file does not exist', () => {
    expect(readRecentTranscript(join(tmp, 'missing.jsonl'))).toBe('');
  });

  it('handles flat {role, content: string} format', () => {
    writeFileSync(path, [
      '{"role":"user","content":"hi"}',
      '{"role":"assistant","content":"hello"}',
    ].join('\n'));
    const out = readRecentTranscript(path);
    expect(out).toContain('[user]: hi');
    expect(out).toContain('[assistant]: hello');
  });

  it('handles nested {message:{role,content}} format', () => {
    writeFileSync(path, [
      JSON.stringify({ type: 'turn', message: { role: 'user', content: 'first' } }),
      JSON.stringify({ type: 'turn', message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] } }),
    ].join('\n'));
    const out = readRecentTranscript(path);
    expect(out).toContain('[user]: first');
    expect(out).toContain('[assistant]: second');
  });

  it('extracts only text-type content blocks from arrays, ignoring tool_use', () => {
    writeFileSync(path, JSON.stringify({
      role: 'assistant',
      content: [
        { type: 'text', text: 'visible' },
        { type: 'tool_use', id: 'a', name: 'X', input: {} },
        { type: 'text', text: 'also visible' },
      ],
    }));
    const out = readRecentTranscript(path);
    expect(out).toContain('visible');
    expect(out).toContain('also visible');
    expect(out).not.toContain('tool_use');
  });

  it('skips non-user/non-assistant entries (system, summaries)', () => {
    writeFileSync(path, [
      JSON.stringify({ role: 'system', content: 'should be skipped' }),
      JSON.stringify({ role: 'user', content: 'kept' }),
    ].join('\n'));
    const out = readRecentTranscript(path);
    expect(out).not.toContain('should be skipped');
    expect(out).toContain('kept');
  });

  it('skips malformed JSON lines and continues', () => {
    writeFileSync(path, [
      'not json',
      JSON.stringify({ role: 'user', content: 'survived' }),
      '{broken',
    ].join('\n'));
    const out = readRecentTranscript(path);
    expect(out).toContain('survived');
  });

  it('caps output at 50 messages even when transcript is longer', () => {
    const lines: string[] = [];
    for (let i = 0; i < 80; i++) {
      lines.push(JSON.stringify({ role: 'user', content: `msg-${i}` }));
    }
    writeFileSync(path, lines.join('\n'));
    const out = readRecentTranscript(path);
    // Sliding-50 over 80: should keep msg-30 .. msg-79.
    expect(out).toContain('msg-79');
    expect(out).toContain('msg-30');
    expect(out).not.toContain('msg-29');
  });

  it('respects sinceTurn boundary', () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify({ role: 'user', content: `t${i}` }));
    }
    writeFileSync(path, lines.join('\n'));
    const out = readRecentTranscript(path, 5);
    // sinceTurn=5 should yield t5..t9.
    expect(out).not.toContain('t4');
    expect(out).toContain('t5');
    expect(out).toContain('t9');
  });
});

describe('countTranscriptTurns', () => {
  let tmp: string;
  let path: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'buddy-tx-count-'));
    path = join(tmp, 'transcript.jsonl');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('returns 0 for missing file', () => {
    expect(countTranscriptTurns(join(tmp, 'missing.jsonl'))).toBe(0);
  });

  it('counts user + assistant turns, ignoring system entries and malformed lines', () => {
    writeFileSync(path, [
      JSON.stringify({ role: 'user', content: 'a' }),
      JSON.stringify({ role: 'system', content: 'should be skipped' }),
      JSON.stringify({ role: 'assistant', content: 'b' }),
      'malformed',
      JSON.stringify({ message: { role: 'user', content: 'nested format c' } }),
      JSON.stringify({ role: 'assistant', content: 'd' }),
    ].join('\n'));
    expect(countTranscriptTurns(path)).toBe(4);
  });
});

describe('extractClaims — error handling and key redaction', () => {
  it('redacts sk-ant-... keys from error messages on failure', async () => {
    const stub = {
      messages: {
        create: vi.fn().mockRejectedValue(
          Object.assign(new Error('Bad key sk-ant-abcd1234efgh5678ijkl9012 leaked into message'), { status: 401 }),
        ),
      },
    };
    const resp = await extractClaims('user: hi', [], { apiKey: 'unused', client: stub as any });
    expect(resp.ok).toBe(false);
    if (!resp.ok) {
      expect(resp.reason).not.toMatch(/sk-ant-abcd1234efgh5678ijkl9012/);
      expect(resp.reason).toContain('REDACTED');
    }
  });

  it('redacts sk- (older variant) keys', async () => {
    const stub = {
      messages: {
        create: vi.fn().mockRejectedValue(
          Object.assign(new Error('failed: sk-abcdefghijklmnopqrstuvwxyz123456'), { status: 401 }),
        ),
      },
    };
    const resp = await extractClaims('user: hi', [], { apiKey: 'unused', client: stub as any });
    if (!resp.ok) {
      expect(resp.reason).not.toMatch(/sk-abcdefghij/);
      expect(resp.reason).toContain('REDACTED');
    }
  });

  it('returns timeout reason on AbortError-shaped failures', async () => {
    const stub = {
      messages: {
        create: vi.fn().mockRejectedValue(
          Object.assign(new Error('Request timed out'), { name: 'APIConnectionTimeoutError' }),
        ),
      },
    };
    const resp = await extractClaims('user: hi', [], { apiKey: 'unused', client: stub as any });
    expect(resp.ok).toBe(false);
    if (!resp.ok) expect(resp.reason).toBe('timeout');
  });

  it('returns truncated reason when stop_reason is max_tokens', async () => {
    const stub = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'tool_use', name: 'extract_claims', input: { claims: [] } }],
          stop_reason: 'max_tokens',
        }),
      },
    };
    const resp = await extractClaims('user: hi', [], { apiKey: 'unused', client: stub as any });
    expect(resp.ok).toBe(false);
    if (!resp.ok) expect(resp.reason).toMatch(/truncated/);
  });

  it('returns ok with empty result for empty transcript chunk (skip API call)', async () => {
    const stub = { messages: { create: vi.fn() } };
    const resp = await extractClaims('   \n  ', [], { apiKey: 'unused', client: stub as any });
    expect(resp.ok).toBe(true);
    if (resp.ok) expect(resp.result.claims).toEqual([]);
    expect(stub.messages.create).not.toHaveBeenCalled();
  });
});

describe('toBuddyShape', () => {
  it('produces empty arrays for an empty extraction', () => {
    const out = toBuddyShape({ claims: [] });
    expect(out.claims).toEqual([]);
    expect(out.edges).toEqual([]);
  });

  it('maps a flat claim list to ClaimInput[] with c{index} external_ids', () => {
    const result: ExtractionResult = {
      claims: [
        { index: 0, text: 'a', basis: 'vibes', confidence: 'medium', speaker: 'user' },
        { index: 1, text: 'b', basis: 'llm_output', confidence: 'high', speaker: 'assistant' },
      ],
    };
    const out = toBuddyShape(result);
    expect(out.claims).toHaveLength(2);
    expect(out.claims[0]).toMatchObject({ text: 'a', basis: 'vibes', external_id: 'c0' });
    expect(out.claims[1]).toMatchObject({ text: 'b', basis: 'llm_output', external_id: 'c1' });
  });

  it('maps slimemold v7 "convention" basis to "definition"', () => {
    const out = toBuddyShape({
      claims: [{ index: 0, text: 'we use beads', basis: 'convention', confidence: 'high', speaker: 'user' }],
    });
    expect(out.claims[0].basis).toBe('definition');
  });

  it('drops claims with unmappable basis', () => {
    const out = toBuddyShape({
      claims: [
        { index: 0, text: 'good', basis: 'vibes', confidence: 'low', speaker: 'user' },
        { index: 1, text: 'bad', basis: 'totally_made_up' as any, confidence: 'low', speaker: 'user' },
      ],
    });
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].text).toBe('good');
  });

  it('drops claims with invalid speaker / confidence', () => {
    const out = toBuddyShape({
      claims: [
        { index: 0, text: 'a', basis: 'vibes', confidence: 'low', speaker: 'document' as any },
        { index: 1, text: 'b', basis: 'vibes', confidence: 0.9 as any, speaker: 'user' },
        { index: 2, text: 'c', basis: 'vibes', confidence: 'medium', speaker: 'user' },
      ],
    });
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].text).toBe('c');
  });

  it('flattens *_indices arrays into directed edges', () => {
    const result: ExtractionResult = {
      claims: [
        { index: 0, text: 'a', basis: 'vibes', confidence: 'low', speaker: 'user' },
        { index: 1, text: 'b', basis: 'llm_output', confidence: 'medium', speaker: 'assistant', supports_indices: [0] },
        { index: 2, text: 'c', basis: 'llm_output', confidence: 'medium', speaker: 'assistant', depends_on_indices: [0, 1], questions_indices: [0] },
      ],
    };
    const out = toBuddyShape(result);
    expect(out.edges).toContainEqual({ from: 'c1', to: 'c0', type: 'supports' });
    expect(out.edges).toContainEqual({ from: 'c2', to: 'c0', type: 'depends_on' });
    expect(out.edges).toContainEqual({ from: 'c2', to: 'c1', type: 'depends_on' });
    expect(out.edges).toContainEqual({ from: 'c2', to: 'c0', type: 'questions' });
  });

  it('flattens *_existing arrays into edges with raw external ids', () => {
    const out = toBuddyShape({
      claims: [{
        index: 0, text: 'a', basis: 'vibes', confidence: 'low', speaker: 'user',
        depends_on_existing: ['abcd1234'],
      }],
    });
    expect(out.edges).toContainEqual({ from: 'c0', to: 'abcd1234', type: 'depends_on' });
  });

  it('drops self-edges', () => {
    const out = toBuddyShape({
      claims: [{
        index: 0, text: 'a', basis: 'vibes', confidence: 'low', speaker: 'user',
        depends_on_indices: [0],
      }],
    });
    expect(out.edges).toEqual([]);
  });

  it('drops edges referencing unknown intra-batch indices', () => {
    const out = toBuddyShape({
      claims: [{
        index: 0, text: 'a', basis: 'vibes', confidence: 'low', speaker: 'user',
        depends_on_indices: [99],
      }],
    });
    expect(out.edges).toEqual([]);
  });
});
