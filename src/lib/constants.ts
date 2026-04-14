// src/lib/constants.ts — shared constants across the codebase

import { join } from "path";
import { homedir } from "os";

export const BUDDY_STATUS_PATH = join(homedir(), ".claude", "buddy-status.json");
export const BUDDY_DB_PATH = join(homedir(), ".buddy", "buddy.db");
