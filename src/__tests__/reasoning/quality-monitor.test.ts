import { describe, it, expect, beforeEach } from 'vitest';
import { telemetry } from '../../lib/reasoning/index.js';
import { basisDistributionHealth } from '../../lib/reasoning/telemetry.js';
import type { Basis } from '../../lib/reasoning/types.js';

describe('basisDistributionHealth', () => {
  beforeEach(() => telemetry.reset());

  it('returns {degenerate:false} when sample is too small', () => {
    for (let i = 0; i < 10; i++) telemetry.recordBasis('vibes');
    const h = basisDistributionHealth();
    expect(h.degenerate).toBe(false);
    expect(h.sample).toBe(10);
  });

  it('flags degenerate when one basis > 80% of window (>= 20 sample)', () => {
    for (let i = 0; i < 25; i++) telemetry.recordBasis('vibes');
    for (let i = 0; i < 3; i++) telemetry.recordBasis('research' as Basis);
    const h = basisDistributionHealth();
    expect(h.degenerate).toBe(true);
    expect(h.dominantBasis).toBe('vibes');
    expect((h.pct ?? 0)).toBeGreaterThan(0.8);
  });

  it('does not flag when distribution is mixed', () => {
    const bases: Basis[] = ['vibes', 'assumption', 'deduction', 'empirical', 'research', 'analogy'];
    for (let i = 0; i < 30; i++) telemetry.recordBasis(bases[i % bases.length]);
    const h = basisDistributionHealth();
    expect(h.degenerate).toBe(false);
  });

  it('window is rolling — oldest entries age out', () => {
    for (let i = 0; i < 100; i++) telemetry.recordBasis('vibes');
    const snap = telemetry.snapshot();
    expect(snap.basis_window.length).toBeLessThanOrEqual(50);
  });
});

describe('root source telemetry', () => {
  beforeEach(() => telemetry.reset());

  it('records each source independently', () => {
    telemetry.recordRootResolution('hint');
    telemetry.recordRootResolution('env');
    telemetry.recordRootResolution('marker');
    telemetry.recordRootResolution('homedir');
    telemetry.recordRootResolution('homedir');
    const s = telemetry.snapshot().root_source_counts;
    expect(s.hint).toBe(1);
    expect(s.env).toBe(1);
    expect(s.marker).toBe(1);
    expect(s.homedir).toBe(2);
    expect(s.cwd).toBe(0);
  });
});

describe('pipeline-failure counter', () => {
  beforeEach(() => telemetry.reset());

  it('recordPipelineFailure bumps the counter', () => {
    expect(telemetry.snapshot().pipeline_failures_total).toBe(0);
    telemetry.recordPipelineFailure();
    expect(telemetry.snapshot().pipeline_failures_total).toBe(1);
    telemetry.recordPipelineFailure();
    telemetry.recordPipelineFailure();
    expect(telemetry.snapshot().pipeline_failures_total).toBe(3);
  });

  it('reset clears the counter', () => {
    telemetry.recordPipelineFailure();
    telemetry.reset();
    expect(telemetry.snapshot().pipeline_failures_total).toBe(0);
  });
});
