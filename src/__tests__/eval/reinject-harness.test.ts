// Verifies the eval harness's own logic so a null result can't be blamed on a
// broken harness. The real Anthropic call is injected and never made here.
import { describe, it, expect } from 'vitest';
import {
  estimateTokens, generateSyntheticContext, buildFinalTurn,
  detectCompliance, runCell, aggregate, CLAIMS_EDGES_SCHEMA, parseTranscriptContext, withCacheBreakpoint,
  extractClaims, extractResponseText, parseGrade, isSubstantive, makeQualityClassifier, finalTurnText,
  // @ts-expect-error — plain .mjs harness, no type declarations
} from '../../../scripts/reinject-harness.mjs';

const toolResp = (claims: any[]) => ({ content: [{ type: 'tool_use', name: 'buddy_observe', input: { claims } }] });
const textResp = (t: string) => ({ content: [{ type: 'text', text: t }] });

const INSTR = '[guard mode] on your NEXT buddy_observe call include claims';

describe('synthetic context generation', () => {
  it('reaches the target token budget (within ~15%)', () => {
    for (const target of [5_000, 50_000]) {
      const msgs = generateSyntheticContext(target);
      const total = msgs.reduce((n: number, m: any) => n + estimateTokens(m.content), 0);
      expect(total).toBeGreaterThanOrEqual(target);
      expect(total).toBeLessThan(target * 1.15);
      expect(msgs[0].role).toBe('user'); // alternates user/assistant
    }
  });
});

describe('buildFinalTurn', () => {
  it('A omits the instruction; B/pos/neg carry it near the turn', () => {
    expect(buildFinalTurn('A', INSTR).content).not.toContain('[guard mode]');
    expect(buildFinalTurn('B', INSTR).content).toContain('[guard mode]');
    expect(buildFinalTurn('pos', INSTR).content).toContain('[guard mode]');
    const neg = buildFinalTurn('neg', INSTR).content;
    expect(neg).toContain('[guard mode]');
    expect(neg).toContain('thanks');           // trivial turn → should NOT trigger a claim
  });
  it("B' wraps the instruction as a system-reminder block (shipped placement), distinct from B's bare prefix", () => {
    const bp = buildFinalTurn('Bprime', INSTR).content;
    expect(bp).toContain('<system-reminder>');
    expect(bp).toContain('[guard mode]');
    expect(bp).not.toEqual(buildFinalTurn('B', INSTR).content); // genuinely different placement
  });
});

describe('detectCompliance', () => {
  it('true only for a non-empty buddy_observe tool_use', () => {
    expect(detectCompliance({ content: [{ type: 'tool_use', name: 'buddy_observe', input: { claims: [{ text: 'x' }] } }] })).toBe(true);
    expect(detectCompliance({ content: [{ type: 'tool_use', name: 'buddy_observe', input: { claims: [] } }] })).toBe(false);
    expect(detectCompliance({ content: [{ type: 'text', text: 'no tool call' }] })).toBe(false);
    expect(detectCompliance({ content: [{ type: 'tool_use', name: 'other', input: { claims: [{}] } }] })).toBe(false);
    expect(detectCompliance({})).toBe(false);
  });
});

describe('runCell', () => {
  it('counts compliance over N samples via the injected callModel', async () => {
    // comply on even samples only → 3/5
    const callModel = async (_req: any, s: number) =>
      s % 2 === 0 ? { content: [{ type: 'tool_use', name: 'buddy_observe', input: { claims: [{ text: 't' }] } }] }
                  : { content: [{ type: 'text', text: 'nope' }] };
    const r = await runCell({ callModel, request: {}, samples: 5 });
    expect(r).toEqual({ complied: 3, total: 5, rate: 3 / 5, binaryComplied: 3, binaryRate: 3 / 5 });
  });
});

describe('aggregate — validity gate', () => {
  const lengths = [50_000, 150_000];
  it('flags INVALID when the positive control is low', () => {
    const cells: any = { pos: { rate: 0.3 }, neg: { rate: 0.1 }, 'A@50000': { rate: 0.1 }, 'B@50000': { rate: 0.9 } };
    const out = aggregate(cells, lengths);
    expect(out.valid).toBe(false);
    expect(out.verdict).toContain('INVALID');
  });
  it('flags INVALID when the negative control fires too often', () => {
    const cells: any = { pos: { rate: 0.9 }, neg: { rate: 0.8 } };
    expect(aggregate(cells, lengths).valid).toBe(false);
  });
  it('reports a supported premise when controls pass and B lifts A', () => {
    const cells: any = {
      pos: { rate: 0.95 }, neg: { rate: 0.05 },
      'A@50000': { rate: 0.8 }, 'B@50000': { rate: 0.85 },
      'A@150000': { rate: 0.2 }, 'B@150000': { rate: 0.7 }, // +0.50 at long context
    };
    const out = aggregate(cells, lengths);
    expect(out.valid).toBe(true);
    expect(out.verdict).toContain('HELPS');
    expect(out.deltas.find((d: any) => d.length === 150_000).delta).toBeCloseTo(0.5);
  });
  it('a high long-context negative control invalidates the run', () => {
    const cells: any = { pos: { rate: 0.9 }, neg: { rate: 0.1 }, negLong: { rate: 0.6 } };
    const out = aggregate(cells, lengths);
    expect(out.valid).toBe(false);
    expect(out.verdict).toContain('negLong');
  });
  it("judges on B' (shipped placement) when Bprime cells are present", () => {
    const cells: any = {
      pos: { rate: 0.95 }, neg: { rate: 0.05 }, negLong: { rate: 0.0 },
      'A@50000': { rate: 0.2 }, 'B@50000': { rate: 1.0 }, 'Bprime@50000': { rate: 0.7 },
      'A@150000': { rate: 0.0 }, 'B@150000': { rate: 1.0 }, 'Bprime@150000': { rate: 0.5 },
    };
    const out = aggregate(cells, lengths);
    expect(out.valid).toBe(true);
    expect(out.verdict).toContain('B′'); // verdict keyed on shipped placement, not the prefix upper bound
    expect(out.deltas.find((d: any) => d.length === 150_000).deltaPrime).toBeCloseTo(0.5);
  });
  it('reports NOT supported when controls pass but deltas are flat', () => {
    const cells: any = {
      pos: { rate: 0.9 }, neg: { rate: 0.1 },
      'A@50000': { rate: 0.6 }, 'B@50000': { rate: 0.62 },
      'A@150000': { rate: 0.3 }, 'B@150000': { rate: 0.35 },
    };
    expect(aggregate(cells, lengths).verdict).toContain('NOT supported');
  });
});

