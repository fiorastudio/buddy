import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';
import { homedir } from 'os';

export type SessionTrace = {
  sessionId: string;
  cwdHash: string;
  dateBucket: string;
  cwd?: string;
  projectLabel?: string;
  source?: 'claude' | 'codex';
  claudeSessionFile?: string;
  codexSessionFile?: string;
  codexSessionId?: string;
};

function parseSessionId(sessionId: string): { cwdHash: string; dateBucket: string } | null {
  const match = /^([0-9a-f]{16})-(\d{8})$/.exec(sessionId);
  if (!match) return null;
  return { cwdHash: match[1], dateBucket: match[2] };
}

function hashCwd(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

function labelForCwd(cwd: string): string {
  const parent = basename(dirname(cwd));
  const folder = basename(cwd);
  return parent && parent !== folder ? `${parent}/${folder}` : folder;
}

function walkFiles(root: string, exts: string[], depth: number = 4): string[] {
  const out: string[] = [];
  function visit(dir: string, d: number): void {
    if (d < 0 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        visit(full, d - 1);
      } else if (exts.some(ext => entry.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  visit(root, depth);
  return out;
}

function tryMatchCwd(trace: SessionTrace, cwd: string): boolean {
  if (hashCwd(cwd) !== trace.cwdHash) return false;
  trace.cwd = cwd;
  trace.projectLabel = labelForCwd(cwd);
  return true;
}

function resolveClaudeTrace(trace: SessionTrace): boolean {
  const candidates = [join(homedir(), '.claude', 'sessions'), join(homedir(), '.claude', 'projects')];
  for (const dir of candidates) {
    for (const file of walkFiles(dir, ['.json', '.jsonl'], 3)) {
      try {
        const raw = readFileSync(file, 'utf-8');
        const firstLine = file.endsWith('.jsonl') ? raw.split('\n').find(Boolean) ?? '' : raw;
        if (!firstLine) continue;
        const data = JSON.parse(firstLine) as { cwd?: string };
        if (!data.cwd || !tryMatchCwd(trace, data.cwd)) continue;
        trace.source = 'claude';
        trace.claudeSessionFile = file;
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

function resolveCodexTrace(trace: SessionTrace): boolean {
  const root = join(homedir(), '.codex', 'sessions');
  for (const file of walkFiles(root, ['.jsonl'], 4)) {
    try {
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean).slice(0, 12);
      for (const line of lines) {
        const row = JSON.parse(line) as any;
        const payload = row?.payload;
        const cwd = payload?.cwd;
        if (typeof cwd !== 'string' || !tryMatchCwd(trace, cwd)) continue;
        trace.source = 'codex';
        trace.codexSessionFile = file;
        if (row?.type === 'session_meta' && typeof payload?.id === 'string') {
          trace.codexSessionId = payload.id;
        }
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function resolveSessionTrace(sessionId: string): SessionTrace {
  const parsed = parseSessionId(sessionId);
  if (!parsed) return { sessionId, cwdHash: '', dateBucket: '' };

  const trace: SessionTrace = { sessionId, cwdHash: parsed.cwdHash, dateBucket: parsed.dateBucket };
  if (resolveClaudeTrace(trace)) return trace;
  if (resolveCodexTrace(trace)) return trace;
  return trace;
}
