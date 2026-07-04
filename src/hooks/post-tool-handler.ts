#!/usr/bin/env node
// src/hooks/post-tool-handler.ts
//
// PostToolUse hook handler for Buddy MCP.
// Reads stdin JSON (PostToolUse schema), detects errors in Bash output,
// and writes a concerned reaction to buddy-status.json when appropriate.
//
// Pure Node.js — only fs, path, os imports.

import { readFileSync, writeFileSync } from "fs";
import { BUDDY_STATUS_PATH } from "../lib/constants.js";
import { detectCommandEvent } from "../lib/xp-classify.js";
import { appendPendingEvent, DEFAULT_PENDING_EVENTS_PATH } from "../lib/pending-events.js";

// Error patterns — word-boundary anchored to avoid false positives
// like "error handling added", "0 errors", or "isError: false"
// Note: Error: (capitalized) intentionally has no \b prefix so TypeError:, RangeError: etc. match
export const ERROR_REGEX = /\berror:|Error:|\bENOENT\b|\bEACCES\b|exit code [1-9]\d*|\bFAILED\b|panicked at/;

// Concerned reactions — species-generic, short
const CONCERNED_REACTIONS = [
  "hmm, that doesn't look right...",
  "uh oh, something went wrong",
  "that error might need attention",
  "something broke — want to investigate?",
  "oops... let me take a closer look",
];

// Verified against https://code.claude.com/docs/en/hooks.md: tool_response
// is an OBJECT — {type:'text', text} on success, {type:'error', error,
// stdout, stderr} on failure — and NO Bash exit-code field exists anywhere
// in the payload. Success/failure must be inferred from the error field
// and output text. Older/other hosts may still send plain strings.
export interface PostToolUseInput {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_response?:
    | string
    | { type?: string; text?: string; error?: string; stdout?: string; stderr?: string };
}

interface GenericHookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  toolName?: string;
  toolArgs?: string;
  toolResult?: {
    resultType?: string;
    textResultForLlm?: string;
    [key: string]: unknown;
  };
  command?: string;
  output?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

function inferToolName(input: GenericHookInput): string {
  if (typeof input.tool_name === "string") return input.tool_name;
  if (typeof input.toolName === "string") return input.toolName;
  if (typeof input.command === "string") return "Bash";
  return "";
}

function inferToolOutput(input: GenericHookInput): string {
  if (typeof input.tool_response === "string") return input.tool_response;
  // Documented Claude Code shape: object with text (success) or
  // error/stdout/stderr (failure). Include the error string so the
  // ERROR_REGEX ("exit code N", "Error:") sees real failures.
  if (input.tool_response && typeof input.tool_response === "object") {
    const r = input.tool_response as { text?: string; error?: string; stdout?: string; stderr?: string };
    const parts = [r.error, r.text, r.stdout, r.stderr].filter(
      (p): p is string => typeof p === "string" && p.length > 0
    );
    if (parts.length > 0) return parts.join("\n");
  }
  if (typeof input.toolResult?.textResultForLlm === "string") return input.toolResult.textResultForLlm;

  const parts = [
    typeof input.output === "string" ? input.output : "",
    typeof input.stdout === "string" ? input.stdout : "",
    typeof input.stderr === "string" ? input.stderr : "",
  ].filter(Boolean);

  if (typeof input.exitCode === "number" && input.exitCode !== 0) {
    parts.push(`exit code ${input.exitCode}`);
  }

  return parts.join("\n");
}

/**
 * Check if a fresh reaction already exists (race protection).
 * Returns true if we should bail and not overwrite.
 */
export function hasActiveReaction(statusPath: string = BUDDY_STATUS_PATH): boolean {
  try {
    const raw = readFileSync(statusPath, "utf-8");
    const status = JSON.parse(raw);
    return !!(status.reaction_expires && status.reaction_expires > Date.now());
  } catch {
    return false;
  }
}

/**
 * Write a concerned reaction to buddy-status.json.
 * Single-pass: reads file, checks for active reaction, writes if safe.
 * This avoids the TOCTOU race of checking separately then writing.
 */
export function writeConcernedReaction(statusPath: string = BUDDY_STATUS_PATH, expiryMs: number = 8_000): boolean {
  try {
    const raw = readFileSync(statusPath, "utf-8");
    const status = JSON.parse(raw);
    if (!status || !status.name) return false;

    // Single-pass race protection: bail if a fresh reaction exists
    if (status.reaction_expires && status.reaction_expires > Date.now()) return false;

    const reaction = CONCERNED_REACTIONS[Math.floor(Date.now() / 1000) % CONCERNED_REACTIONS.length];

    status.reaction = "concerned";
    status.reaction_text = reaction;
    status.reaction_expires = Date.now() + expiryMs;
    status.reaction_eye = "\u00d7"; // ×
    status.reaction_indicator = "?";
    // No bubble_lines for hook reactions — keep it lightweight

    writeFileSync(statusPath, JSON.stringify(status));
    return true;
  } catch {
    return false;
  }
}

/**
 * Main handler — reads stdin, processes PostToolUse event.
 */
function inferCommand(input: GenericHookInput): string {
  const ti = input.tool_input;
  if (ti && typeof ti.command === "string") return ti.command;
  if (typeof input.command === "string") return input.command;
  if (typeof input.toolArgs === "string") return input.toolArgs;
  return "";
}

/**
 * Ground-truth XP channel: when the executed command IS a commit/deploy/
 * test-pass, queue it for the MCP server to award on the next observe.
 * Exit code falls back to the error heuristic when the host omits it.
 */
export function recordGroundTruthEvent(
  input: PostToolUseInput | GenericHookInput,
  pendingPath: string = DEFAULT_PENDING_EVENTS_PATH
): string | null {
  const toolName = inferToolName(input);
  const output = inferToolOutput(input);
  const command = inferCommand(input as GenericHookInput);
  const exitCode =
    typeof (input as GenericHookInput).exitCode === "number"
      ? ((input as GenericHookInput).exitCode as number)
      : ERROR_REGEX.test(output)
        ? 1
        : 0;
  const canonicalTool = toolName.toLowerCase() === "bash" ? "Bash" : toolName;
  const event = detectCommandEvent(canonicalTool, command, output, exitCode);
  if (event) appendPendingEvent(pendingPath, { type: event, ts: Date.now() });
  return event;
}

export function handlePostToolUse(input: PostToolUseInput | GenericHookInput, statusPath: string = BUDDY_STATUS_PATH): boolean {
  const toolName = inferToolName(input);
  if (toolName.toLowerCase() !== "bash") return false;

  recordGroundTruthEvent(input);

  const output = inferToolOutput(input);

  // Check for error patterns
  if (!ERROR_REGEX.test(output)) return false;

  // Write concerned reaction (includes single-pass race protection)
  return writeConcernedReaction(statusPath);
}

// --- CLI entry point ---
// When run directly, read stdin and process
const isDirectRun = process.argv[1]?.includes("post-tool-handler");
if (isDirectRun) {
  try {
    const stdin = readFileSync(0, "utf-8");
    const input: PostToolUseInput = JSON.parse(stdin);
    handlePostToolUse(input);
  } catch {
    // Silent failure — hooks should never crash the host
  }
}
