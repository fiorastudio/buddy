import { describe, it, expect } from 'vitest';
import {
  buildUsageModel,
  renderUsagePanel,
  renderBar,
  formatTokens,
  formatDuration,
  normalizeUtilization,
  tidyTier,
  STALE_AFTER_MS,
} from '../lib/usage.js';
import { decideRefresh, readTimestamp, USAGE_CACHE_TTL_MS, REFRESH_LOCK_TTL_MS } from '../lib/usage-sources.js';
import { pickToken, fetchEnabled, FETCH_ENV_FLAG } from '../lib/usage-refresh.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const NOW = Date.parse('2026-08-12T13:00:00Z');

const STDIN = {
  model: { id: 'claude-opus-5', display_name: 'Opus 5' },
  context_window: {
    total_input_tokens: 102178,
    context_window_size: 200000,
    used_percentage: 51,
    remaining_percentage: 49,
  },
};

const CONFIG = {
  oauthAccount: {
    emailAddress: 'daekyeong.kim@rebellions.ai',
    organizationName: 'Rebellions-Lime',
    seatTier: 'team_tier_1',
    userRateLimitTier: 'default_claude_max_5x',
  },
};

const UTILIZATION = {
  five_hour: { utilization: 7, resets_at: '2026-08-12T17:30:00Z' },
  seven_day: { utilization: 47, resets_at: '2026-08-17T03:00:00Z' },
  limits: [
    { kind: 'session', percent: 0, is_active: false, resets_at: null },
    { kind: 'weekly_all', percent: 47, is_active: false, resets_at: '2026-08-17T03:00:00Z' },
    {
      kind: 'weekly_scoped',
      percent: 58,
      is_active: true,
      resets_at: '2026-08-17T03:00:00Z',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
    },
  ],
};

describe('usage — formatting primitives', () => {
  it('fills the meter in proportion to the percentage', () => {
    expect(strip(renderBar(0))).toBe('░'.repeat(10));
    expect(strip(renderBar(50))).toBe('█'.repeat(5) + '░'.repeat(5));
    expect(strip(renderBar(100))).toBe('█'.repeat(10));
  });

  it('lights at least one cell for any non-zero percentage', () => {
    expect(strip(renderBar(1))).toBe('█' + '░'.repeat(9));
    expect(strip(renderBar(4))).toBe('█' + '░'.repeat(9));
  });

  it('clamps out-of-range percentages instead of overflowing the meter', () => {
    expect(strip(renderBar(-20))).toBe('░'.repeat(10));
    expect(strip(renderBar(150))).toBe('█'.repeat(10));
  });

  it('marks how far the window has run with a tick', () => {
    expect(strip(renderBar(0, 0))).toBe('|' + '░'.repeat(9));
    expect(strip(renderBar(50, 50))).toBe('█'.repeat(5) + '|' + '░'.repeat(4));
    // Fill left of the tick: the budget is outlasting the clock.
    expect(strip(renderBar(20, 50))).toBe('█'.repeat(2) + '░'.repeat(3) + '|' + '░'.repeat(4));
    // Fill past the tick: burning faster than the window resets.
    expect(strip(renderBar(80, 20))).toBe('█'.repeat(2) + '|' + '█'.repeat(5) + '░'.repeat(2));
  });

  it('keeps the tick inside the meter at the end of a window', () => {
    expect(strip(renderBar(100, 100))).toBe('█'.repeat(9) + '|');
    expect(strip(renderBar(50, 130))).toBe('█'.repeat(5) + '░'.repeat(4) + '|');
  });

  it('draws no tick when the window length is unknown', () => {
    expect(strip(renderBar(51))).not.toContain('|');
  });

  it('keeps every meter the same visible width', () => {
    for (const pct of [0, 1, 7, 33, 51, 99, 100]) {
      expect(strip(renderBar(pct))).toHaveLength(10);
      expect(strip(renderBar(pct, pct))).toHaveLength(10);
    }
  });

  it('abbreviates token counts', () => {
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(102178)).toBe('102k');
    expect(formatTokens(200000)).toBe('200k');
    expect(formatTokens(1_240_000)).toBe('1.2M');
    expect(formatTokens(-5)).toBe('0');
  });

  it('formats durations coarsely', () => {
    expect(formatDuration(30_000)).toBe('<1m');
    expect(formatDuration(12 * 60_000)).toBe('12m');
    expect(formatDuration(3 * 3600_000 + 58 * 60_000)).toBe('3h58m');
    expect(formatDuration(5 * 3600_000)).toBe('5h');
    expect(formatDuration(4 * 86400_000 + 13 * 3600_000)).toBe('4d13h');
    expect(formatDuration(2 * 86400_000)).toBe('2d');
  });

  it('tidies rate-limit tier names', () => {
    expect(tidyTier('default_claude_max_5x')).toBe('max5x');
    expect(tidyTier('team_tier_1')).toBe('team1');
    expect(tidyTier(undefined)).toBeUndefined();
    expect(tidyTier('')).toBeUndefined();
  });
});

