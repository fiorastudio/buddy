// src/lib/doctor.ts — Diagnostic engine for buddy_doctor tool and CLI

import { readFileSync, accessSync, statSync, realpathSync, constants as fsConstants } from 'fs';
import { join, dirname, resolve as pathResolve, normalize, isAbsolute } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { BUDDY_DB_PATH, BUDDY_STATUS_PATH } from './constants.js';
import { db } from '../db/schema.js';
import { loadCompanion } from './companion.js';
import { STAT_NAMES, RARITY_STARS } from './types.js';
import { levelProgress } from './leveling.js';
import { REASONING_CONFIG, telemetry } from './reasoning/index.js';
import { basisDistributionHealth } from './reasoning/telemetry.js';

// Shared sentinel — keep in sync with install.sh / install.ps1
export const PROMPT_SENTINEL_V2 = 'buddy-companion v2';

/** Default clone/build root from install.sh (INSTALL_DIR) */
export function canonicalBuddyInstallDir(): string {
  return join(homedir(), '.buddy', 'server');
}

export function canonicalBuddyMcpEntryPath(): string {
  return join(canonicalBuddyInstallDir(), 'dist', 'server', 'index.js');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DiagnosticCheck {
  id: string;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  label: string;
  detail: string;
  suggestion?: string;
}

function getVersion(): string {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8')).version;
  } catch { return 'unknown'; }
}

function fileExists(path: string): boolean {
  try { accessSync(path, fsConstants.F_OK); return true; } catch { return false; }
}

function fileWritable(path: string): boolean {
  try { accessSync(path, fsConstants.W_OK); return true; } catch { return false; }
}

function fileReadable(path: string): boolean {
  try { accessSync(path, fsConstants.R_OK); return true; } catch { return false; }
}

