import { describe, it, expect } from 'vitest';
import {
  planModeChange,
  formatModeResponse,
} from '../../lib/reasoning/mode-handler.js';

const CURRENT = { observer_mode: 'both', max_mode: 0 as const };

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
    expect(plan.newMax).toBeUndefined();
    expect(plan.legacyAliasUsed).toBe(false);
  });

  it('max on', () => {
    const plan = planModeChange({ max: true });
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newMax).toBe(1);
    expect(plan.newVoice).toBeUndefined();
  });

  it('max off', () => {
    const plan = planModeChange({ max: false });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newMax).toBe(0);
  });

  it('voice + max together, orthogonal', () => {
    const plan = planModeChange({ voice: 'backseat', max: true });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newVoice).toBe('backseat');
    expect(plan.newMax).toBe(1);
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

  it('invalid max (not boolean) → error', () => {
    const plan = planModeChange({ max: 'yes' as any });
    expect(plan.kind).toBe('error');
  });
});

describe('formatModeResponse', () => {
  it('status includes current voice and max', () => {
    const plan = planModeChange({});
    const text = formatModeResponse(plan, CURRENT);
    expect(text).toContain('voice: both');
    expect(text).toContain('max:   off');
  });

  it('legacy alias note attached to status', () => {
    const plan = planModeChange({ mode: 'both' });
    const text = formatModeResponse(plan, CURRENT);
    expect(text).toMatch(/deprecated/);
  });

  it('update includes `Updated:` line', () => {
    const plan = planModeChange({ max: true });
    const text = formatModeResponse(plan, { observer_mode: 'both', max_mode: 1 });
    expect(text).toMatch(/^Updated:/);
    expect(text).toContain('max → on');
    expect(text).toContain('voice=both, max=on');
  });

  it('error format passes through', () => {
    const plan = planModeChange({ voice: 'bad' });
    const text = formatModeResponse(plan, CURRENT);
    expect(text).toMatch(/Invalid voice/);
  });
});
