import { describe, it, expect } from 'vitest';
import {
  planModeChange,
  formatModeResponse,
} from '../../lib/reasoning/mode-handler.js';

const CURRENT = { observer_mode: 'both', insight_mode: 0 as const };

describe('planModeChange', () => {
  it('status when no args', () => {
    const plan = planModeChange({});
    expect(plan.kind).toBe('status');
    expect(plan.kind === 'status' && plan.legacyAliasUsed).toBe(false);
  });

  it('voice update', () => {
    const plan = planModeChange({ voice: 'skillcoach' });
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newVoice).toBe('skillcoach');
    expect(plan.newInsight).toBeUndefined();
    expect(plan.legacyAliasUsed).toBe(false);
  });

  it('insight on', () => {
    const plan = planModeChange({ insight: true });
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newInsight).toBe(1);
    expect(plan.newVoice).toBeUndefined();
  });

  it('insight off', () => {
    const plan = planModeChange({ insight: false });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newInsight).toBe(0);
  });

  it('voice + insight together, orthogonal', () => {
    const plan = planModeChange({ voice: 'backseat', insight: true });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newVoice).toBe('backseat');
    expect(plan.newInsight).toBe(1);
    expect(plan.changed).toHaveLength(2);
  });

  it('legacy `mode` aliases to voice with flag', () => {
    const plan = planModeChange({ mode: 'backseat' });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newVoice).toBe('backseat');
    expect(plan.legacyAliasUsed).toBe(true);
  });

  it('when both voice and mode given, voice wins and no deprecation noise', () => {
    const plan = planModeChange({ voice: 'skillcoach', mode: 'backseat' });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newVoice).toBe('skillcoach');
    expect(plan.legacyAliasUsed).toBe(false);
  });

  it('invalid voice → error', () => {
    const plan = planModeChange({ voice: 'nope' });
    expect(plan.kind).toBe('error');
    if (plan.kind !== 'error') throw new Error('unreachable');
    expect(plan.message).toMatch(/Invalid voice/);
  });

  it('invalid insight (not boolean) → error', () => {
    const plan = planModeChange({ insight: 'yes' as any });
    expect(plan.kind).toBe('error');
  });

  it('legacy `max` aliases to insight with deprecation flag', () => {
    const plan = planModeChange({ max: true });
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newInsight).toBe(1);
    expect(plan.legacyAliasUsed).toBe(true);
  });

  it('when both insight and max given, insight wins', () => {
    const plan = planModeChange({ insight: false, max: true });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newInsight).toBe(0);
    expect(plan.legacyAliasUsed).toBe(false);
  });
});

describe('formatModeResponse', () => {
  it('status includes current voice and insight', () => {
    const plan = planModeChange({});
    const text = formatModeResponse(plan, CURRENT);
    expect(text).toContain('voice:   both');
    expect(text).toContain('insight: off');
  });

  it('legacy alias note attached to status', () => {
    const plan = planModeChange({ mode: 'both' });
    const text = formatModeResponse(plan, CURRENT);
    expect(text).toMatch(/deprecated/);
  });

  it('update includes `Updated:` line', () => {
    const plan = planModeChange({ insight: true });
    const text = formatModeResponse(plan, { observer_mode: 'both', insight_mode: 1 });
    expect(text).toMatch(/^Updated:/);
    expect(text).toContain('insight → on');
    expect(text).toContain('voice=both, insight=on');
  });

  it('error format passes through', () => {
    const plan = planModeChange({ voice: 'bad' });
    const text = formatModeResponse(plan, CURRENT);
    expect(text).toMatch(/Invalid voice/);
  });
});
