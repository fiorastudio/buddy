// src/lib/constants.ts — shared constants across the codebase

import { join } from "path";
import { homedir } from "os";

// Honor CLAUDE_CONFIG_DIR for installations that relocate Claude's config directory
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

export const BUDDY_STATUS_PATH = join(CLAUDE_CONFIG_DIR, "buddy-status.json");
export const BUDDY_DB_PATH = join(homedir(), ".buddy", "buddy.db");

// Claude Code's own config file — holds the signed-in account and its last
// cached rate-limit utilization, both read by the statusline usage panel.
export const CLAUDE_CONFIG_FILE = join(homedir(), ".claude.json");
// Where the optional usage refresh stores what it fetched, plus its in-flight marker.
export const BUDDY_USAGE_CACHE_PATH = join(CLAUDE_CONFIG_DIR, "buddy-usage-cache.json");
export const BUDDY_USAGE_LOCK_PATH = join(CLAUDE_CONFIG_DIR, "buddy-usage-cache.lock");
// Linux/Windows keep Claude Code credentials in a file; macOS keeps them in the keychain.
export const CLAUDE_CREDENTIALS_FILE = join(CLAUDE_CONFIG_DIR, ".credentials.json");
