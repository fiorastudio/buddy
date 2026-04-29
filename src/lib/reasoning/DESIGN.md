# Reasoning Layer — Design Notes

This folder contains buddy's guard-mode reasoning layer: a light port of
[slimemold](https://github.com/justinstimatze/slimemold) that gives buddy
the ability to notice structural patterns in a coding conversation —
load-bearing assumptions, unchallenged chains, grounded premises — and
surface them in character through the pet personality.

This document explains the design decisions the code itself doesn't
obviously justify. Read it before changing algorithms, prompts, or
thresholds.

## Core principle: sycophancy as a tool

Guard mode is built on a deliberate inversion of LLM sycophancy.

Sycophancy works on users because warmth feels validating. It's a failure
mode because the warmth isn't tied to truth — "great question!" validates
no matter what the question was. Guard mode takes the same linguistic warmth
and points it at structural reasoning facts. The pet is warm (that's
buddy's default state, carried by the species voice + NEVER constraints
ported from effigy-lite) and in guard mode that warmth lands on concrete
observations about the reasoning graph:

- "That 'we need auth' assumption is holding up three things — worth
  pinning down" is warmth pointed at a real structural fact (a high-
  downstream node with `basis=vibes`).
- "Three things rest on '…' — and you've got it sourced" is warmth
  pointed at a real strength (same structure, `basis=research`).

Users engage with rigor because it feels the way validation feels.

Break this principle and guard mode becomes either a scold (warmth → critique,
bad) or sycophancy (warmth → nothing, bad). Every prompt, threshold, and
template phrasing decision in this folder should reinforce the principle:
**warmth must be about something real, phrased gain-framed, filtered through
the pet's species voice, never labeling the mechanism.**

## Why host-does-extraction

Slimemold's extractor is a Claude API call — it costs money, requires an
API key, adds latency, and couples buddy to an external service.

Buddy's observer prompt is executed by the host (Claude Code, Codex,
Cursor, etc.). The host already has the conversation in context. So
instead of buddy calling Claude to extract claims, buddy asks the host
model to emit claims + edges as part of its NEXT observe call. See
`extract-prompt.ts`.

Consequences:

- Buddy has **zero outbound dependencies**. No API key, no network, no
  billing surface.
- There's a **one-turn lag**: claims describe the turn that just ended,
  detectors run on claims from all prior turns. Fine — detectors need
  graph depth anyway, and cold-start gating covers the early frames.
- Extraction quality floats with the host. A Claude host will do this
  well. Other hosts may need the doctor check for inert guard mode to
  alert users (see `checkReasoningGuardMode` in `doctor.ts`).

## Why three caution + three kudos (and not the full eight)

Slimemold ships eight detectors. Guard mode runs six. The omissions:

- **Coverage imbalance** — needs a notion of "foundational importance"
  that's fuzzy on a small graph.
- **Abandoned topic** — needs session continuity and topic modeling
  beyond what a claim graph provides.
- **Bottleneck (betweenness centrality)** — noisy on small graphs;
  unreliable when the session hasn't had many claims.
- **Premature closure / fluency trap** — need linguistic pattern
  detection and confidence calibration, neither of which the host-
  extracted claim schema carries cleanly.

The six we ship are the ones that (a) work on sparse/noisy graphs,
(b) map cleanly to reactions buddy already has, (c) are pure graph/
count operations. The kudos three exist because slimemold is deficit-
only (confirmed by its README) and buddy's edge over slimemold is
*symmetric* noticing — celebrating rigor is the other half of the
sycophancy-as-tool inversion.

## Schema and storage

Three tables, all additive (see `schema.ts`):

- `reasoning_claims` — one row per claim, keyed by UUID, indexed by
  session_id + created_at for fast graph loads.
- `reasoning_edges` — one row per edge, denormalized references to
  claim UUIDs. Indexed by session_id and endpoint.
- `reasoning_findings_log` — append-only log of findings surfaced,
  used for cooldown and kudos-bias calculations.

Plus `reasoning_observe_seq` — per-companion observe counter so cooldown
windows can be measured in observes, not wall-clock time, and one more
column (`guard_mode`) on the existing `companions` table.

### Why no `findings` storage table

Findings are a *derived view* of the graph — computed per observe, not
persisted. The log exists only for cooldown bookkeeping. This keeps
buddy.db thin and means schema changes to detectors don't require
migrations.

### Session namespacing

Sessions are keyed by `sha256(cwd).slice(0,16) + "-" + YYYYMMDD` (UTC).
So: same workspace + same day = same graph. Cross-midnight gets a fresh
graph. Cross-project gets fresh isolation automatically.

