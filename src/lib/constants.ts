// src/lib/constants.ts — shared constants across the codebase

import { join } from "path";
import { homedir } from "os";

// Honor CLAUDE_CONFIG_DIR for installations that relocate Claude's config directory
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

export const BUDDY_STATUS_PATH = join(CLAUDE_CONFIG_DIR, "buddy-status.json");
export const BUDDY_DB_PATH = join(homedir(), ".buddy", "buddy.db");
