#!/usr/bin/env node

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { renderCodexStatusline, type CodexBuddyStatus } from './lib/codex-statusline.js';

const BUDDY_STATUS_PATH = join(homedir(), '.claude', 'buddy-status.json');
const BUDDY_DB_PATH = join(homedir(), '.buddy', 'buddy.db');

type DbRow = {
  name: string;
  species: string;
  level: number;
  xp: number;
  mood: string;
};

function loadStatusFile(): CodexBuddyStatus | null {
  try {
    if (!existsSync(BUDDY_STATUS_PATH)) return null;
    return JSON.parse(readFileSync(BUDDY_STATUS_PATH, 'utf-8')) as CodexBuddyStatus;
  } catch {
    return null;
  }
}

function loadFromDb(): CodexBuddyStatus | null {
  let db: Database.Database | null = null;
  try {
    if (!existsSync(BUDDY_DB_PATH)) return null;
    db = new Database(BUDDY_DB_PATH, { readonly: true });
    const row = db.prepare(
      'SELECT name, species, level, xp, mood FROM companions ORDER BY created_at DESC LIMIT 1'
    ).get() as DbRow | undefined;
    if (!row) return null;
    return row;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function main(): void {
  const status = loadStatusFile() || loadFromDb();
  if (!status || !status.name) return;

  for (const line of renderCodexStatusline(status)) {
    if (line.trim()) {
      console.log(line);
    }
  }
}

main();
