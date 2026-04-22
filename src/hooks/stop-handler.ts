#!/usr/bin/env node
// src/hooks/stop-handler.ts
//
// Stop hook handler for Buddy MCP.
// Fires after every Claude response. Detects task-completion signals
// and writes an encouraging statusline reaction — zero token cost.
//
// Pure Node.js — only fs imports.

import { readFileSync, writeFileSync } from "fs";
import { BUDDY_STATUS_PATH } from "../lib/constants.js";

// Conservative completion signals — require explicit past-tense "done" phrasing.
// Avoids firing on planning sentences like "I'll implement..." or mid-task narration.
export const COMPLETION_REGEX =
  /\b(?:I(?:'ve| have) (?:implemented|added|created|updated|fixed|refactored|written|deployed|pushed|committed|completed|finished)|(?:all )?tests? (?:pass(?:ed|ing)?|are passing)|(?:the )?(?:fix|change|implementation) is (?:in place|complete|done)|successfully (?:deployed|committed|pushed|built)|(?:build|compilation) (?:succeeded|passed))\b/i;

// Bail if the response looks like ongoing work rather than completion.
export const ONGOING_REGEX =
  /^(?:I'?ll |Let me |I (?:need to|should|will|can)|Looking at|Checking|Reading|I'm (?:going to|working on|looking at))/i;

const COMPLETION_REACTIONS = [
  "ooh, new code! let me have a look...",
  "nice work! shipping things...",
  "that looks solid",
  "progress! the bits are flying",
  "task complete~",
  "committed? good.",
];

export interface StopInput {
  session_id?: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
  // Some Claude Code builds surface this directly; fall back to transcript otherwise.
  last_assistant_message?: string;
}

function extractLastMessage(input: StopInput): string {
  if (input.last_assistant_message) return input.last_assistant_message;

  if (!input.transcript_path) return "";
  try {
    const raw = readFileSync(input.transcript_path, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i]);
      // Handle both flat {role, content} and nested {type, message} transcript formats
      const role = entry.role ?? entry.message?.role;
      const content = entry.content ?? entry.message?.content;
      if (role !== "assistant" || !content) continue;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .filter((c: { type?: string }) => c.type === "text")
          .map((c: { text?: string }) => c.text ?? "")
          .join(" ");
      }
    }
  } catch { /* silent — transcript may not exist yet */ }
  return "";
}

export function writeCompletionReaction(statusPath: string = BUDDY_STATUS_PATH, expiryMs: number = 15_000): boolean {
  try {
    const raw = readFileSync(statusPath, "utf-8");
    const status = JSON.parse(raw);
    if (!status?.name) return false;

    // Single-pass race protection: don't overwrite an active reaction.
    if (status.reaction_expires && status.reaction_expires > Date.now()) return false;

    const reaction = COMPLETION_REACTIONS[Math.floor(Date.now() / 1000) % COMPLETION_REACTIONS.length];
    status.reaction = "excited";
    status.reaction_text = reaction;
    status.reaction_expires = Date.now() + expiryMs;
    status.reaction_eye = "^";
    status.reaction_indicator = "!";
    // No bubble_lines — hook reactions are statusline-only to keep them lightweight.

    writeFileSync(statusPath, JSON.stringify(status));
    return true;
  } catch {
    return false;
  }
}

export function handleStop(input: StopInput, statusPath: string = BUDDY_STATUS_PATH): boolean {
  const message = extractLastMessage(input);
  // Skip very short responses — unlikely to be a task completion turn.
  if (!message || message.length < 60) return false;
  if (ONGOING_REGEX.test(message)) return false;
  if (!COMPLETION_REGEX.test(message)) return false;

  return writeCompletionReaction(statusPath);
}

// --- CLI entry point ---
const isDirectRun = process.argv[1]?.includes("stop-handler");
if (isDirectRun) {
  try {
    const stdin = readFileSync(0, "utf-8");
    const input: StopInput = JSON.parse(stdin);
    handleStop(input);
  } catch {
    // Silent failure — hooks must never crash the host.
  }
}
