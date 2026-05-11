// src/lib/reasoning/extraction-key.ts
//
// Resolves the Anthropic API key AND model used for hook-driven claim
// extraction. Lookup order for the key, first hit wins:
//   1. process.env.BUDDY_EXTRACTION_KEY  — buddy-specific override
//   2. process.env.ANTHROPIC_API_KEY     — standard SDK env var
//   3. ~/.buddy/config.json              — buddy's own config file
//   4. <CLAUDE_PROJECT_DIR>/.env         — per-project dotenv
//
// Model lookup follows the same priority but only env + config (no dotenv).
//
// We deliberately do NOT read ~/.claude/settings.json. Claude Code uses OAuth
// in the common case — there's no raw key there to find. Walking that JSON
// for arbitrarily-set MCP env vars is brittle.
//
// `null` key return means: guard mode falls back to today's behavior
// (model-driven extraction via buddy_observe). The caller must NOT throw;
// absence of a key is normal.

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Path is computed lazily so tests can override HOME between cases. We prefer
// `process.env.HOME` when set (POSIX) because some Node call sites cache the
// `os.homedir()` syscall result across the process lifetime — the env var
// gives a fresh read every call. `homedir()` is the fallback for environments
// where HOME isn't set (e.g. Windows builds reading USERPROFILE).
function configPath(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, '.buddy', 'config.json');
}

export type KeySource = 'env_buddy' | 'env_anthropic' | 'config_file' | 'project_dotenv' | null;

export type ResolvedKey = {
  key: string | null;
  source: KeySource;
};

export function resolveExtractionKey(): ResolvedKey {
  const buddyEnv = process.env.BUDDY_EXTRACTION_KEY;
  if (typeof buddyEnv === 'string' && buddyEnv.trim()) {
    return { key: buddyEnv.trim(), source: 'env_buddy' };
  }

  const anthropicEnv = process.env.ANTHROPIC_API_KEY;
  if (typeof anthropicEnv === 'string' && anthropicEnv.trim()) {
    return { key: anthropicEnv.trim(), source: 'env_anthropic' };
  }

  const fromConfig = readConfigKey();
  if (fromConfig) return { key: fromConfig, source: 'config_file' };

  const fromProject = readProjectDotenv();
  if (fromProject) return { key: fromProject, source: 'project_dotenv' };

  return { key: null, source: null };
}

function readConfigKey(): string | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    const k = parsed?.extraction?.api_key;
    if (typeof k === 'string' && k.trim()) return k.trim();
  } catch { /* malformed config — silent */ }
  return null;
}

// ── model resolution ─────────────────────────────────────────────────

/**
 * Resolve the model name used for the extraction call. Default
 * `claude-haiku-4-5` is the cheapest model that handles structured
 * extraction reliably; users who want higher claim quality can override
 * to a Sonnet build via env or config.
 *
 * Returns `null` if nothing is set so callers can apply their own default
 * (the SDK call site uses `claude-haiku-4-5`).
 */
export function resolveExtractionModel(): string | null {
  const fromEnv = process.env.BUDDY_EXTRACTION_MODEL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();

  try {
    const raw = readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const m = parsed?.extraction?.model;
    if (typeof m === 'string' && m.trim()) return m.trim();
  } catch { /* missing or malformed — fine */ }

  return null;
}

function readProjectDotenv(): string | null {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) return null;
  const dotenvPath = join(projectDir, '.env');
  if (!existsSync(dotenvPath)) return null;
  try {
    const raw = readFileSync(dotenvPath, 'utf-8');
    // Minimal parser: key=value or key="value", first match wins.
    // Avoid pulling in a dotenv dep; we only need one variable.
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key !== 'ANTHROPIC_API_KEY') continue;
      let value = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes if present.
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  } catch { /* unreadable — silent */ }
  return null;
}
