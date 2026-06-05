#!/usr/bin/env node
// src/hooks/prompt-handler.ts
//
// UserPromptSubmit hook handler for Buddy MCP.
// Fires before Claude processes the user's message.
// Detects buddy-name mentions and mood signals; writes a statusline reaction.
// Zero token cost — purely pattern-matching and file I/O.
//
// Pure Node.js — only fs imports.

import { readFileSync, writeFileSync } from "fs";
import { BUDDY_STATUS_PATH } from "../lib/constants.js";

export const FRUSTRATION_REGEX =
  /\b(?:wtf|ugh+|argh+|grr+|not working|doesn['']t work|still broken|why (?:is|won['']t|doesn['']t)|this is (?:so |still )?broken|i['']m stuck|stuck on this|can['']t figure|so frustrated)\b/i;

export const EXCITEMENT_REGEX =
  /\b(?:awesome|nailed it|love it|works?!|(?:it['']?s? )?working!|finally!|hell yeah|let['']s (?:go|ship)|shipped it|we did it)(?!\w)/i;

const FRUSTRATION_REACTIONS = [
  "hey, let's figure this out together",
  "ugh, debugging again... I'm here",
  "something's being tricky. let's get it",
  "don't worry, we'll crack it",
];

const EXCITEMENT_REACTIONS = [
  "yes!! great energy",
  "that's the good stuff!",
  "love when things click",
  "let's keep that momentum",
];

const NAME_REACTIONS = [
  "you called~?",
  "hm? oh hi!",
  "yeah?",
  "present!",
  "listening...",
];

