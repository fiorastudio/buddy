// src/lib/usage.ts — Claude Code usage panel rendered beside the buddy
//
// Everything here is pure: the model is built from already-read data and every
// time-dependent value takes `now` as an argument, so the panel is fully
// deterministic under test. All IO lives in usage-sources.ts / usage-refresh.ts.

import { RESET, DIM, CYAN, GREEN, YELLOW, RED } from "./ansi.js";

export type UsageGauge = {
  /** Short column label: "ctx", "5h", "week". */
  label: string;
  /** 0-100. */
  percent: number;
  /**
   * When the window resets. The two sources disagree on the encoding: stdin
   * sends Unix seconds, the usage API sends an ISO string. Both are accepted.
   */
  resetsAt?: string | number | null;
  /** Trailing annotation, e.g. the token count or an active scoped limit. */
  note?: string;
  /**
   * Length of the window this gauge measures. With `resetsAt` it yields how much
   * of the window is already gone, which the meter marks with a tick.
   */
  windowMs?: number;
};

export type UsageAccount = {
  org?: string;
  /** Local part of the account email — enough to tell two logins apart. */
  user?: string;
};

export type UsageRoute = {
  /** Model name as Claude Code reports it. */
  model: string;
  /** False when the session is answered by a non-Anthropic model (gateway/proxy). */
  firstParty: boolean;
  /** Tidied rate-limit tier, e.g. "max5x". Only meaningful for first-party sessions. */
  plan?: string;
};

export type UsageModel = {
  account?: UsageAccount;
  route?: UsageRoute;
  context?: UsageGauge;
  limits: UsageGauge[];
  /**
   * Age of the rate-limit data in ms. Undefined when it arrived live on stdin;
   * a number when it came from a cache, which the panel marks as stale.
   */
  limitsAgeMs?: number;
};

/** Raw inputs, already parsed. Any of them may be missing. */
export type UsageSources = {
  /** The statusline JSON Claude Code writes to stdin. */
  stdin?: unknown;
  /** ~/.claude.json — holds oauthAccount and Claude Code's own utilization cache. */
  config?: unknown;
  /** buddy's own refresh cache: { fetchedAtMs, utilization }. */
  cache?: unknown;
};

/**
 * Meter width in cells. The percentage is printed after it, not over it, so the
 * bar stays narrow enough that the panel's longest row still fits an 80-column
 * terminal — a wider line gets its left padding eaten and lands under the buddy.
 */
const BAR_CELLS = 10;
const BAR_FILLED = "█";
const BAR_EMPTY = "░";
/** Marks how far into the window we are, so pace can be read off the meter. */
const BAR_TICK = "|";
/** Rate-limit data older than this is shown with a staleness marker. */
export const STALE_AFTER_MS = 10 * 60_000;
/** Window lengths, needed to turn a reset stamp into "how much of it is gone". */
const FIVE_HOUR_MS = 5 * 3600_000;
const SEVEN_DAY_MS = 7 * 86400_000;

const isRecord = (v: unknown): v is Record<string, any> =>
  typeof v === "object" && v !== null;

const clampPercent = (percent: number): number =>
  Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;

const percentColor = (percent: number): string =>
  percent >= 85 ? RED : percent >= 60 ? YELLOW : GREEN;

/**
 * Fixed-width meter. A non-zero percentage always lights at least one cell.
 *
 * `elapsedPercent` marks how far the window itself has run with a tick, so the
 * two can be compared at a glance: fill left of the tick means the budget is
 * lasting, fill past it means it is burning faster than the clock.
 */
export function renderBar(percent: number, elapsedPercent?: number): string {
  const clamped = clampPercent(percent);
  const scaled = Math.round((clamped / 100) * BAR_CELLS);
  const filled = clamped === 0 ? 0 : Math.max(1, scaled);

  const tick = elapsedPercent === undefined
    ? -1
    : Math.min(BAR_CELLS - 1, Math.floor((clampPercent(elapsedPercent) / 100) * BAR_CELLS));

  const color = percentColor(clamped);
  let out = "";
  let open = "";
  for (let cell = 0; cell < BAR_CELLS; cell++) {
    // The tick keeps its own color so it reads as a mark on the bar rather than
    // as part of the fill it sits in.
    const want = cell === tick ? CYAN : cell < filled ? color : DIM;
    if (want !== open) {
      out += (open ? RESET : "") + want;
      open = want;
    }
    out += cell === tick ? BAR_TICK : cell < filled ? BAR_FILLED : BAR_EMPTY;
  }
  return out + (open ? RESET : "");
}

