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

export interface PostToolUseInput {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_response?: string;
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
export function handlePostToolUse(input: PostToolUseInput | GenericHookInput, statusPath: string = BUDDY_STATUS_PATH): boolean {
  const toolName = inferToolName(input);
  if (toolName !== "Bash" && toolName.toLowerCase() !== "bash") return false;

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
