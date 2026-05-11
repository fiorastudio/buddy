import { describe, it, expect } from 'vitest';
import {
  planModeChange,
  formatModeResponse,
} from '../../lib/reasoning/mode-handler.js';

const CURRENT = { observer_mode: 'both', guard_mode: 0 as const };

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
    expect(plan.newGuard).toBeUndefined();
    expect(plan.legacyAliasUsed).toBe(false);
  });

  it('guard on', () => {
    const plan = planModeChange({ guard: true });
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newGuard).toBe(1);
    expect(plan.newVoice).toBeUndefined();
  });

  it('guard off', () => {
    const plan = planModeChange({ guard: false });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newGuard).toBe(0);
  });

  it('voice + guard together, orthogonal', () => {
    const plan = planModeChange({ voice: 'backseat', guard: true });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newVoice).toBe('backseat');
    expect(plan.newGuard).toBe(1);
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

  it('invalid guard (not boolean) → error', () => {
    const plan = planModeChange({ guard: 'yes' as any });
    expect(plan.kind).toBe('error');
  });

  it('legacy `insight` aliases to guard with deprecation flag', () => {
    const plan = planModeChange({ insight: true });
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newGuard).toBe(1);
    expect(plan.legacyAliasUsed).toBe(true);
  });

  it('legacy `max` aliases to guard with deprecation flag', () => {
    const plan = planModeChange({ max: true });
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newGuard).toBe(1);
    expect(plan.legacyAliasUsed).toBe(true);
  });

  it('guard beats insight when both given', () => {
    const plan = planModeChange({ guard: false, insight: true });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newGuard).toBe(0);
    expect(plan.legacyAliasUsed).toBe(false);
  });

  it('guard beats max when both given', () => {
    const plan = planModeChange({ guard: true, max: false });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newGuard).toBe(1);
    expect(plan.legacyAliasUsed).toBe(false);
  });

  it('insight beats max when both given (no guard)', () => {
    const plan = planModeChange({ insight: false, max: true });
    if (plan.kind !== 'update') throw new Error('unreachable');
    expect(plan.newGuard).toBe(0);
    expect(plan.legacyAliasUsed).toBe(true);
  });
});

describe('formatModeResponse', () => {
  it('status includes current voice and guard', () => {
    const plan = planModeChange({});
    const text = formatModeResponse(plan, CURRENT);
    expect(text).toContain('voice: both');
    expect(text).toContain('guard: off');
  });

  it('legacy alias note attached to status', () => {
    const plan = planModeChange({ mode: 'both' });
    const text = formatModeResponse(plan, CURRENT);
    expect(text).toMatch(/deprecated/);
  });

  it('update includes `Updated:` line', () => {
    const plan = planModeChange({ guard: true });
    const text = formatModeResponse(plan, { observer_mode: 'both', guard_mode: 1 });
    expect(text).toMatch(/^Updated:/);
    expect(text).toContain('guard → on');
    expect(text).toContain('voice=both, guard=on');
  });

  it('error format passes through', () => {
    const plan = planModeChange({ voice: 'bad' });
    const text = formatModeResponse(plan, CURRENT);
    expect(text).toMatch(/Invalid voice/);
  });

  it('deprecation note mentions insight and max when insight alias used', () => {
    const plan = planModeChange({ insight: true });
    const text = formatModeResponse(plan, { observer_mode: 'both', guard_mode: 1 });
    expect(text).toMatch(/insight.*deprecated/);
  });

  it('deprecation note mentions max when max alias used', () => {
    const plan = planModeChange({ max: true });
    const text = formatModeResponse(plan, { observer_mode: 'both', guard_mode: 1 });
    expect(text).toMatch(/max.*deprecated/i);
  });

  it('shows precise extraction line when guard is on and key is set', () => {
    const plan = planModeChange({});
    const text = formatModeResponse(plan, { observer_mode: 'both', guard_mode: 1, extraction_mode: 'precise' });
    expect(text).toContain('extraction: precise');
  });

  it('shows lossy extraction line with helper hint when guard is on but no key', () => {
    const plan = planModeChange({});
    const text = formatModeResponse(plan, { observer_mode: 'both', guard_mode: 1, extraction_mode: 'lossy' });
    expect(text).toContain('extraction: lossy');
    expect(text).toContain('BUDDY_EXTRACTION_KEY');
  });

  it('omits extraction line when guard is off', () => {
    const plan = planModeChange({});
    const text = formatModeResponse(plan, { observer_mode: 'both', guard_mode: 0, extraction_mode: 'n/a' });
    expect(text).not.toContain('extraction:');
  });

  it('omits extraction line when extraction_mode is not provided (back-compat)', () => {
    const plan = planModeChange({});
    const text = formatModeResponse(plan, { observer_mode: 'both', guard_mode: 1 });
    expect(text).not.toContain('extraction:');
  });

  it('update response includes extraction line when applicable', () => {
    const plan = planModeChange({ guard: true });
    const text = formatModeResponse(plan, { observer_mode: 'both', guard_mode: 1, extraction_mode: 'precise' });
    expect(text).toContain('guard=on');
    expect(text).toContain('extraction: precise');
  });
});