describe('usage — utilization normalization', () => {
  it('reads both windows and the active scoped limit', () => {
    const limits = normalizeUtilization(UTILIZATION);
    expect(limits?.fiveHour).toEqual({ percent: 7, resetsAt: '2026-08-12T17:30:00Z' });
    expect(limits?.sevenDay?.percent).toBe(47);
    expect(limits?.scoped).toEqual({ label: 'Fable', percent: 58 });
  });

  it('keeps scoped limits that are not yet binding', () => {
    const limits = normalizeUtilization({
      ...UTILIZATION,
      limits: [{ kind: 'weekly_scoped', percent: 58, is_active: false, scope: { model: { display_name: 'Fable' } } }],
    });
    expect(limits?.scoped).toEqual({ label: 'Fable', percent: 58 });
  });

  it('prefers the binding scoped limit when several are reported', () => {
    const limits = normalizeUtilization({
      ...UTILIZATION,
      limits: [
        { kind: 'weekly_scoped', percent: 12, is_active: false, scope: { model: { display_name: 'Fable' } } },
        { kind: 'weekly_scoped', percent: 91, is_active: true, scope: { model: { display_name: 'Opus' } } },
      ],
    });
    expect(limits?.scoped).toEqual({ label: 'Opus', percent: 91 });
  });

  it('returns undefined for junk or empty payloads', () => {
    expect(normalizeUtilization(undefined)).toBeUndefined();
    expect(normalizeUtilization('nope')).toBeUndefined();
    expect(normalizeUtilization({ five_hour: null, seven_day: null })).toBeUndefined();
  });
});