/** 812 → "812", 102178 → "102k", 1_240_000 → "1.2M". */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "0";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(Math.round(tokens));
}

/** Coarse duration: "3h58m", "4d13h", "12m", "<1m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "<1m";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem ? `${hours}h${rem}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days}d${rem}h` : `${days}d`;
}

/** Epoch seconds (stdin) or an ISO string (usage API) → epoch ms; NaN when unusable. */
function toEpochMs(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return NaN;
    // Anything below ~2001 in ms is really a seconds-based timestamp.
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value) return Date.parse(value);
  return NaN;
}

/** Time left in the window, e.g. "3h58m"; empty when unknown or already past. */
function formatReset(resetsAt: string | number | null | undefined, now: number): string {
  const at = toEpochMs(resetsAt);
  if (Number.isNaN(at) || at <= now) return "";
  return formatDuration(at - now);
}

/**
 * How much of the gauge's window has already run, 0-100. Undefined when the
 * window length is unknown (the context gauge) or the reset stamp is unusable —
 * the meter then draws no tick rather than guessing a position.
 */
function elapsedPercent(gauge: UsageGauge, now: number): number | undefined {
  if (!gauge.windowMs) return undefined;
  const at = toEpochMs(gauge.resetsAt);
  if (Number.isNaN(at) || at <= now) return undefined;
  const remaining = Math.min(gauge.windowMs, at - now);
  return ((gauge.windowMs - remaining) / gauge.windowMs) * 100;
}

/** "default_claude_max_5x" → "max5x"; "team_tier_1" → "team1". */
export function tidyTier(tier: unknown): string | undefined {
  if (typeof tier !== "string" || !tier) return undefined;
  const cleaned = tier.replace(/^default_/, "").replace(/^claude_/, "");
  const compact = cleaned.replace(/_tier_/, "").replace(/_/g, "");
  return compact || undefined;
}

type NormalizedLimits = {
  fiveHour?: { percent: number; resetsAt?: string | number | null };
  sevenDay?: { percent: number; resetsAt?: string | number | null };
  /** Model-scoped weekly limit, e.g. the per-model weekly cap. */
  scoped?: { label: string; percent: number };
};

const readWindow = (w: unknown, percentKey: "utilization" | "used_percentage") => {
  if (!isRecord(w)) return undefined;
  const percent = w[percentKey];
  if (typeof percent !== "number") return undefined;
  const resetsAt = w.resets_at;
  return {
    percent,
    resetsAt: typeof resetsAt === "string" || typeof resetsAt === "number" ? resetsAt : null,
  };
};

/**
 * The /api/oauth/usage shape (also cached in ~/.claude.json), where windows
 * carry `utilization` and `limits[]` may hold an active model-scoped cap.
 */
export function normalizeUtilization(util: unknown): NormalizedLimits | undefined {
  if (!isRecord(util)) return undefined;
  const out: NormalizedLimits = {
    fiveHour: readWindow(util.five_hour, "utilization"),
    sevenDay: readWindow(util.seven_day, "utilization"),
  };

  if (Array.isArray(util.limits)) {
    // A model-scoped cap is worth showing even while `is_active` is false: the
    // flag marks which limit is currently binding, not whether the cap exists.
    // Models carrying their own allowance (Fable) report the scoped bucket
    // inactive right up until it becomes the constraint, and hiding it until
    // then leaves the panel silent about the budget actually being spent.
    const candidates = util.limits.filter(
      (l: unknown) => isRecord(l) && l.kind === "weekly_scoped" && typeof l.percent === "number",
    );
    // Still prefer the binding one when several models report a cap.
    const scoped = candidates.find((l: Record<string, any>) => l.is_active === true) ?? candidates[0];
    if (isRecord(scoped)) {
      const model = isRecord(scoped.scope) && isRecord(scoped.scope.model) ? scoped.scope.model.display_name : undefined;
      out.scoped = { label: typeof model === "string" && model ? model : "scoped", percent: scoped.percent };
    }
  }

  if (!out.fiveHour && !out.sevenDay && !out.scoped) return undefined;
  return out;
}

