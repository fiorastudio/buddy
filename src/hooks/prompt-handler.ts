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

// --- CLI entry point ---
const isDirectRun = process.argv[1]?.includes("prompt-handler");
if (isDirectRun) {
  try {
    const stdin = readFileSync(0, "utf-8");
    const input: PromptInput = JSON.parse(stdin);
    handlePromptSubmit(input);
  } catch {
    // Silent failure — hooks must never crash the host.
  }
}
