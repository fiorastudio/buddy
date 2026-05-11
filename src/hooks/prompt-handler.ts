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

// ─── findings delivery (guard-mode only) ───────────────────────────────────

/**
 * Drain pending findings from `reasoning_findings_log` to stdout so they
 * appear as system-reminder context in the next assistant turn.
 *
 * Imports are dynamic so the synchronous mood-pattern path doesn't pay
 * SQLite startup unless guard mode is actually active for this companion.
 */
export async function deliverFindingsForPrompt(): Promise<void> {
  const { db, initDb } = await import("../db/schema.js");
  initDb();

  // Read mood too — buddy_mute sets mood='muted' to silence the companion.
  // The rest of buddy's mute enforcement is incomplete today (mood is set
  // but rarely read), but it would be incoherent for a *new* feature to
  // ignore the user's explicit "be quiet" signal. If the maintainer later
  // strengthens mute across the rest of buddy, this gate is already in line.
  const companion = db.prepare(
    "SELECT id, guard_mode, mood FROM companions LIMIT 1",
  ).get() as { id: string; guard_mode: number | null; mood: string | null } | undefined;
  if (!companion) return;
  if ((companion.guard_mode ?? 0) === 0) return;
  if (companion.mood === 'muted') return;

  const { deliverPendingFindings } = await import("../lib/reasoning/delivery.js");
  try {
    deliverPendingFindings(db, companion.id);
  } catch (err: any) {
    if (process.env.BUDDY_DEBUG) {
      process.stderr.write(`[buddy] delivery failed: ${err?.message ?? String(err)}\n`);
    }
  }
}

// --- CLI entry point ---
const isDirectRun = process.argv[1]?.includes("prompt-handler");
if (isDirectRun) {
  (async () => {
    let input: PromptInput | null = null;
    try {
      const stdin = readFileSync(0, "utf-8");
      input = JSON.parse(stdin);
    } catch {
      return;
    }
    if (!input) return;

    // Findings delivery first — its stdout output becomes prompt context.
    try { await deliverFindingsForPrompt(); } catch { /* swallow */ }

    // Statusline mood reaction second (synchronous).
    try { handlePromptSubmit(input); } catch { /* swallow */ }
  })();
}
