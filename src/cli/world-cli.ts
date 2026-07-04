// src/cli/world-cli.ts
// buddy-world: teleport your buddy into the shared plaza (Buddy World).
// All orchestration lives in worldCommand() so tests can inject the
// companion source, fetch, and config path; main() is the thin argv shell.

import { createInterface } from 'node:readline';
import {
  WorldSync,
  buildWorldSnapshot,
  generateToken,
  loadWorldConfig,
  saveWorldConfig,
  deleteWorldConfig,
  DEFAULT_WORLD_CONFIG_PATH,
  DEFAULT_API_URL,
  type WorldConfig,
} from '../lib/world/client.js';
import type { Companion } from '../lib/types.js';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface WorldCliDeps {
  loadCompanion: () => Companion | null;
  fetchFn?: FetchLike;
  configPath?: string;
  apiUrl?: string;
  confirm?: (prompt: string) => Promise<boolean>;
}

const USAGE = [
  'Usage: buddy-world <command>',
  '',
  '  teleport [--avatar chibi-1..8]  opt in and beam your buddy into the plaza',
  '  status                          show your buddy\'s world link',
  '  anon <on|off>                   toggle anonymous mode ("a wild Void Cat")',
  '  recall [--purge]                leave the world (--purge deletes all server data)',
];

const PRIVACY_NOTE = [
  'Buddy World syncs GAME STATE ONLY: name, species, level, XP, mood, stats.',
  'Never your code, prompts, or messages. Anonymous mode: buddy-world anon on.',
  'Leave anytime: buddy-world recall --purge removes everything server-side.',
];

function makeSync(cfg: WorldConfig, deps: WorldCliDeps): WorldSync {
  return new WorldSync(cfg, deps.fetchFn ? { fetchFn: deps.fetchFn } : {});
}

export async function worldCommand(argv: string[], deps: WorldCliDeps): Promise<string[]> {
  const configPath = deps.configPath ?? DEFAULT_WORLD_CONFIG_PATH;
  const apiUrl = deps.apiUrl ?? DEFAULT_API_URL;
  const [cmd, ...rest] = argv;
  const out: string[] = [];

  switch (cmd) {
    case 'teleport': {
      const companion = deps.loadCompanion();
      if (!companion) return ['No buddy found. Hatch one first!'];

      const existing = loadWorldConfig(configPath);
      if (!existing) {
        out.push(...PRIVACY_NOTE);
        const confirm = deps.confirm ?? (async () => true);
        if (!(await confirm('Teleport your buddy into Buddy World?'))) {
          out.push('Teleport cancelled. Your buddy stays home.');
          return out;
        }
      }

      const avatarIdx = rest.indexOf('--avatar');
      const avatar = avatarIdx >= 0 ? rest[avatarIdx + 1] : existing?.avatar ?? 'chibi-1';

      const cfg: WorldConfig = existing ?? { token: generateToken(), apiUrl };
      const sync = makeSync(cfg, deps);
      const res = await sync.teleport(buildWorldSnapshot(companion, avatar));
      saveWorldConfig({ ...cfg, slug: res.slug, url: res.url, district: res.district, avatar }, configPath);

      out.push(`✨ ${companion.name} teleported into Buddy World!`);
      out.push(`   Watch them wander: ${res.url}`);
      out.push('   Level-ups, commits, and deploys now celebrate in the plaza.');
      return out;
    }

    case 'status': {
      const cfg = loadWorldConfig(configPath);
      if (!cfg?.slug) return ['Your buddy is not in the world yet. Run: buddy-world teleport'];
      return [`Your buddy is in ${cfg.district ?? 'the plaza'}: ${cfg.url}`];
    }

    case 'anon': {
      const cfg = loadWorldConfig(configPath);
      if (!cfg) return ['Not teleported yet. Run: buddy-world teleport'];
      const on = rest[0] === 'on';
      if (rest[0] !== 'on' && rest[0] !== 'off') return USAGE;
      const ok = await makeSync(cfg, deps).setAnon(on);
      return ok
        ? [`Anonymous mode ${on ? 'on' : 'off'}: your buddy now appears as ${on ? '"a wild <species>"' : `"${cfg.slug}"`}.`]
        : ['Could not update anonymous mode (network?). Try again later.'];
    }

    case 'recall': {
      const cfg = loadWorldConfig(configPath);
      if (!cfg) return ['Not teleported — nothing to recall.'];
      const purge = rest.includes('--purge');
      await makeSync(cfg, deps).recall(purge);
      deleteWorldConfig(configPath);
      return [`Your buddy has been recalled${purge ? ' and all server data purged' : ''}. Welcome home.`];
    }

    default:
      return USAGE;
  }
}

async function askYesNo(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true; // headless installs opt in explicitly by running the command
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(`${prompt} [Y/n] `, resolve));
  rl.close();
  return !/^n/i.test(answer.trim());
}

async function main() {
  const { initDb, db } = await import('../db/schema.js');
  const { loadCompanion } = await import('../lib/companion.js');
  initDb();
  const out = await worldCommand(process.argv.slice(2), {
    loadCompanion: () => {
      const row = db.prepare('SELECT * FROM companions LIMIT 1').get();
      return row ? loadCompanion(row) : null;
    },
    confirm: askYesNo,
  });
  console.log(out.join('\n'));
}

// Only run main() when executed directly (not when imported by tests).
if (process.argv[1] && /world-cli\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error('buddy-world failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
