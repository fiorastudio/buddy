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
import { TOWN_NAMES, TOWN_BLURB, districtForTown, townForDistrict } from '../lib/world/towns.js';

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
  '  teleport [town] [--avatar chibi-1..8]  beam your buddy into a town (default: auto)',
  '  towns                           list the RO cities you can teleport to',
  '  status                          show your buddy\'s world link',
  '  anon <on|off>                   toggle anonymous mode ("a wild Void Cat")',
  '  recall [--purge]                leave the world (--purge deletes all server data)',
];

const AVAILABLE_TOWNS = `Available: ${TOWN_NAMES.join(', ')}.`;

const PRIVACY_NOTE = [
  'Buddy World syncs GAME STATE ONLY: name, species, level, XP, mood, stats.',
  'Never your code, prompts, or messages. Anonymous mode: buddy-world anon on.',
  'Leave anytime: buddy-world recall --purge removes everything server-side.',
];

function makeSync(cfg: WorldConfig, deps: WorldCliDeps): WorldSync {
  return new WorldSync(cfg, deps.fetchFn ? { fetchFn: deps.fetchFn } : {});
}

// Levenshtein distance, for "did you mean" suggestions on a typo'd town.
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Forgiving CLI-side town resolution so owners don't have to spell it exactly:
 * exact name / plaza-N (via districtForTown), then a unique case-insensitive
 * prefix ("gef" → Geffen), else the closest name as a "did you mean" hint.
 * The SERVER stays strict — the CLI always resolves to a canonical plaza-N first.
 */
export function matchTown(input: string): { district: string } | { suggestion: string } {
  const strict = districtForTown(input);
  if (strict) return { district: strict };
  const s = input.trim().toLowerCase();
  const prefix = TOWN_NAMES.filter((t) => t.toLowerCase().startsWith(s));
  if (s.length >= 2 && prefix.length === 1) return { district: districtForTown(prefix[0])! };
  const closest = [...TOWN_NAMES].sort(
    (a, b) => editDistance(s, a.toLowerCase()) - editDistance(s, b.toLowerCase())
  )[0];
  return { suggestion: closest };
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

      const avatarIdx = rest.indexOf('--avatar');
      const avatar = avatarIdx >= 0 ? rest[avatarIdx + 1] : undefined;
      // First positional that isn't a flag or the --avatar value = the town.
      const townArg = rest.find((a, i) => !a.startsWith('--') && !(avatarIdx >= 0 && i === avatarIdx + 1));

      // Resolve the chosen town up front — reject a bad name before any network
      // call or config write.
      let desiredDistrict: string | undefined;
      if (townArg) {
        const m = matchTown(townArg);
        if ('suggestion' in m) return [`Unknown town "${townArg}". Did you mean ${m.suggestion}? ${AVAILABLE_TOWNS}`];
        desiredDistrict = m.district;
      }

      const existing = loadWorldConfig(configPath);
      if (!existing) {
        out.push(...PRIVACY_NOTE);
        const confirm = deps.confirm ?? (async () => true);
        if (!(await confirm('Teleport your buddy into Buddy World?'))) {
          out.push('Teleport cancelled. Your buddy stays home.');
          return out;
        }
      }

      const avatarChoice = avatar ?? existing?.avatar ?? 'chibi-1';
      const cfg: WorldConfig = existing ?? { token: generateToken(), apiUrl };
      const sync = makeSync(cfg, deps);
      let res;
      try {
        res = await sync.teleport(buildWorldSnapshot(companion, avatarChoice), { district: desiredDistrict });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('town_full') && townArg) {
          return [`${townArg} is full right now. Pick another — buddy-world towns.`];
        }
        return [`Teleport failed (${msg}). Try again in a moment.`];
      }
      saveWorldConfig(
        { ...cfg, slug: res.slug, url: res.url, district: res.district, avatar: avatarChoice },
        configPath
      );

      const town = townForDistrict(res.district);
      const where = town ? `${town} (${TOWN_BLURB[town]})` : 'the plaza';
      out.push(`✨ ${companion.name} warped to ${where}!`);
      out.push(`   Watch them wander: ${res.url}`);
      out.push('   Level-ups, commits, and deploys now celebrate in the plaza.');
      return out;
    }

    case 'towns': {
      out.push('Towns you can teleport to (buddy-world teleport <town>):');
      for (const name of TOWN_NAMES) out.push(`  ${name} — ${TOWN_BLURB[name]}`);
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
      const ok = await makeSync(cfg, deps).recall(purge);
      if (!ok) {
        // Never delete the only token on an unconfirmed server call — the
        // user would lose the ability to purge their data later.
        return ['Could not reach Buddy World to recall — your token is kept so you can try again.'];
      }
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
