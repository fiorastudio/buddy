import { describe, it, expect, beforeEach } from 'vitest';
import { telemetry } from '../../lib/reasoning/index.js';
import { edgeDistributionHealth } from '../../lib/reasoning/telemetry.js';

describe('reasoning telemetry signal health', () => {
  beforeEach(() => telemetry.reset());

  it('flags support-dominant edge windows with no contradicts', () => {
    for (let i = 0; i < 9; i++) telemetry.recordEdgeType('supports');
    for (let i = 0; i < 3; i++) telemetry.recordEdgeType('questions');
    const h = edgeDistributionHealth();
    expect(h.sample).toBe(12);
    expect(h.supportDominant).toBe(true);
    expect(h.noContradicts).toBe(true);
  });

  it('tracks detected and suppressed findings in snapshot', () => {
    telemetry.recordDetectedFindings(['load_bearing_vibes', 'unverified_hedge']);
    telemetry.recordSuppressedFinding('cooldown');
    telemetry.recordSuppressedFinding('budget');
    const s = telemetry.snapshot();
    expect(s.findings_detected_total).toBe(2);
    expect(s.findings_detected_by_type.unverified_hedge).toBe(1);
    expect(s.finding_suppressed_cooldown_total).toBe(1);
    expect(s.finding_suppressed_budget_total).toBe(1);
  });
});
