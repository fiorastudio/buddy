# Plan: Guard Mode Signal Rebalance

## Goal

Improve Guard mode so caution nudges surface meaningfully in real usage without becoming noisy. The implementation should address the root issue: extraction and selection currently skew toward supportive graph structures, leaving caution detectors underfed.

## Branch

Work on `feature/guard-mode-signal-rebalance` in `/Users/steven.wu/Documents/buddy`.

## Current Findings

- Live stored data is heavily skewed toward `supports`, with zero `contradicts` edges.
- Only one finding has surfaced in real usage, and it is a kudos finding.
- Current extraction guidance likely under-teaches `questions` and `contradicts`.
- PR `#119`'s hedge detector is too broad as written and risks noisy false positives.

## Implementation

### 1. Improve runtime telemetry for reasoning quality

Add runtime counters in `src/lib/reasoning/telemetry.ts` for:
- detected findings by type (before selection)
- suppressed findings by reason (`no_candidates`, `cooldown`, `budget`)
- rolling edge-type distribution window

This should make it possible to distinguish:
- detectors never firing
- detectors firing but being suppressed
- structurally skewed extraction output

### 2. Add edge-distribution and session trace visibility

Update diagnostics and status surfaces to show:
- whether edge types are overly support-dominant
- whether contradictions are absent in a meaningful sample
- session traceability from stored session IDs back to Claude session/project artifacts

Add a resolver that maps the stored session id format (`<cwd-hash>-<YYYYMMDD>`) back to:
- the cwd hash
- the date bucket
- the resolved Claude `cwd` when discoverable
- a human-readable project label
- the matching Claude session/project file path when discoverable

This should work by scanning nearby Claude metadata such as `~/.claude/sessions/*.json` and `~/.claude/projects/*.jsonl`.

### 3. Refine extraction guidance

Update `src/lib/reasoning/extract-prompt.ts` so the model gets sharper examples for:
- `supports`
- `depends_on`
- `questions`
- `contradicts`

Also add anti-pattern guidance so polite challenge, sanity checks, and narrowing questions are not lazily labeled as `supports`.

### 4. Narrow the hedge detector

Keep `unverified_hedge`, but narrow it to stronger markers only, such as:
- `likely`
- `probably`
- `presumably`
- `most likely`
- optionally `i suspect`

Do not trigger on soft conversational phrases like:
- `i think`
- `i believe`
- `should work`
- `seems like`
- `appears to`
- `i guess`

### 5. Add/adjust tests

Add targeted tests for:
- telemetry edge-distribution health
- suppression visibility behavior
- narrowed hedge detection positives and negatives
- session trace resolution helpers where feasible

## Validation

Run focused tests first, then a broader reasoning-related test pass if needed.

## Notes

- Keep this plan file as the source of truth during implementation.
- If connection drops, resume from this file and inspect current branch diff.
