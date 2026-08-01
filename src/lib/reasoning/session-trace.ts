import { createHash } from 'crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'fs';
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

// Session transcripts are big and there are a lot of them — a working
// ~/.claude/projects runs to gigabytes across hundreds of .jsonl files. We
// only ever need the first line (Claude) or the first handful (Codex), so
// reading each file whole made this scale with total transcript volume
// instead of with the header we actually parse. On a machine with real
// history it never finished.
// 32 KiB comfortably covers a first JSONL record while keeping a full scan of
// a few hundred transcripts in the tens of megabytes rather than the tens of
// gigabytes. A whole .json still gets parsed as one object, so it has its own
// (larger) ceiling.
const HEAD_BYTES = 32 * 1024;
const MAX_WHOLE_JSON_BYTES = 256 * 1024;

// Reads at most `bytes` from the front of a file. `truncated` says whether
// the file continued past what we read, so callers can discard a trailing
// partial line rather than trying to parse half a JSON object.
function readHead(file: string, bytes: number = HEAD_BYTES): { text: string; truncated: boolean } {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.allocUnsafe(bytes);
    const got = readSync(fd, buf, 0, bytes, 0);
    return { text: buf.toString('utf-8', 0, got), truncated: got === bytes };
  } catch {
    return { text: '', truncated: false };
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

// Complete lines only — a truncated read almost always ends mid-line.
function headLines(file: string, bytes: number = HEAD_BYTES): string[] {
  const { text, truncated } = readHead(file, bytes);
  if (!text) return [];
  const lines = text.split('\n');
  if (truncated) lines.pop();
  return lines.filter(Boolean);
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
        // .json is parsed whole, so it is read whole — but only when it is
        // small enough to plausibly be session metadata. .jsonl needs just
        // the first record.
        let firstLine: string;
        if (file.endsWith('.jsonl')) {
          firstLine = headLines(file)[0] ?? '';
        } else {
          let size = 0;
          try { size = statSync(file).size; } catch { continue; }
          if (size > MAX_WHOLE_JSON_BYTES) continue;
          firstLine = readFileSync(file, 'utf-8');
        }
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
      const lines = headLines(file).slice(0, 12);
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