describe('usage — model assembly', () => {
  it('returns null when no source has anything to show', () => {
    expect(buildUsageModel({}, NOW)).toBeNull();
  });

  it('builds account, route and context from stdin plus config', () => {
    const model = buildUsageModel({ stdin: STDIN, config: CONFIG }, NOW);
    expect(model?.account).toEqual({ org: 'Rebellions-Lime', user: 'daekyeong.kim' });
    expect(model?.route).toEqual({ model: 'Opus 5', firstParty: true, plan: 'max5x' });
    expect(model?.context?.percent).toBe(51);
    expect(model?.context?.note).toBe('102k/200k');
  });

  it('marks a non-Anthropic model id as not first-party', () => {
    const stdin = { ...STDIN, model: { id: 'MiniMaxAI/MiniMax-M2.5', display_name: 'MiniMaxAI/MiniMax-M2.5' } };
    expect(buildUsageModel({ stdin, config: CONFIG }, NOW)?.route?.firstParty).toBe(false);
  });

  it('derives context tokens from the percentage when the token count is absent', () => {
    const stdin = { context_window: { context_window_size: 200000, used_percentage: 25 } };
    expect(buildUsageModel({ stdin }, NOW)?.context?.note).toBe('50k/200k');
  });

  it('prefers live stdin rate limits and reports no age', () => {
    const stdin = {
      ...STDIN,
      rate_limits: {
        five_hour: { used_percentage: 12, resets_at: '2026-08-12T17:30:00Z' },
        seven_day: { used_percentage: 44, resets_at: '2026-08-17T03:00:00Z' },
      },
    };
    const model = buildUsageModel({ stdin, config: { ...CONFIG, cachedUsageUtilization: { fetchedAtMs: NOW - 60_000, utilization: UTILIZATION } } }, NOW);
    expect(model?.limits.map((l) => [l.label, l.percent])).toEqual([['5h', 12], ['week', 44]]);
    expect(model?.limitsAgeMs).toBeUndefined();
  });

  it('keeps the cached model-scoped cap when stdin supplies the live windows', () => {
    const stdin = {
      ...STDIN,
      rate_limits: {
        five_hour: { used_percentage: 12, resets_at: '2026-08-12T17:30:00Z' },
        seven_day: { used_percentage: 44, resets_at: '2026-08-17T03:00:00Z' },
      },
    };
    // stdin carries the plan-wide windows only, so the scoped cap has to come
    // from the cache or it disappears in exactly these sessions.
    const model = buildUsageModel({ stdin, cache: { fetchedAtMs: NOW - 30_000, utilization: UTILIZATION } }, NOW);
    const week = model?.limits.find((l) => l.label === 'week');
    expect(week?.percent).toBe(44);
    expect(week?.note).toBe('Fable 58%');
    expect(model?.limitsAgeMs).toBeUndefined();
  });

  it('falls back to the freshest cache and records its age', () => {
    const model = buildUsageModel(
      {
        stdin: STDIN,
        config: { ...CONFIG, cachedUsageUtilization: { fetchedAtMs: NOW - 6 * 3600_000, utilization: { ...UTILIZATION, seven_day: { utilization: 39, resets_at: null } } } },
        cache: { fetchedAtMs: NOW - 30_000, utilization: UTILIZATION },
      },
      NOW,
    );
    expect(model?.limits.find((l) => l.label === 'week')?.percent).toBe(47);
    expect(model?.limitsAgeMs).toBe(30_000);
  });

  it('uses Claude Code’s own cache when buddy has never refreshed', () => {
    const model = buildUsageModel(
      { stdin: STDIN, config: { ...CONFIG, cachedUsageUtilization: { fetchedAtMs: NOW - 45_000, utilization: UTILIZATION } } },
      NOW,
    );
    expect(model?.limits).toHaveLength(2);
    expect(model?.limitsAgeMs).toBe(45_000);
  });

  it('attaches an active scoped limit to the weekly gauge', () => {
    const model = buildUsageModel({ stdin: STDIN, cache: { fetchedAtMs: NOW, utilization: UTILIZATION } }, NOW);
    expect(model?.limits.find((l) => l.label === 'week')?.note).toBe('Fable 58%');
  });
});

describe('usage — panel rendering', () => {
  const model = buildUsageModel({ stdin: STDIN, config: CONFIG, cache: { fetchedAtMs: NOW, utilization: UTILIZATION } }, NOW);
  const lines = renderUsagePanel(model, NOW).map(strip);

  it('renders one line per element, in a stable order', () => {
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('acct Rebellions-Lime | daekyeong.kim');
    expect(lines[1]).toBe('via  Opus 5 | max5x');
    expect(lines[2]).toBe('ctx  █████░░░░░   51%  102k/200k');
    expect(lines[3]).toBe('5h   █|░░░░░░░░    7%  4h30m');
    expect(lines[4]).toBe('week ███|█░░░░░   47%  4d14h | Fable 58%');
  });

  it('ticks each window at its own elapsed fraction', () => {
    // 30m into a 5h window, 2d10h into a 7d one.
    expect(lines[3].indexOf('|')).toBe(6);
    expect(lines[4].indexOf('|')).toBe(8);
  });

  it('leaves the context gauge untickable — it has no window to run out', () => {
    expect(lines[2]).not.toContain('|');
  });

  it('tags a gateway session on the route line', () => {
    const gateway = buildUsageModel({ stdin: { ...STDIN, model: { id: 'MiniMaxAI/MiniMax-M2.5', display_name: 'MiniMaxAI/MiniMax-M2.5' } }, config: CONFIG }, NOW);
    expect(strip(renderUsagePanel(gateway, NOW)[1])).toBe('via  MiniMaxAI/MiniMax-M2.5 (gateway)');
  });

  it('marks stale rate limits on the last gauge only', () => {
    const stale = buildUsageModel({ stdin: STDIN, config: CONFIG, cache: { fetchedAtMs: NOW - STALE_AFTER_MS, utilization: UTILIZATION } }, NOW);
    const out = renderUsagePanel(stale, NOW).map(strip);
    expect(out[3]).toBe('5h   █|░░░░░░░░    7%  4h30m');
    expect(out[4]).toBe('week ███|█░░░░░   47%  4d14h | (10m) | Fable 58%');
  });

  it('omits the staleness marker while the cache is still fresh', () => {
    expect(lines.join('\n')).not.toContain('(');
  });

  it('reads the Unix-seconds reset stamps that stdin sends', () => {
    // Claude Code sends epoch seconds here; the usage API sends ISO strings.
    const stdin = {
      ...STDIN,
      rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.floor(NOW / 1000) + 3 * 3600 } },
    };
    expect(strip(renderUsagePanel(buildUsageModel({ stdin }, NOW), NOW).at(-1)!)).toBe('5h   █░░░|░░░░░    5%  3h');
  });

  it('drops reset hints for windows that have already reset', () => {
    const past = buildUsageModel(
      { stdin: STDIN, cache: { fetchedAtMs: NOW, utilization: { five_hour: { utilization: 7, resets_at: '2026-08-12T12:00:00Z' } } } },
      NOW,
    );
    expect(strip(renderUsagePanel(past, NOW).at(-1)!)).toBe('5h   █░░░░░░░░░    7%');
  });

  it('renders nothing for a null model', () => {
    expect(renderUsagePanel(null, NOW)).toEqual([]);
  });

  it('keeps the label column aligned across every line', () => {
    for (const line of lines) {
      expect(line.slice(0, 5)).toMatch(/^[a-z0-9]+ +$/);
    }
  });
});