/**
 * The `rate_limits` block Claude Code puts on stdin, where windows carry
 * `used_percentage`. It reports the two plan-wide windows only — model-scoped
 * caps are absent from the payload, so `scoped` is filled in from the cache by
 * `pickLimits` rather than here.
 */
function normalizeStdinLimits(rateLimits: unknown): NormalizedLimits | undefined {
  if (!isRecord(rateLimits)) return undefined;
  const out: NormalizedLimits = {
    fiveHour: readWindow(rateLimits.five_hour, "used_percentage"),
    sevenDay: readWindow(rateLimits.seven_day, "used_percentage"),
  };
  if (!out.fiveHour && !out.sevenDay) return undefined;
  return out;
}

/**
 * Rate-limit precedence: live stdin first, then buddy's own refresh cache, then
 * whatever Claude Code last cached. Cached sources carry their age so the panel
 * can mark them stale.
 */
function pickLimits(sources: UsageSources, now: number): { limits: NormalizedLimits; ageMs?: number } | undefined {
  const stdin = isRecord(sources.stdin) ? sources.stdin : undefined;
  const live = normalizeStdinLimits(stdin?.rate_limits);

  const candidates: Array<{ util: unknown; fetchedAtMs: unknown }> = [];
  if (isRecord(sources.cache)) candidates.push({ util: sources.cache.utilization, fetchedAtMs: sources.cache.fetchedAtMs });
  const configCache = isRecord(sources.config) ? sources.config.cachedUsageUtilization : undefined;
  if (isRecord(configCache)) candidates.push({ util: configCache.utilization, fetchedAtMs: configCache.fetchedAtMs });

  let best: { limits: NormalizedLimits; ageMs: number } | undefined;
  for (const candidate of candidates) {
    const limits = normalizeUtilization(candidate.util);
    if (!limits) continue;
    const fetchedAt = typeof candidate.fetchedAtMs === "number" ? candidate.fetchedAtMs : 0;
    const ageMs = Math.max(0, now - fetchedAt);
    if (!best || ageMs < best.ageMs) best = { limits, ageMs };
  }

  // Live numbers win for the plan-wide windows, but stdin never carries the
  // model-scoped cap, so dropping to stdin alone would hide it exactly in the
  // sessions that report live limits. Graft the cached scoped entry onto the
  // live windows instead; the plan-wide gauges stay live either way.
  if (live) return { limits: { ...live, scoped: best?.limits.scoped } };

  return best;
}

function buildAccount(config: unknown): UsageAccount | undefined {
  const account = isRecord(config) ? config.oauthAccount : undefined;
  if (!isRecord(account)) return undefined;
  const org = typeof account.organizationName === "string" ? account.organizationName : undefined;
  const email = typeof account.emailAddress === "string" ? account.emailAddress : undefined;
  const user = email ? email.split("@")[0] : undefined;
  if (!org && !user) return undefined;
  return { org, user };
}

function buildRoute(stdin: unknown, config: unknown): UsageRoute | undefined {
  const model = isRecord(stdin) ? stdin.model : undefined;
  if (!isRecord(model)) return undefined;
  const id = typeof model.id === "string" ? model.id : "";
  const name = typeof model.display_name === "string" && model.display_name ? model.display_name : id;
  if (!name) return undefined;

  const firstParty = /^claude/i.test(id);
  const account = isRecord(config) ? config.oauthAccount : undefined;
  const plan = isRecord(account) ? tidyTier(account.userRateLimitTier) : undefined;
  return { model: name, firstParty, plan };
}

function buildContext(stdin: unknown): UsageGauge | undefined {
  const cw = isRecord(stdin) ? stdin.context_window : undefined;
  if (!isRecord(cw) || typeof cw.used_percentage !== "number") return undefined;

  const size = typeof cw.context_window_size === "number" ? cw.context_window_size : 0;
  const used = typeof cw.total_input_tokens === "number"
    ? cw.total_input_tokens
    : Math.round((cw.used_percentage / 100) * size);

  return {
    label: "ctx",
    percent: cw.used_percentage,
    note: size ? `${formatTokens(used)}/${formatTokens(size)}` : formatTokens(used),
  };
}

