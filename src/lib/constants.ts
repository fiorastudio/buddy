// src/lib/constants.ts — shared constants across the codebase

import { dirname, join } from "path";
import { homedir } from "os";

// Honor CLAUDE_CONFIG_DIR for installations that relocate Claude's config directory
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

export const BUDDY_STATUS_PATH = join(CLAUDE_CONFIG_DIR, "buddy-status.json");

// Same override db/schema.ts opens, so every path derived from the DB location
// follows it. Before, this ignored BUDDY_DB_PATH, and a test that redirected
// the DB still had its hook events queued in the real ~/.buddy.
export const BUDDY_DB_PATH = process.env.BUDDY_DB_PATH || join(homedir(), ".buddy", "buddy.db");

// Queue between the PostToolUse hook and the MCP server (lib/pending-events.ts):
// next to the DB, unless BUDDY_PENDING_EVENTS_PATH points somewhere else.
export const BUDDY_PENDING_EVENTS_PATH =
  process.env.BUDDY_PENDING_EVENTS_PATH || join(dirname(BUDDY_DB_PATH), "pending-events.jsonl");
