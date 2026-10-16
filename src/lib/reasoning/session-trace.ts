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
//
// We therefore read in small chunks and stop as soon as we have the lines we
// need — the first newline for Claude. A fixed byte count was the wrong bound:
// a first record longer than it (Codex's session_meta embeds the full
// instructions) was cut mid-line, discarded as partial, and the session never
// matched. The line, not the byte count, is the unit. MAX_RECORD_BYTES is only
// a backstop against a pathological file with no newline at all.
// A whole .json still gets parsed as one object, so it has its own (larger)
// ceiling.
const CHUNK_BYTES = 32 * 1024;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_WHOLE_JSON_BYTES = 256 * 1024;

// Returns up to `maxLines` complete, non-empty lines from the front of a file,
// reading chunk by chunk until that many newlines have been seen (or EOF, or
// the backstop). A trailing line is only returned if the file really ended
// there — a read cut off by the backstop never yields half a JSON object.
function headLines(file: string, maxLines: number, maxBytes: number = MAX_RECORD_BYTES): string[] {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    const parts: Buffer[] = [];
    let total = 0;
    let newlines = 0;
    let eof = false;
    while (total < maxBytes && newlines < maxLines) {
      const got = readSync(fd, chunk, 0, CHUNK_BYTES, total);
      if (got === 0) { eof = true; break; }
      const piece = Buffer.from(chunk.subarray(0, got));
      for (let i = 0; i < got; i++) if (piece[i] === 0x0a) newlines++;
      parts.push(piece);
      total += got;
      if (got < CHUNK_BYTES) { eof = true; break; }
    }
    const lines = Buffer.concat(parts).toString('utf-8').split('\n');
    if (!eof) lines.pop(); // may be cut mid-line
    return lines.filter(Boolean).slice(0, maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

function tryMatchCwd(trace: SessionTrace, cwd: string): boolean {
  if (hashCwd(cwd) !== trace.cwdHash) return false;
  trace.cwd = cwd;
  trace.projectLabel = labelForCwd(cwd);
  return true;
}

function resolveClaudeTrace(trace: SessionTrace, home: string): boolean {
  const candidates = [join(home, '.claude', 'sessions'), join(home, '.claude', 'projects')];
  for (const dir of candidates) {
    for (const file of walkFiles(dir, ['.json', '.jsonl'], 3)) {
      try {
        // .json is parsed whole, so it is read whole — but only when it is
        // small enough to plausibly be session metadata. .jsonl needs just
        // the first record.
        let firstLine: string;
        if (file.endsWith('.jsonl')) {
          firstLine = headLines(file, 1)[0] ?? '';
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

function resolveCodexTrace(trace: SessionTrace, home: string): boolean {
  const root = join(home, '.codex', 'sessions');
  for (const file of walkFiles(root, ['.jsonl'], 4)) {
    try {
      const lines = headLines(file, 12);
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

export type ResolveOptions = {
  // Root to search under, defaulting to the real home directory. Tests point
  // this at a fixture tree: reading the developer's actual ~/.claude made the
  // result depend on whose machine ran the suite, and made runtime scale with
  // their transcript history — a test that took >90s here and 0s on a CI
  // runner with no history, which is how an unbounded read went unnoticed.
  home?: string;
};

export function resolveSessionTrace(sessionId: string, opts: ResolveOptions = {}): SessionTrace {
  const parsed = parseSessionId(sessionId);
  if (!parsed) return { sessionId, cwdHash: '', dateBucket: '' };

  const home = opts.home ?? homedir();
  const trace: SessionTrace = { sessionId, cwdHash: parsed.cwdHash, dateBucket: parsed.dateBucket };
  if (resolveClaudeTrace(trace, home)) return trace;
  if (resolveCodexTrace(trace, home)) return trace;
  return trace;
}