/** Assemble the panel model. Returns null when no source yielded anything to show. */
export function buildUsageModel(sources: UsageSources, now: number): UsageModel | null {
  const model: UsageModel = { limits: [] };

  model.account = buildAccount(sources.config);
  model.route = buildRoute(sources.stdin, sources.config);
  model.context = buildContext(sources.stdin);

  const picked = pickLimits(sources, now);
  if (picked) {
    const { limits, ageMs } = picked;
    if (limits.fiveHour) {
      model.limits.push({
        label: "5h",
        percent: limits.fiveHour.percent,
        resetsAt: limits.fiveHour.resetsAt,
        windowMs: FIVE_HOUR_MS,
      });
    }
    if (limits.sevenDay) {
      model.limits.push({
        label: "week",
        percent: limits.sevenDay.percent,
        resetsAt: limits.sevenDay.resetsAt,
        note: limits.scoped ? `${limits.scoped.label} ${Math.round(limits.scoped.percent)}%` : undefined,
        windowMs: SEVEN_DAY_MS,
      });
    }
    if (ageMs !== undefined) model.limitsAgeMs = ageMs;
  }

  const empty = !model.account && !model.route && !model.context && model.limits.length === 0;
  return empty ? null : model;
}

const LABEL_WIDTH = 4;

function renderGaugeLine(gauge: UsageGauge, now: number, suffix: string): string {
  const label = `${DIM}${gauge.label.padEnd(LABEL_WIDTH)}${RESET}`;
  const clamped = clampPercent(gauge.percent);
  // Right-aligned so the numbers form a column no matter how wide they get.
  const percent = `${percentColor(clamped)}${`${Math.round(clamped)}%`.padStart(4)}${RESET}`;
  const reset = formatReset(gauge.resetsAt, now);
  // Scoped-model annotations trail everything else: they are the least common
  // element, so keeping them last stops the gauge columns from shifting.
  const trailer = [reset, suffix, gauge.note].filter(Boolean).join(" | ");
  const bar = renderBar(gauge.percent, elapsedPercent(gauge, now));
  return `${label} ${bar}  ${percent}${trailer ? `  ${DIM}${trailer}${RESET}` : ""}`;
}

/**
 * Render the panel, at most one line per element. Every line shares the same
 * label column so the block reads as one table:
 *   acct Rebellions-Lime | daekyeong.kim
 *   via  MiniMaxAI/MiniMax-M2.5 (gateway)
 *   ctx  █████░░░░░   51%  102k/200k
 *   5h   █|░░░░░░░░    7%  3h58m
 *   week ███|█░░░░░   47%  4d13h | (5h) | Fable 58%
 *
 * On the timed gauges the `|` marks how much of the window has already run, so
 * fill sitting left of the tick means the budget is outlasting the clock.
 *
 * Trailers are bare on purpose: a countdown to the window reset, then the age
 * of the snapshot in parentheses when it came from a stale cache, then any
 * model-scoped cap.
 */
export function renderUsagePanel(model: UsageModel | null, now: number): string[] {
  if (!model) return [];
  const lines: string[] = [];

  if (model.account) {
    const parts = [model.account.org, model.account.user].filter(Boolean).join(`${RESET}${DIM} | ${RESET}${CYAN}`);
    lines.push(`${DIM}${"acct".padEnd(LABEL_WIDTH)}${RESET} ${CYAN}${parts}${RESET}`);
  }

  if (model.route) {
    const tag = model.route.firstParty
      ? (model.route.plan ? ` | ${model.route.plan}` : "")
      : " (gateway)";
    lines.push(`${DIM}${"via".padEnd(LABEL_WIDTH)} ${model.route.model}${tag}${RESET}`);
  }

  if (model.context) lines.push(renderGaugeLine(model.context, now, ""));

  // Age of a cached snapshot, parenthesized so it cannot be mistaken for the
  // reset countdown sitting next to it.
  const stale = model.limitsAgeMs !== undefined && model.limitsAgeMs >= STALE_AFTER_MS
    ? `(${formatDuration(model.limitsAgeMs)})`
    : "";
  model.limits.forEach((gauge, i) => {
    // The staleness marker rides the last cached gauge instead of taking its own line.
    lines.push(renderGaugeLine(gauge, now, i === model.limits.length - 1 ? stale : ""));
  });

  return lines;
}