Retention: sessions older than 30 days prune on server startup. Users
can force-purge via `buddy_forget`.

## Finding surfacing

Selection is strict: **one finding maximum per observe**, in character.
Priority rules live in `findings.ts`:

1. Drop candidates on per-anchor cooldown (different windows for caution
   vs kudos — kudos is less annoying if repeated, so shorter window).
2. If the recent window has ≥ KUDOS_BIAS_CAUTION_THRESHOLD caution findings
   and zero kudos, kudos wins this round (avoid turning guard mode into
   a structural scold).
3. Otherwise, tie-break with caution weighted slightly heavier than kudos.
4. Never fabricate a finding to fill silence. If no detector fires (or
   the graph is below cold-start size, or the budget is exceeded), the
   observer prompt runs with no finding injection and buddy reacts to
   the summary normally.

### Mandatory surfacing in character

When a finding is selected, it is **injected into the observer prompt
unconditionally** via `buildObserverPrompt(companion, mode, summary,
guardInjection)`. The prompt explicitly instructs the host:

> Work this observation into your reaction. Phrasing is yours; landing
> the point is required.

This is the counterpoint to the "tone is carried by the species voice"
point above. Character shapes *how* the finding is phrased; guard mode
decides *that* it is phrased.

The `NEVER name the mechanism` line in the prompt is what keeps the
output in-character rather than exposing the machinery. The pet notices
things. It doesn't run detectors.

### Template fallback

When no LLM is in the loop (the `templateFallback` path used by buddy's
statusline and the MCP response JSON), we fall back to deterministic
phrasings in `phrasings.ts`. Each finding type has entries per reaction
state; we pick by summary length (same determinism as the base
`templateReaction`) and splice the finding phrasing into the end of the
base reaction.

## Failure handling: strictly additive

Guard mode is **never allowed to break observe**. The server's `buddy_observe`
handler wraps the entire guard-mode pipeline in a try/catch and falls
through to a normal (finding-less) reaction on any failure. Specific
failure modes:

- Malformed `claims`/`edges` input → writer drops the bad entries,
  returns success for the rest.
- SQLite locked or disk error → writer swallows the failure; the
  observe still returns a reaction.
- Detector throws (cycles, unexpected shapes) → caught before finding
  selection.
- Detector budget exceeded (>30 ms) → finding is skipped for this
  observe; graph is still persisted.

Observe's contract stays "always returns a reaction." Guard mode can only
*add* a finding; it cannot take a reaction away.

## Telemetry

`telemetry.ts` keeps in-process counters (no persistence, resets on
restart). Read by `buddy_reasoning_status` and the doctor check for
inert guard mode. Counters track observe rate, claim receipt rate, write
vs drop split, finding rate by type, and detector latency distribution.
If claims received is zero after 10 observes with guard on, the doctor
warns that the host may not be honoring the extraction prompt.

## Privacy

Claims are plaintext snippets (≤240 chars each after sanitization),
stored locally in `~/.buddy/buddy.db`. They never leave the user's
machine — buddy has no network code. Purge via `buddy_forget`, scope
`session` (current workspace+day) or `all` (everything).

The sanitizer in `sanitize.ts` strips structural prompt-injection
vectors (triple backticks, role markers like `Human:` and `<|im_start|>`,
unicode control chars) before storage. It is not adversarial-robust —
the goal is to prevent structural prompt breaks, not defeat a motivated
attacker who controls the host.

## Tuning thresholds after real usage

All threshold numbers live in `config.ts` (not scattered through detector
code). To tune after seeing real user data:

1. Turn guard mode on in a few workspaces and let it accumulate claims
   naturally over a week.
2. Point `buddy_doctor` and `buddy_reasoning_status` at those installs —
   the counters `findings_surfaced_total`, `findings_by_type`, and the
   claim/finding ratio tell you which detectors are firing too often,
   too rarely, or not at all.
3. If a detector fires more than every 2-3 observes on average, its
   threshold is too loose — raise `*_MIN_DOWNSTREAM` or `*_MIN_LENGTH`
   by one. If it never fires, lower it by one.
4. `KUDOS_BIAS_CAUTION_THRESHOLD` and `KUDOS_TIE_BREAK_WEIGHT` control
   the caution/kudos ratio. If users complain guard mode is a scold, raise
   the weight or lower the bias threshold. If kudos findings feel
   like empty pats-on-the-head, inverse.
5. `COLD_START_MIN_CLAIMS` is the single biggest false-positive lever.
   Raise it to 8 or 10 if early-session findings feel premature. Don't
   lower it below 6.

