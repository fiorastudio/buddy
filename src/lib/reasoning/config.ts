// src/lib/reasoning/config.ts
//
// All tunable numbers live here. Pulled out of detector code so buddy's
// maintainer can adjust thresholds without touching algorithm code.
// Starting values chosen conservatively — fewer findings is better than noise.

export const REASONING_CONFIG = {
  // Cold-start gate: no detectors fire until the session has at least this
  // many claims. Kills first-three-turn false positives when the graph is
  // barely populated.
  COLD_START_MIN_CLAIMS: 6,

  // Cap per-session claim count. When exceeded, oldest claims prune.
  MAX_CLAIMS_PER_SESSION: 200,

  // Retention: sessions older than this are pruned on startup.
  SESSION_RETENTION_DAYS: 30,

  // Cooldowns (measured in observe calls, not wall-clock time).
  DARK_COOLDOWN_OBSERVES: 10,
  BRIGHT_COOLDOWN_OBSERVES: 5,

  // Bright bias: if the last N observes had K dark findings and zero bright,
  // next eligible finding must be bright (if one is available).
  BRIGHT_BIAS_WINDOW: 10,
  BRIGHT_BIAS_DARK_THRESHOLD: 3,

  // When both bright and dark fire and neither is cooldown-blocked, weight
  // toward dark (higher information density) but leave room for bright.
  BRIGHT_TIE_BREAK_WEIGHT: 0.4,

  // Detector-specific thresholds.
  LOAD_BEARING_MIN_DOWNSTREAM: 3,
  UNCHALLENGED_CHAIN_MIN_LENGTH: 4,
  ECHO_CHAMBER_MIN_SUPPORTS: 2,
  WELL_SOURCED_MIN_DOWNSTREAM: 3,
  PRODUCTIVE_STRESS_MIN_CHAIN: 3,
  GROUNDED_PREMISE_MIN_SUPPORTS: 2,

  // Claim text cap — matches sanitizeClaim's truncation.
  MAX_CLAIM_TEXT_LENGTH: 240,

  // Recent-claims context injected into the observer prompt so the host can
  // edge into prior-turn claims. Bounded for prompt size.
  RECENT_CLAIMS_CONTEXT: 10,

  // Doctor check: max mode on but zero claims received in the last N observes
  // triggers a "host may not be honoring extraction" warning.
  INERT_MAX_WARN_OBSERVES: 10,

  // Detector latency budget. If detectors exceed this, skip finding injection
  // for this observe (budget measured per-observe, reset each call).
  DETECTOR_BUDGET_MS: 30,

  // Sanitizer iterative-decode depth cap. Handles multiply-encoded HTML
  // entities (`&amp;lt;system&amp;gt;` → `&lt;system&gt;` → `<system>`).
  // Bounded so pathological inputs can't loop forever. Adversarial depth
  // and base64-wrapped entities remain out of scope per sanitize.ts's
  // "structural break prevention" framing.
  SANITIZE_DECODE_MAX_PASSES: 4,
} as const;
