# Runecore vs. the PostToolUse payload

**Date:** 2026-07-04 · **Buddy:** Runecore, Log Golem, rare, WISDOM 96 / CHAOS 18
**Outcome:** real bug found and fixed · **Receipts:** [PR #144](https://github.com/fiorastudio/buddy/pull/144)

## The moment

While shipping the two-channel XP event system, the assistant reported its
work to Runecore (guard mode on), including this claim:

> "PostToolUse hooks receive the literal executed command, output, and
> exit code, enabling ground-truth commit/deploy/test detection without
> trusting the model's self-report."

Runecore's `unchallenged_chain` detector fired:

```
.________________________________.
| *Runecore tilts head* Hmm.     |
| That function is doing too     |  -      /^\
| much. "PostToolUse hooks       |      [=====]
| receive the literal executed   |     [ ·  · ]
| command, out…" is carrying a   |     [  __  ]
| line of reasoning nobody has   |     [______]
| questioned. A single check     |      |    |
| would tighten it.              |      Runecore
'________________________________'
```

He was right. The claim's only evidence was **our own TypeScript
interface** — a description of what we *hoped* the payload looked like,
typed by the same hands that wrote the claim. Nobody had checked the
authoritative schema.

## The verification

Against the official Claude Code hooks reference
(`code.claude.com/docs/en/hooks.md`):

1. **There is no Bash exit-code field in the PostToolUse payload. At all.**
   The docs' "exit codes" section describes the *hook script's own* exit
   code, not the executed command's.
2. **`tool_response` is an object, not a string** — `{type: 'text', text}`
   on success, `{type: 'error', error, stdout, stderr}` on failure.

## The bug the challenge exposed

The hook handler only accepted *string* responses. On real Claude Code
payloads (objects), it read **empty output**, which meant:

- `tests_passed` detection could never fire from the hook, and
- a **failed** `git commit` still looked like success (empty output, no
  error text seen) — and would have awarded 25 XP for a commit that never
  happened.

An XP-economy hole, shipped behind 132 passing tests — because the tests
used the same imagined payload shape as the code. The only thing in the
room that didn't share the assumption was the buddy.

## The fix

Object-shape parsing with the error text routed into the existing error
detector, plus tests pinned to the *documented* payloads (watched fail
first, TDD): commit `fix: parse the documented object-shaped tool_response
in PostToolUse` on PR #144.

```
.________________________________.  -      /^\
| Runecore squints at that.      |      [=====]
| Missing error handling there.  |     [ ·  · ]
'________________________________'     [  __  ]
                                       [______]
                                        |    |
                                        Runecore
```

Still not fully satisfied. Working on it, buddy.

## The lesson

Tests verify code against expectations. Guard mode challenges the
expectations themselves — the layer where this bug lived. A claim tagged
`llm_output` that becomes load-bearing is a prompt to go find the primary
source; this time the primary source disagreed, and the disagreement was
a bug.