describe('usage — refresh policy', () => {
  const base = { enabled: true, now: NOW };

  it('never refreshes when the opt-in is off', () => {
    expect(decideRefresh({ ...base, enabled: false })).toBe('disabled');
  });

  it('skips while another refresh is in flight', () => {
    expect(decideRefresh({ ...base, lockStartedAtMs: NOW - (REFRESH_LOCK_TTL_MS - 1) })).toBe('in-flight');
  });

  it('refreshes again once a stuck lock has aged out', () => {
    expect(decideRefresh({ ...base, lockStartedAtMs: NOW - REFRESH_LOCK_TTL_MS })).toBe('refresh');
  });

  it('skips while the cache is inside its TTL, refreshes after', () => {
    expect(decideRefresh({ ...base, cacheFetchedAtMs: NOW - (USAGE_CACHE_TTL_MS - 1) })).toBe('fresh');
    expect(decideRefresh({ ...base, cacheFetchedAtMs: NOW - USAGE_CACHE_TTL_MS })).toBe('refresh');
  });

  it('refreshes when there is no cache at all', () => {
    expect(decideRefresh(base)).toBe('refresh');
  });

  it('reads timestamps defensively', () => {
    expect(readTimestamp({ fetchedAtMs: 42 }, 'fetchedAtMs')).toBe(42);
    expect(readTimestamp({ fetchedAtMs: 'soon' }, 'fetchedAtMs')).toBeUndefined();
    expect(readTimestamp(undefined, 'fetchedAtMs')).toBeUndefined();
  });

  it('fetches by default and only stops when explicitly switched off', () => {
    expect(fetchEnabled({})).toBe(true);
    expect(fetchEnabled({ [FETCH_ENV_FLAG]: '1' })).toBe(true);
    expect(fetchEnabled({ [FETCH_ENV_FLAG]: '0' })).toBe(false);
  });
});

describe('usage — credential selection', () => {
  it('takes a valid access token', () => {
    expect(pickToken({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW + 3600_000 } }, NOW)).toBe('tok');
  });

  it('accepts a token with no stated expiry', () => {
    expect(pickToken({ claudeAiOauth: { accessToken: 'tok' } }, NOW)).toBe('tok');
  });

  it('refuses an expired or nearly expired token instead of spending a 401', () => {
    expect(pickToken({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW - 1 } }, NOW)).toBeUndefined();
    expect(pickToken({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW + 10_000 } }, NOW)).toBeUndefined();
  });

  it('ignores credentials that are missing, malformed, or for other services', () => {
    expect(pickToken(undefined, NOW)).toBeUndefined();
    expect(pickToken({ mcpOAuth: { something: { accessToken: 'tok' } } }, NOW)).toBeUndefined();
    expect(pickToken({ claudeAiOauth: { accessToken: '' } }, NOW)).toBeUndefined();
  });
});