No formal eval harness is shipped. The integration test fixtures in
`src/__tests__/reasoning/` are the closest thing — keep them in sync
with threshold changes so regressions surface.

## What v1 closes

The earlier draft of this file named six "known limitations." Most are
closed in v1. What follows is the current state.

### Closed

1. **Workspace isolation.** `resolveProjectRoot` in `project-root.ts`
   picks the workspace from (a) an absolute-path hint passed by the
   caller, (b) recognized env vars (`CLAUDE_PROJECT_DIR`,
   `BUDDY_PROJECT_ROOT`, `VSCODE_CWD`, `WORKSPACE_FOLDER`, `PROJECT_ROOT`,
   `INIT_CWD`), (c) walking up from `process.cwd()` looking for project
   markers (`.git`, `package.json`, `pyproject.toml`, `Cargo.toml`,
   `go.mod`, `pom.xml`, `Gemfile`, `composer.json`, `mix.exs`,
   `pubspec.yaml`, `buddy.config.json`), (d) `process.cwd()` only as a
   last resort. Telemetry records which source won. The doctor warns
   when >50% of this run's observes resolved to the user's `$HOME`
   (signaling every project collapsed into one graph). The observe
   response surfaces the resolved workspace path + source, so callers
   can audit.

2. **Graph-rebuild-each-observe.** `graph-cache.ts` caches the
   `SessionGraph` per session. `writeClaims` calls `bumpGeneration` on
   any successful write; the cache returns the fresh version when the
   generation changes, same-instance otherwise. Bounded LRU at 32
   entries.

3. **Mechanism-leak / tone enforcement (in buddy's own output).**
   `scrubReactionText` in `scrub.ts` runs on every `templateFallback`
   before it leaves buddy. It rewrites mechanism vocabulary ("the
   graph" → "the reasoning", "I detected" → "I noticed", "[guard mode]"
   → "", etc.) and softens scold patterns ("you're wrong" →
   "there's another angle", "you made an error" → "worth another
   look"). The review-time `phrasings-tone` test still catches the
   90% case at PR; `scrubReactionText` catches the 10% where a
   dynamically generated string slips past.

4. **HTML-escaped prompt-injection vector.** `sanitizeClaim` now
   decodes HTML entities (`&lt;`, `&gt;`, `&#x3c;`, `&quot;`, …)
   before running the structural-break strips, so
   `&lt;system&gt;payload&lt;/system&gt;` is caught the same as
   `<system>payload</system>`.

5. **Extraction-quality monitoring.** `telemetry.ts` tracks a rolling
   50-claim basis window. `basisDistributionHealth()` flags "degenerate"
   when one basis exceeds 80% of the window (≥20 sample). The doctor
   surfaces this as `reasoning.quality` — if the host is classifying
   every claim as "definition" (or any other single basis), the user
   sees a warning suggesting a more capable host.

### Remaining

6. **Adversarial prompt-injection (full homoglyph / base64).** The
   sanitizer covers structural breaks plus Greek/Cyrillic/Armenian/
   full-width role-marker lookalikes, HTML-entity encoding, and a
   generic `<|...|>` chat-template fallback. It does NOT decode
   base64-encoded role markers, catch every unicode confusable, or
   guard against a motivated attacker who controls the host. That
   would require a full homoglyph normalizer + steganographic payload
   detection, which is out of scope. Buddy's threat model is "make
   sure an accidentally- or lazily-formatted claim can't restructure
   a downstream prompt," not "defeat dedicated adversaries."

7. **Mechanism leak in the HOST's response.** `scrubReactionText`
   cleans templateFallback (what buddy emits directly), but the host
   LLM's reaction — run through the host's own transport — is never
   seen by buddy. A host that ignores the "never name the mechanism"
   instruction can still leak "I detected…" into the user's screen.
   The only fix would be for buddy to intercept the host's response,
   which isn't how MCP works. The doctor's `reasoning.quality` check
   indirectly catches instruction-ignoring hosts via basis
   distribution.

## Licensing note

## Licensing note

This folder is ported from standalone slimemold (Apache-2.0) by the
original author and contributed here under MIT. The port diverges from
standalone slimemold in these respects:

- Host-does-extraction (slimemold calls Claude directly).
- Six detectors instead of eight (coverage, bottleneck, fluency, closure
  omitted).
- Kudos patterns (three positive detectors slimemold doesn't have).
- Mandatory in-character surfacing via effigy-lite's voice/NEVER
  primitives.

Do not expect this folder to stay in lockstep with standalone slimemold.
Standalone slimemold is the canonical project for users who need the
full reasoning-analysis tool.