function readJsonSafe(path: string): any {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function readTextSafe(path: string): string | null {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function safeRealpath(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

function expandTildeInPath(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return p === '~' ? homedir() : join(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Resolves a config path for existence checks (tilde, relative segments).
 */
function resolveBuddyEntryPath(p: string): string {
  const expanded = expandTildeInPath(p.trim());
  if (isAbsolute(expanded)) {
    return normalize(pathResolve(expanded));
  }
  return normalize(pathResolve(process.cwd(), expanded));
}

/**
 * First script path from a host's buddy MCP block (install.sh / Cursor style).
 */
function entryPathFromMcpBlock(buddy: any): string | null {
  if (!buddy || typeof buddy !== 'object') return null;
  const args = buddy.args;
  if (!Array.isArray(args)) return null;
  const entry = args.find((a: unknown) => typeof a === 'string' && a.endsWith('.js'));
  return entry ?? null;
}

/**
 * All buddy MCP `dist/server/index.js` paths from known config files (for mismatch / missing checks).
 */
function getRegisteredBuddyMcpEntryPaths(): Array<{ source: string; path: string; resolved: string }> {
  const out: Array<{ source: string; path: string; resolved: string }> = [];

  const claudeJsonPath = join(homedir(), '.claude.json');
  const cj = readJsonSafe(claudeJsonPath);
  const p1 = entryPathFromMcpBlock(cj?.mcpServers?.buddy);
  if (p1) {
    out.push({ source: claudeJsonPath, path: p1, resolved: resolveBuddyEntryPath(p1) });
  }

  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const st = readJsonSafe(settingsPath);
  const p2 = entryPathFromMcpBlock(st?.mcpServers?.buddy);
  if (p2) {
    out.push({ source: settingsPath, path: p2, resolved: resolveBuddyEntryPath(p2) });
  }

  const cur = readJsonSafe(cursorMcpPath());
  const p3 = entryPathFromMcpBlock(cur?.mcpServers?.buddy);
  if (p3) {
    out.push({ source: cursorMcpPath(), path: p3, resolved: resolveBuddyEntryPath(p3) });
  }

  const cop = readJsonSafe(copilotMcpPath());
  const p4 = entryPathFromMcpBlock(cop?.mcpServers?.buddy);
  if (p4) {
    out.push({ source: copilotMcpPath(), path: p4, resolved: resolveBuddyEntryPath(p4) });
  }

  const toml = readTextSafe(codexConfigPath());
  if (toml) {
    const m = toml.match(/\[mcp_servers\.buddy\][\s\S]*?args\s*=\s*\[\s*"([^"]+\.js)"/);
    if (m?.[1]) {
      out.push({ source: codexConfigPath(), path: m[1], resolved: resolveBuddyEntryPath(m[1]) });
    }
  }

  return out;
}

function formatPathList(paths: string[]): string {
  return paths.join(' | ');
}

function codexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml');
}

function codexHooksPath(): string {
  return join(homedir(), '.codex', 'hooks.json');
}

function cursorMcpPath(): string {
  return join(homedir(), '.cursor', 'mcp.json');
}

function cursorHooksPath(): string {
  return join(homedir(), '.cursor', 'hooks.json');
}

function copilotMcpPath(): string {
  return join(homedir(), '.copilot', 'mcp-config.json');
}

function copilotSettingsPath(): string {
  return join(homedir(), '.copilot', 'settings.json');
}

function hostPromptFiles(): Array<{ host: string, path: string }> {
  return [
    { host: 'Claude Code', path: join(homedir(), '.claude', 'CLAUDE.md') },
    { host: 'Codex CLI', path: join(homedir(), '.codex', 'AGENTS.md') },
    { host: 'Codex CLI', path: join(homedir(), '.codex', 'instructions.md') },
    { host: 'Cursor CLI', path: join(homedir(), '.cursor', 'rules', 'buddy.md') },
    { host: 'GitHub Copilot CLI', path: join(homedir(), '.copilot', 'AGENTS.md') },
    { host: 'GitHub Copilot CLI', path: join(homedir(), '.copilot', 'copilot-instructions.md') },
  ];
}

// ── Individual checks ──

function checkNodeVersion(): DiagnosticCheck {
  const ver = process.version;
  const major = parseInt(ver.slice(1), 10);
  if (major < 18) {
    return { id: 'env.node', status: 'fail', label: 'Node.js', detail: ver, suggestion: 'Node.js 18+ required. Upgrade at https://nodejs.org' };
  }
  return { id: 'env.node', status: 'ok', label: 'Node.js', detail: `${ver} \u2713` };
}

function checkPlatform(): DiagnosticCheck {
  return { id: 'env.platform', status: 'ok', label: 'Platform', detail: `${process.platform} ${process.arch}` };
}

function checkEnvVars(): DiagnosticCheck {
  const dbOverride = process.env.BUDDY_DB_PATH ? `(custom) ${process.env.BUDDY_DB_PATH}` : `(default) ${BUDDY_DB_PATH}`;
  const statusOverride = process.env.BUDDY_STATUS_PATH ? `(custom) ${process.env.BUDDY_STATUS_PATH}` : `(default) ${BUDDY_STATUS_PATH}`;
  // Warn only if custom path is set but doesn't exist
  let status: 'ok' | 'warn' = 'ok';
  let suggestion: string | undefined;
  if (process.env.BUDDY_DB_PATH && !fileExists(process.env.BUDDY_DB_PATH)) {
    status = 'warn';
    suggestion = `BUDDY_DB_PATH is set to ${process.env.BUDDY_DB_PATH} but file does not exist`;
  }
  return { id: 'env.vars', status, label: 'Env overrides', detail: `DB: ${dbOverride}\n               STATUS: ${statusOverride}`, suggestion };
}

function checkPackageVersion(): DiagnosticCheck {
  const ver = getVersion();
  return { id: 'pkg.version', status: 'ok', label: 'Package', detail: `@fiorastudio/buddy v${ver}` };
}

const INSTALL_CURL = 'curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash';
const BUILD_FROM_SOURCE = 'git clone https://github.com/fiorastudio/buddy.git ~/.buddy/server && cd ~/.buddy/server && npm install && npm run build';

/**
 * install.sh default location: ~/.buddy/server/dist/server/index.js
 * Strong signal when buddy.db exists but the tree is missing (common partial install / manual DB).
 */
function checkInstallLayout(): DiagnosticCheck {
  const expected = canonicalBuddyMcpEntryPath();
  if (fileExists(expected)) {
    return {
      id: 'install.server',
      status: 'ok',
      label: 'Server install',
      detail: `\u2713 ${expected}`,
    };
  }

  // Only fail hard when the *default* data file on disk exists (user has state but no
  // install). Custom BUDDY_DB_PATH in tests/CI should not trip this.
  const homeDefaultDb = join(homedir(), '.buddy', 'buddy.db');
  const hasStateWithoutInstall = fileExists(homeDefaultDb);
  const hasDir = fileExists(canonicalBuddyInstallDir());
  const parts = [hasStateWithoutInstall ? 'buddy.db in ~/.buddy' : null, hasDir ? 'repo dir without dist build' : null].filter(Boolean);
  const ctx = parts.length > 0 ? ` (${parts.join(' · ')})` : '';
  const suggestion = `Run the installer: ${INSTALL_CURL} — or: ${BUILD_FROM_SOURCE}`;

  if (hasStateWithoutInstall) {
    return {
      id: 'install.server',
      status: 'fail',
      label: 'Server install',
      detail: `Missing or not built: ${expected}${ctx}`,
      suggestion: `Data exists at ~/.buddy/buddy.db but the standard server checkout/build is not present. ${suggestion} Then re-point MCP to ~/.buddy/server/dist/server/index.js if needed.`,
    };
  }

  return {
    id: 'install.server',
    status: 'warn',
    label: 'Server install',
    detail: `Missing: ${expected}${ctx}`,
    suggestion,
  };
}

/**
 * MCP paths must exist; warn when multiple host configs or non-canonical copy is used.
 */
function checkMcpEntryPaths(): DiagnosticCheck {
  const registered = getRegisteredBuddyMcpEntryPaths();
  if (registered.length === 0) {
    return {
      id: 'mcp.paths',
      status: 'skip',
      label: 'MCP paths',
      detail: 'No buddy args found in config files (see mcp.registered)',
    };
  }

  const missing = registered.filter((r) => !fileExists(r.resolved));
  if (missing.length > 0) {
    const list = missing.map((m) => `${m.source} \u2192 ${m.resolved} (missing)`).join(' | ');
    return {
      id: 'mcp.paths',
      status: 'fail',
      label: 'MCP paths',
      detail: list,
      suggestion: `Fix or rebuild the path in mcp config, or install to ~/.buddy/server: ${BUILD_FROM_SOURCE}`,
    };
  }

  const unique = [...new Set(registered.map((r) => r.resolved))];
  if (unique.length > 1) {
    return {
      id: 'mcp.paths',
      status: 'warn',
      label: 'MCP paths',
      detail: `Multiple different entry scripts: ${unique.join(' | ')}`,
      suggestion: 'Point every host at one checkout (recommended: ~/.buddy/server/dist/server/index.js) so CLI and IDEs use the same Buddy build.',
    };
  }

  const canonical = normalize(pathResolve(canonicalBuddyMcpEntryPath()));
  const only = unique[0]!;
  if (safeRealpath(only) === safeRealpath(canonical)) {
    return { id: 'mcp.paths', status: 'ok', label: 'MCP paths', detail: `\u2713 single path, matches standard install` };
  }

  if (fileExists(canonical)) {
    return {
      id: 'mcp.paths',
      status: 'warn',
      label: 'MCP paths',
      detail: `MCP uses ${only} but standard install also exists: ${canonical}`,
      suggestion: 'Align ~/.cursor/mcp.json (and other hosts) on one path, or remove the extra checkout to avoid version drift.',
    };
  }

  return {
    id: 'mcp.paths',
    status: 'ok',
    label: 'MCP paths',
    detail: `\u2713 ${only} (non-standard; ~/.buddy/server not present)`,
  };
}

function checkCompanionActive(): DiagnosticCheck {
  try {
    const row = db.prepare('SELECT * FROM companions LIMIT 1').get() as any;
    if (!row) {
      return { id: 'companion.active', status: 'warn', label: 'Active companion', detail: 'None', suggestion: 'Use buddy_hatch to create a companion' };
    }
    return { id: 'companion.active', status: 'ok', label: 'Active companion', detail: `\u2713 ${row.name} the ${row.species}` };
  } catch {
    return { id: 'companion.active', status: 'fail', label: 'Active companion', detail: 'DB query failed', suggestion: 'Database may be corrupted. Try deleting ~/.buddy/buddy.db and re-hatching' };
  }
}

function checkCompanionCount(): DiagnosticCheck {
  try {
    const row = db.prepare('SELECT count(*) as count FROM companions').get() as any;
    return { id: 'companion.count', status: 'ok', label: 'Total saved', detail: `${row?.count || 0} companion(s) in DB` };
  } catch {
    return { id: 'companion.count', status: 'fail', label: 'Total saved', detail: 'DB query failed' };
  }
}

function checkCompanionDetails(): DiagnosticCheck {
  try {
    const row = db.prepare('SELECT * FROM companions LIMIT 1').get() as any;
    if (!row) {
      return { id: 'companion.details', status: 'skip', label: 'Companion details', detail: 'No companion' };
    }
    const companion = loadCompanion(row);
    if (!companion) {
      return { id: 'companion.details', status: 'fail', label: 'Companion details', detail: 'loadCompanion() returned null' };
    }
    const { level, currentXp, neededXp } = levelProgress(companion.xp);
    const stars = RARITY_STARS[companion.rarity] || '';
    const statStr = STAT_NAMES.map(s => `${s.slice(0, 3)}:${companion.stats[s]}`).join(' ');
    const bioLen = companion.personalityBio?.length || 0;
    return {
      id: 'companion.details', status: 'ok', label: 'Details',
      detail: `${stars} ${companion.rarity} | Lv.${level} (${currentXp}/${neededXp} XP) | mood: ${companion.mood}\n               Stats: ${statStr}\n               Bio: \u2713 (${bioLen} chars)`,
    };
  } catch (e: any) {
    return { id: 'companion.details', status: 'fail', label: 'Companion details', detail: e?.message || 'Unknown error' };
  }
}

function checkDbExists(): DiagnosticCheck {
  if (!fileExists(BUDDY_DB_PATH)) {
    return { id: 'db.exists', status: 'fail', label: 'Database file', detail: `${BUDDY_DB_PATH} not found`, suggestion: 'Database will be created on first buddy_hatch' };
  }
  const writable = fileWritable(BUDDY_DB_PATH);
  try {
    const stat = statSync(BUDDY_DB_PATH);
    const sizeKb = (stat.size / 1024).toFixed(1);
    return {
      id: 'db.exists', status: writable ? 'ok' : 'warn', label: 'Database file',
      detail: `${BUDDY_DB_PATH} ${writable ? '\u2713' : '\u2717 read-only'} (${sizeKb} KB)`,
      suggestion: writable ? undefined : 'Database is not writable — check file permissions',
    };
  } catch {
    return { id: 'db.exists', status: 'warn', label: 'Database file', detail: `${BUDDY_DB_PATH} exists but cannot stat` };
  }
}

function checkDbTables(): DiagnosticCheck {
  const expected = ['companions', 'memories', 'xp_events', 'sessions', 'evolution_history',
                    'reasoning_claims', 'reasoning_edges', 'reasoning_findings_log'];
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    const tables = rows.map(r => r.name);
    const results = expected.map(t => `${t} ${tables.includes(t) ? '\u2713' : '\u2717'}`);
    const missing = expected.filter(t => !tables.includes(t));
    return {
      id: 'db.tables', status: missing.length > 0 ? 'fail' : 'ok', label: 'DB tables',
      detail: results.join(' | '),
      suggestion: missing.length > 0 ? `Missing tables: ${missing.join(', ')}. Try re-running the server to auto-create.` : undefined,
    };
  } catch {
    return { id: 'db.tables', status: 'fail', label: 'DB tables', detail: 'Cannot query sqlite_master' };
  }
}

function checkStatusFile(): DiagnosticCheck {
  if (!fileExists(BUDDY_STATUS_PATH)) {
    return { id: 'status.file', status: 'warn', label: 'Status file', detail: `${BUDDY_STATUS_PATH} not found`, suggestion: 'Status file is created when buddy_status or buddy_observe is called' };
  }
  const writable = fileWritable(BUDDY_STATUS_PATH);
  try {
    const stat = statSync(BUDDY_STATUS_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    const ageSec = Math.floor(ageMs / 1000);
    const fresh = ageSec < 60;
    return {
      id: 'status.file', status: writable ? 'ok' : 'warn', label: 'Status file',
      detail: `${BUDDY_STATUS_PATH} ${writable ? '\u2713' : '\u2717'} (${ageSec}s ago${fresh ? ' \u2713' : ' — stale'})`,
      suggestion: writable ? undefined : 'Status file is not writable — check permissions',
    };
  } catch {
    return { id: 'status.file', status: 'warn', label: 'Status file', detail: 'Exists but cannot stat' };
  }
}

function checkMcpRegistered(): DiagnosticCheck {
  const claudeJsonPath = join(homedir(), '.claude.json');
  const config = readJsonSafe(claudeJsonPath);
  if (config?.mcpServers?.buddy) {
    return { id: 'mcp.registered', status: 'ok', label: 'MCP registration', detail: `\u2713 registered in ${claudeJsonPath}` };
  }

  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settings = readJsonSafe(settingsPath);
  if (settings?.mcpServers?.buddy) {
    return { id: 'mcp.registered', status: 'ok', label: 'MCP registration', detail: `\u2713 registered in ${settingsPath}` };
  }

  const codexConfig = readTextSafe(codexConfigPath());
  if (codexConfig?.includes('[mcp_servers.buddy]')) {
    return { id: 'mcp.registered', status: 'ok', label: 'MCP registration', detail: `\u2713 registered in ${codexConfigPath()}` };
  }

  const cursorConfig = readJsonSafe(cursorMcpPath());
  if (cursorConfig?.mcpServers?.buddy) {
    return { id: 'mcp.registered', status: 'ok', label: 'MCP registration', detail: `\u2713 registered in ${cursorMcpPath()}` };
  }

  const copilotConfig = readJsonSafe(copilotMcpPath());
  if (copilotConfig?.mcpServers?.buddy) {
    return { id: 'mcp.registered', status: 'ok', label: 'MCP registration', detail: `\u2713 registered in ${copilotMcpPath()}` };
  }

  return {
    id: 'mcp.registered', status: 'fail', label: 'MCP registration', detail: '\u2717 not found',
    suggestion: 'Re-run the install script, or register Buddy in your host CLI MCP config.',
  };
}

function checkStatusline(): DiagnosticCheck {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settings = readJsonSafe(settingsPath);
  if (!settings?.statusLine?.command) {
    return { id: 'config.statusline', status: 'warn', label: 'Statusline', detail: '\u2717 not configured in settings.json', suggestion: 'Re-run install script to configure statusline' };
  }
  const cmd: string = settings.statusLine.command;
  if (!cmd.includes('statusline-wrapper')) {
    return { id: 'config.statusline', status: 'warn', label: 'Statusline', detail: `Configured but not pointing to buddy: ${cmd}` };
  }
  // Extract wrapper path — handle "node /path/to/file.js" and "node '/path with spaces/file.js'"
  // Match everything after "node " stripping surrounding quotes
  const pathMatch = cmd.match(/node\s+["']?(.+?)["']?\s*$/);
  const wrapperPath = pathMatch?.[1];
  if (wrapperPath && !fileExists(wrapperPath)) {
    return { id: 'config.statusline', status: 'fail', label: 'Statusline', detail: `Configured but wrapper missing: ${wrapperPath}`, suggestion: 'Re-run install script or rebuild' };
  }
  return { id: 'config.statusline', status: 'ok', label: 'Statusline', detail: '\u2713 configured in settings.json' };
}

function checkStatuslineRefresh(): DiagnosticCheck {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settings = readJsonSafe(settingsPath);
  if (!settings?.statusLine?.command?.includes('statusline-wrapper')) {
    return { id: 'config.statusline.refresh', status: 'skip', label: 'Refresh interval', detail: 'Buddy statusline not configured' };
  }
  const interval = settings.statusLine.refreshInterval;
  if (interval === undefined || interval === null) {
    return {
      id: 'config.statusline.refresh', status: 'warn', label: 'Refresh interval',
      detail: '\u2717 refreshInterval not set — animation may appear static',
      suggestion: 'Re-run install script or manually add "refreshInterval": 2 to statusLine in ~/.claude/settings.json',
    };
  }
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 1) {
    return {
      id: 'config.statusline.refresh', status: 'warn', label: 'Refresh interval',
      detail: `\u2717 refreshInterval is ${JSON.stringify(interval)} — must be a number >= 1`,
      suggestion: 'Set "refreshInterval": 2 in statusLine config for reliable animation',
    };
  }
  return { id: 'config.statusline.refresh', status: 'ok', label: 'Refresh interval', detail: `\u2713 refreshInterval: ${interval}` };
}

function checkHooks(): DiagnosticCheck {
  const found: string[] = [];

  const claudeSettingsPath = join(homedir(), '.claude', 'settings.json');
  const claudeSettings = readJsonSafe(claudeSettingsPath);
  const claudeHooks: any[] = Array.isArray(claudeSettings?.hooks?.PostToolUse) ? claudeSettings.hooks.PostToolUse : [];
  const hasClaudeHook = claudeHooks.some((entry: any) => {
    if (entry.matcher === 'Bash' && Array.isArray(entry.hooks)) {
      return entry.hooks.some((h: any) => h.command && h.command.includes('post-tool-handler'));
    }
    if (typeof entry === 'string' && entry.includes('post-tool-handler')) return true;
    return false;
  });
  if (hasClaudeHook) found.push(`Claude Code (${claudeSettingsPath})`);

  const codexHooks = readJsonSafe(codexHooksPath());
  const codexGroups: any[] = Array.isArray(codexHooks?.hooks?.PostToolUse) ? codexHooks.hooks.PostToolUse : [];
  const hasCodexHook = codexGroups.some((entry: any) =>
    Array.isArray(entry?.hooks) && entry.hooks.some((hook: any) => typeof hook?.command === 'string' && hook.command.includes('post-tool-handler'))
  );
  if (hasCodexHook) found.push(`Codex CLI (${codexHooksPath()})`);

  const cursorHooks = readJsonSafe(cursorHooksPath());
  const cursorShellHooks: any[] = Array.isArray(cursorHooks?.hooks?.afterShellExecution) ? cursorHooks.hooks.afterShellExecution : [];
  const hasCursorHook = cursorShellHooks.some((entry: any) => typeof entry?.command === 'string' && entry.command.includes('post-tool-handler'));
  if (hasCursorHook) found.push(`Cursor CLI (${cursorHooksPath()})`);

  const copilotSettings = readJsonSafe(copilotSettingsPath());
  const copilotHooks: any[] = Array.isArray(copilotSettings?.hooks?.postToolUse) ? copilotSettings.hooks.postToolUse : [];
  const hasCopilotHook = copilotHooks.some((entry: any) => {
    const bash = typeof entry?.bash === 'string' ? entry.bash : '';
    const powershell = typeof entry?.powershell === 'string' ? entry.powershell : '';
    return bash.includes('post-tool-handler') || powershell.includes('post-tool-handler');
  });
  if (hasCopilotHook) found.push(`GitHub Copilot CLI (${copilotSettingsPath()})`);

  if (found.length === 0) {
    return { id: 'config.hooks', status: 'warn', label: 'Hooks', detail: '\u2717 no buddy post-tool hook found', suggestion: 'Re-run install script to configure hooks' };
  }
  return { id: 'config.hooks', status: 'ok', label: 'Hooks', detail: `\u2713 ${formatPathList(found)}` };
}

function checkStopHook(): DiagnosticCheck {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settings = readJsonSafe(settingsPath);
  const hooks: any[] = Array.isArray(settings?.hooks?.Stop) ? settings.hooks.Stop : [];
  const has = hooks.some((entry: any) =>
    Array.isArray(entry.hooks) &&
    entry.hooks.some((h: any) => h.command && h.command.includes('stop-handler'))
  );
  if (!has) {
    return { id: 'config.hooks.stop', status: 'warn', label: 'Stop hook', detail: '\u2717 stop-handler not found', suggestion: 'Re-run install script to configure hooks' };
  }
  return { id: 'config.hooks.stop', status: 'ok', label: 'Stop hook', detail: '\u2713 Stop hook present' };
}

function checkPromptHook(): DiagnosticCheck {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settings = readJsonSafe(settingsPath);
  const hooks: any[] = Array.isArray(settings?.hooks?.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];
  const has = hooks.some((entry: any) =>
    Array.isArray(entry.hooks) &&
    entry.hooks.some((h: any) => h.command && h.command.includes('prompt-handler'))
  );
  if (!has) {
    return { id: 'config.hooks.prompt', status: 'warn', label: 'Prompt hook', detail: '\u2717 prompt-handler not found', suggestion: 'Re-run install script to configure hooks' };
  }
  return { id: 'config.hooks.prompt', status: 'ok', label: 'Prompt hook', detail: '\u2713 UserPromptSubmit hook present' };
}

function checkPromptInjection(): DiagnosticCheck {
  const found: string[] = [];
  const legacy: string[] = [];

  for (const file of hostPromptFiles()) {
    const content = readTextSafe(file.path);
    if (!content) continue;
    if (content.includes(PROMPT_SENTINEL_V2)) found.push(`${file.host} (${file.path})`);
    else if (content.includes('buddy-companion')) legacy.push(`${file.host} (${file.path})`);
  }

  if (found.length > 0) {
    return { id: 'prompt.injected', status: 'ok', label: 'Prompt injection', detail: `\u2713 ${formatPathList(found)}` };
  }
  if (legacy.length > 0) {
    return { id: 'prompt.injected', status: 'warn', label: 'Prompt injection', detail: `v1 sentinel found in ${formatPathList(legacy)}`, suggestion: 'Re-run install script to upgrade prompt instructions' };
  }
  return { id: 'prompt.injected', status: 'warn', label: 'Prompt injection', detail: '\u2717 no buddy instructions found in supported host prompt files', suggestion: 'Re-run install script to inject buddy instructions' };
}

function checkReasoningMaxMode(): DiagnosticCheck {
  try {
    const row = db.prepare('SELECT id, max_mode FROM companions LIMIT 1').get() as any;
    if (!row) {
      return { id: 'reasoning.max', status: 'skip', label: 'Max mode', detail: 'No companion' };
    }
    const on = (row.max_mode ?? 0) === 1;
    if (!on) {
      return { id: 'reasoning.max', status: 'ok', label: 'Max mode', detail: 'off (enable via buddy_mode max=true)' };
    }

    // Read the persisted observe-seq counters. These survive server restart,
    // so the inert-mode warning doesn't reset when the user relaunches.
    const seqRow = db.prepare(
      'SELECT seq, last_claims_received_seq FROM reasoning_observe_seq WHERE companion_id = ?'
    ).get(row.id) as { seq: number; last_claims_received_seq: number } | undefined;

    const totalObserves = seqRow?.seq ?? 0;
    const lastClaimsSeq = seqRow?.last_claims_received_seq ?? 0;

    if (totalObserves === 0) {
      return { id: 'reasoning.max', status: 'ok', label: 'Max mode', detail: 'on (no observes yet)' };
    }

    // If we've had INERT_MAX_WARN_OBSERVES observes and never received claims,
    // the host isn't honoring the extraction prompt.
    if (totalObserves >= REASONING_CONFIG.INERT_MAX_WARN_OBSERVES && lastClaimsSeq === 0) {
      return {
        id: 'reasoning.max', status: 'warn', label: 'Max mode',
        detail: `on, but 0 claims received in ${totalObserves} observes`,
        suggestion: 'Host may not be honoring the max-mode extraction prompt. Verified hosts: Claude Code (Sonnet/Opus). See README for host requirements.',
      };
    }

    // Per-run telemetry supplies richer detail when available (counts don't
    // persist across restart but are informative when they exist).
    const stats = telemetry.snapshot();
    const extra = stats.claims_received_total > 0
      ? ` · this run: ${stats.claims_received_total} claims, ${stats.findings_surfaced_total} findings`
      : '';
    return {
      id: 'reasoning.max', status: 'ok', label: 'Max mode',
      detail: `on · ${totalObserves} observes, last claims at seq ${lastClaimsSeq}${extra}`,
    };
  } catch {
    return { id: 'reasoning.max', status: 'fail', label: 'Max mode', detail: 'DB query failed' };
  }
}

function checkReasoningStorage(): DiagnosticCheck {
  try {
    const c = (db.prepare('SELECT count(*) as n FROM reasoning_claims').get() as any)?.n ?? 0;
    const s = (db.prepare('SELECT count(DISTINCT session_id) as n FROM reasoning_claims').get() as any)?.n ?? 0;
    if (c === 0) {
      return { id: 'reasoning.storage', status: 'ok', label: 'Stored claims', detail: '0 claims · 0 sessions' };
    }
    const oldest = (db.prepare('SELECT min(created_at) as t FROM reasoning_claims').get() as any)?.t;
    const oldestDays = oldest ? Math.floor((Date.now() - oldest) / (24 * 60 * 60 * 1000)) : 0;
    return {
      id: 'reasoning.storage', status: 'ok', label: 'Stored claims',
      detail: `${c} claims across ${s} session(s); oldest ${oldestDays}d ago. Purge via buddy_forget.`,
    };
  } catch {
    return { id: 'reasoning.storage', status: 'fail', label: 'Stored claims', detail: 'DB query failed' };
  }
}

function checkReasoningRootResolution(): DiagnosticCheck {
  try {
    const row = db.prepare('SELECT max_mode FROM companions LIMIT 1').get() as any;
    if (!row || (row.max_mode ?? 0) === 0) {
      return { id: 'reasoning.root', status: 'skip', label: 'Workspace root', detail: 'Max mode off' };
    }
    const s = telemetry.snapshot().root_source_counts;
    const total = s.hint + s.env + s.marker + s.cwd + s.homedir;
    if (total === 0) {
      return { id: 'reasoning.root', status: 'ok', label: 'Workspace root', detail: 'on · no observes yet this run' };
    }
    // If MOST observes this run resolved to the homedir, workspace isolation
    // is almost certainly broken — every project collapses into one graph.
    if (s.homedir > 0 && s.homedir / total > 0.5) {
      return {
        id: 'reasoning.root', status: 'warn', label: 'Workspace root',
        detail: `${s.homedir}/${total} observes resolved to $HOME — projects are mixing`,
        suggestion: 'Pass `cwd` in buddy_observe calls, or set CLAUDE_PROJECT_DIR/BUDDY_PROJECT_ROOT env var. Buddy walks up from cwd looking for .git/package.json markers automatically when launched from a project.',
      };
    }
    const parts: string[] = [];
    if (s.hint) parts.push(`hint=${s.hint}`);
    if (s.env) parts.push(`env=${s.env}`);
    if (s.marker) parts.push(`marker=${s.marker}`);
    if (s.cwd) parts.push(`cwd=${s.cwd}`);
    if (s.homedir) parts.push(`homedir=${s.homedir}`);
    return { id: 'reasoning.root', status: 'ok', label: 'Workspace root', detail: `sources: ${parts.join(', ')}` };
  } catch {
    return { id: 'reasoning.root', status: 'fail', label: 'Workspace root', detail: 'DB query failed' };
  }
}

function checkReasoningBasisQuality(): DiagnosticCheck {
  try {
    const row = db.prepare('SELECT max_mode FROM companions LIMIT 1').get() as any;
    if (!row || (row.max_mode ?? 0) === 0) {
      return { id: 'reasoning.quality', status: 'skip', label: 'Extraction quality', detail: 'Max mode off' };
    }
    const h = basisDistributionHealth();
    if (h.sample < 20) {
      return { id: 'reasoning.quality', status: 'ok', label: 'Extraction quality', detail: `sample too small (${h.sample} claims this run)` };
    }
    if (h.degenerate) {
      const pct = Math.round((h.pct ?? 0) * 100);
      return {
        id: 'reasoning.quality', status: 'warn', label: 'Extraction quality',
        detail: `${pct}% of recent claims classified as "${h.dominantBasis}" — host may be misclassifying`,
        suggestion: `A degenerate basis distribution usually means the host is defaulting every claim to one bucket. Try a more capable host model, or verify the extraction prompt is reaching the model (buddy://intro resource).`,
      };
    }
    return { id: 'reasoning.quality', status: 'ok', label: 'Extraction quality', detail: `${h.sample} claims sampled, dominant basis "${h.dominantBasis}" at ${Math.round((h.pct ?? 0) * 100)}%` };
  } catch {
    return { id: 'reasoning.quality', status: 'fail', label: 'Extraction quality', detail: 'DB query failed' };
  }
}

// ── Runner ──

export function runDiagnostics(): DiagnosticCheck[] {
  return [
    checkNodeVersion(),
    checkPlatform(),
    checkEnvVars(),
    checkPackageVersion(),
    checkInstallLayout(),
    checkCompanionActive(),
    checkCompanionCount(),
    checkCompanionDetails(),
    checkDbExists(),
    checkDbTables(),
    checkStatusFile(),
    checkMcpRegistered(),
    checkMcpEntryPaths(),
    checkStatusline(),
    checkStatuslineRefresh(),
    checkHooks(),
    checkStopHook(),
    checkPromptHook(),
    checkPromptInjection(),
    checkReasoningMaxMode(),
    checkReasoningStorage(),
    checkReasoningRootResolution(),
    checkReasoningBasisQuality(),
  ];
}

// ── Report formatter ──

export function formatReport(checks: DiagnosticCheck[]): string {
  const version = getVersion();
  const now = new Date().toISOString();
  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) counts[c.status]++;

  const summaryParts = [];
  if (counts.ok > 0) summaryParts.push(`${counts.ok} ok`);
  if (counts.warn > 0) summaryParts.push(`${counts.warn} warn`);
  if (counts.fail > 0) summaryParts.push(`${counts.fail} fail`);
  if (counts.skip > 0) summaryParts.push(`${counts.skip} skip`);

  const lines: string[] = [];
  lines.push(`\uD83E\uDE7A Buddy Doctor v${version} \u2014 ${now}`);
  lines.push(`${checks.length} checks: ${summaryParts.join(', ')}`);
  lines.push('\u2550'.repeat(48));
  lines.push('');

  // Group checks by section
  const sections: Record<string, DiagnosticCheck[]> = {
    'ENVIRONMENT': checks.filter(c => c.id.startsWith('env.') || c.id.startsWith('pkg.') || c.id.startsWith('install.')),
    'COMPANION': checks.filter(c => c.id.startsWith('companion.')),
    'DATABASE': checks.filter(c => c.id.startsWith('db.')),
    'STATUS FILE': checks.filter(c => c.id.startsWith('status.')),
    'HOST INTEGRATION': checks.filter(c => c.id.startsWith('mcp.') || c.id.startsWith('config.') || c.id.startsWith('prompt.')),
    'REASONING LAYER': checks.filter(c => c.id.startsWith('reasoning.')),
  };

  for (const [section, sectionChecks] of Object.entries(sections)) {
    lines.push(section);
    for (const c of sectionChecks) {
      const pad = 15 - c.label.length;
      lines.push(`  ${c.label}:${' '.repeat(Math.max(1, pad))}${c.detail}`);
    }
    lines.push('');
  }

  // Summary
  const issues = checks.filter(c => c.status === 'fail' || c.status === 'warn');
  lines.push('SUMMARY');
  if (issues.length === 0) {
    lines.push(`  \u2713 All ${checks.length} checks passed \u2014 Buddy is healthy!`);
  } else {
    const fails = checks.filter(c => c.status === 'fail');
    const warns = checks.filter(c => c.status === 'warn');
    const parts = [];
    if (fails.length > 0) parts.push(`${fails.length} fail`);
    if (warns.length > 0) parts.push(`${warns.length} warn`);
    lines.push(`  \u2717 ${parts.join(', ')}:`);
    let idx = 1;
    for (const c of issues) {
      lines.push(`    ${idx}. [${c.id}] ${c.label}: ${c.detail}`);
      if (c.suggestion) lines.push(`       \u2192 ${c.suggestion}`);
      idx++;
    }
  }

  return lines.join('\n');
}