describe('parseTranscriptContext (real-transcript loader)', () => {
  const lines = [
    '{"role":"user","content":"hello there one"}',
    '{"type":"x","message":{"role":"assistant","content":[{"type":"text","text":"hi back"},{"type":"tool_use","name":"Bash","input":{}}]}}',
    '{"message":{"role":"assistant","content":[{"type":"text","text":"more assistant"}]}}',
    'not json — skipped',
    '{"role":"user","content":"second user turn"}',
    '{"role":"user","content":"trailing user trimmed"}',
  ];

  it('extracts text turns, drops tool blocks, merges consecutive same-role, trims to user…assistant', () => {
    const ctx = parseTranscriptContext(lines, 1_000_000);
    expect(ctx).toEqual([
      { role: 'user', content: 'hello there one' },
      { role: 'assistant', content: 'hi back\n\nmore assistant' }, // merged; tool_use dropped
    ]);
    // trailing user turns trimmed so an appended final user turn stays valid
    expect(ctx[ctx.length - 1].role).toBe('assistant');
  });

  it('stops early once the token target is reached', () => {
    const ctx = parseTranscriptContext(lines, 1); // tiny target → first turn only, then trimmed
    expect(ctx.length).toBeLessThanOrEqual(2);
  });
});

describe('withCacheBreakpoint', () => {
  it('puts cache_control on a content BLOCK of the last message, not the message', () => {
    const ctx = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
    const out = withCacheBreakpoint(ctx);
    expect(out[0]).toEqual({ role: 'user', content: 'a' });            // untouched, string content
    expect((out[1] as any).cache_control).toBeUndefined();             // NOT on the message object
    expect(out[1].content).toEqual([{ type: 'text', text: 'b', cache_control: { type: 'ephemeral' } }]);
  });
  it('handles empty context', () => {
    expect(withCacheBreakpoint([])).toEqual([]);
  });
});

describe('quality grader', () => {
  it('extractClaims / extractResponseText pull the right fields', () => {
    expect(extractClaims(toolResp([{ text: 'a' }]))).toEqual([{ text: 'a' }]);
    expect(extractClaims(textResp('hi'))).toBeNull();
    expect(extractResponseText(textResp('SUBSTANTIVE'))).toBe('SUBSTANTIVE');
  });

  it('parseGrade reads the verdict word', () => {
    expect(parseGrade('SUBSTANTIVE')).toBe(true);
    expect(parseGrade('FILLER')).toBe(false);
    expect(parseGrade('these are FILLER claims')).toBe(false);
    expect(parseGrade('')).toBe(false);
  });

  it('isSubstantive skips the grader for empty claims, else uses its verdict', async () => {
    let calls = 0;
    const graderYes = async () => { calls++; return textResp('SUBSTANTIVE'); };
    const graderNo = async () => textResp('FILLER');
    expect(await isSubstantive(graderYes, finalTurnText('A'), [])).toBe(false);
    expect(calls).toBe(0);                                   // no grader call when nothing to grade
    expect(await isSubstantive(graderYes, finalTurnText('A'), [{ text: 'x' }])).toBe(true);
    expect(await isSubstantive(graderNo, finalTurnText('neg'), [{ text: 'thanks' }])).toBe(false);
  });

  it('makeQualityClassifier requires BOTH a call and a substantive verdict', async () => {
    const grader = async () => textResp('SUBSTANTIVE');
    const cls = makeQualityClassifier(grader, finalTurnText('A'));
    expect(await cls(textResp('no tool call'))).toBe(false);          // no call → false, grader not consulted
    expect(await cls(toolResp([{ text: 'real claim' }]))).toBe(true); // call + substantive → true
    const clsFiller = makeQualityClassifier(async () => textResp('FILLER'), finalTurnText('neg'));
    expect(await clsFiller(toolResp([{ text: 'thanks' }]))).toBe(false); // call but filler → false
  });
});

describe('schema sanity', () => {
  it('claims schema includes the convention basis', () => {
    expect(CLAIMS_EDGES_SCHEMA.properties.claims.items.properties.basis.enum).toContain('convention');
  });
});