export interface PromptInput {
  session_id?: string;
  // Host working directory (Claude Code includes this in the hook payload);
  // used to scope re-injection lapse tracking to the current project session.
  cwd?: string;
  // Claude Code may use any of these field names across versions.
  prompt?: string;
  message?: string;
  user_message?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeReaction(
  statusPath: string,
  reaction: string,
  text: string,
  eye: string,
  indicator: string,
  expiryMs: number
): boolean {
  try {
    const raw = readFileSync(statusPath, "utf-8");
    const status = JSON.parse(raw);
    if (!status?.name) return false;

    // Single-pass race protection.
    if (status.reaction_expires && status.reaction_expires > Date.now()) return false;

    status.reaction = reaction;
    status.reaction_text = text;
    status.reaction_expires = Date.now() + expiryMs;
    status.reaction_eye = eye;
    status.reaction_indicator = indicator;

    writeFileSync(statusPath, JSON.stringify(status));
    return true;
  } catch {
    return false;
  }
}

export function handlePromptSubmit(
  input: PromptInput,
  statusPath: string = BUDDY_STATUS_PATH
): "name" | "frustration" | "excitement" | false {
  const prompt = (input.prompt ?? input.message ?? input.user_message ?? "").trim();
  if (!prompt) return false;

  let buddyName: string | undefined;
  try {
    buddyName = JSON.parse(readFileSync(statusPath, "utf-8"))?.name;
  } catch { /* status file may not exist yet */ }

  // Name mention — highest priority, very short TTL so it doesn't linger.
  if (buddyName) {
    const nameRe = new RegExp(`\\b${escapeRegex(buddyName)}\\b`, "i");
    if (nameRe.test(prompt)) {
      const text = NAME_REACTIONS[Math.floor(Date.now() / 1000) % NAME_REACTIONS.length];
      writeReaction(statusPath, "excited", text, "^", "!", 8_000);
      return "name";
    }
  }

  if (FRUSTRATION_REGEX.test(prompt)) {
    const text = FRUSTRATION_REACTIONS[Math.floor(Date.now() / 1000) % FRUSTRATION_REACTIONS.length];
    writeReaction(statusPath, "concerned", text, ".", "~", 12_000);
    return "frustration";
  }

  if (EXCITEMENT_REGEX.test(prompt)) {
    const text = EXCITEMENT_REACTIONS[Math.floor(Date.now() / 1000) % EXCITEMENT_REACTIONS.length];
    writeReaction(statusPath, "happy", text, "^", "!", 10_000);
    return "excitement";
  }

  return false;
}

// ─── extraction-instruction re-injection (guard-mode only) ──────────────────

/**
 * Re-inject the guard-mode extraction instruction into prompt context when the
 * host has stopped sending claims.
 *
 * The instruction normally rides home in the buddy_observe *response*. But if
 * the host stops calling buddy_observe (the graph goes silent past ~100k tokens
 * of context), it also stops receiving that reminder — a self-reinforcing lapse
 * with no recovery path. This hook fires on every UserPromptSubmit, so it can
 * break the spiral: once silent for REASONING_CONFIG.REINJECT_AFTER_SILENT_TURNS
 * turns it writes the instruction to stdout. For a SYNCHRONOUS UserPromptSubmit
 * hook (exit 0) Claude Code folds that stdout into the turn's context — so this
 * hook MUST be registered without `async: true` (see install.sh). Claude-Code-
 * only: other hosts don't route hook stdout into model context.
 *
 * Design corrections after adversarial review:
 * - Cheap pre-check from the status JSON (guard_mode + mood) BEFORE touching the
 *   DB, so guard-mode-off users pay only a file read, not a native sqlite load.
 * - Lapse state + the recovery metric live in the DB (reasoning_reinject), NOT
 *   the status JSON — writeBuddyStatus rewrites that file wholesale and would
 *   clobber hook-private state.
 * - Lapse signal is scoped to the CURRENT session (cwd+day), so a claim in
 *   another project can't mask silence here.
 * - Recent claims for the resolved session are passed to the instruction, so the
 *   re-injected reminder is not falsely "(none yet)" and cross-turn edges land.
 *
 * Never throws — hooks must not crash the host.
 */
export interface ReinjectDeps {
  statusPath?: string;
  cwd?: string;                              // host cwd → session scoping
  sessionId?: string;                        // test injection (bypass cwd resolve)
  db?: any;                                  // test injection
  threshold?: number;                        // test injection
  emit?: (s: string) => void;                // default: process.stdout.write
  buildInstruction?: (recent: any[]) => string;
}

export async function reinjectExtractionInstructionIfLapsed(
  deps: ReinjectDeps = {},
): Promise<boolean> {
  const statusPath = deps.statusPath ?? BUDDY_STATUS_PATH;
  try {
    // Cheap pre-check from the status JSON — no DB / native load unless guard
    // mode is on and the buddy isn't muted.
    let status: any;
    try { status = JSON.parse(readFileSync(statusPath, "utf-8")); } catch { return false; }
    if ((status.guard_mode ?? 0) !== 1) return false;
    if (status.mood === "muted") return false;

    let db = deps.db;
    if (!db) {
      const schema = await import("../db/schema.js");
      schema.initDb();
      db = schema.db;
    }

    const companion = db.prepare("SELECT id FROM companions LIMIT 1").get() as
      { id: string } | undefined;
    if (!companion) return false;

    const reasoning = await import("../lib/reasoning/index.js");

    const sessionId = deps.sessionId
      ?? reasoning.deriveSessionId(reasoning.resolveProjectRoot(deps.cwd ?? process.cwd()).path);
    const threshold = deps.threshold ?? reasoning.REASONING_CONFIG.REINJECT_AFTER_SILENT_TURNS;

    const newestRow = db.prepare(
      "SELECT MAX(created_at) AS t FROM reasoning_claims WHERE session_id = ?",
    ).get(sessionId) as { t: number | null } | undefined;
    const newestAt = newestRow?.t ?? 0;

    const shouldEmit = reasoning.evaluateReinject(db, companion.id, sessionId, newestAt, threshold);
    if (!shouldEmit) return false;

    const recent = reasoning.loadRecentClaims(db, sessionId, reasoning.REASONING_CONFIG.RECENT_CLAIMS_CONTEXT);
    // Re-inject the full extraction instruction. A softer "skip-if-trivial"
    // variant was tested (eval) and rejected: it cut substantive recall on most
    // transcripts to claw back over-emission on one. For a graph-builder, recall
    // beats precision — the imperative is the right default; over-emission is a
    // documented, bounded, content-dependent caveat.
    const build = deps.buildInstruction ?? reasoning.buildExtractionInstruction;
    const emit = deps.emit ?? ((s: string) => { process.stdout.write(s); });
    emit(build(recent) + "\n");
    return true;
  } catch {
    return false;
  }
}

// --- CLI entry point ---
const isDirectRun = process.argv[1]?.includes("prompt-handler");
if (isDirectRun) {
  (async () => {
    let input: PromptInput | null = null;
    try {
      input = JSON.parse(readFileSync(0, "utf-8"));
    } catch {
      return;
    }
    if (!input) return;

    // Re-injection first — its stdout becomes prompt context for the next turn.
    try {
      await reinjectExtractionInstructionIfLapsed({ cwd: input.cwd });
    } catch { /* never crash */ }

    // Statusline mood reaction second (synchronous, no token cost).
    try { handlePromptSubmit(input); } catch { /* never crash */ }
  })();
}
