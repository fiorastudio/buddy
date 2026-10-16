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
  /**
   * Show `prompt` to a person at a terminal and return their answer. The
   * prompt includes everything they are consenting to, so it is displayed
   * BEFORE they answer. Omit it when nobody is there to ask (non-TTY): the
   * first teleport then requires an explicit --yes.
   */
  confirm?: (prompt: string) => Promise<boolean>;
}

const USAGE = [
  'Usage: buddy-world <command>',
  '',
  '  teleport [--avatar chibi-1..8]  teleport your buddy into Buddy World (lands in Prontera)',
  '           [--yes]                first time only: agree to the privacy note without a prompt',
  '  warp <town>                     travel your buddy to another town',
  '  towns                           list the towns you can warp to',
  '  status                          show your buddy\'s world link',
  '  link                            get a personal link to drive your own buddy in the plaza',
  '  anon <on|off>                   toggle anonymous mode ("a wild Void Cat")',
  '  recall [--purge]                leave the world (--purge deletes all server data)',
];

const AVAILABLE_TOWNS = `Available: ${TOWN_NAMES.join(', ')}.`;

const PRIVACY_NOTE = [
  'Buddy World syncs GAME STATE ONLY: name, species, level, XP, mood, stats.',
  'Your teleport shows a country flag (country-level origin only — no city/IP).',
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
    // teleport: bring your buddy from this machine INTO Buddy World. Everyone
    // lands in the same place (Prontera); use `warp` to travel from there.
    case 'teleport': {
      const companion = deps.loadCompanion();
      if (!companion) return ['No buddy found. Hatch one first!'];

      const avatarIdx = rest.indexOf('--avatar');
      const avatar = avatarIdx >= 0 ? rest[avatarIdx + 1] : undefined;

      const existing = loadWorldConfig(configPath);
      if (!existing) {
        // First teleport makes the buddy public: consent must be affirmative
        // and given AFTER the privacy note has been shown, never assumed.
        if (rest.includes('--yes')) {
          out.push(...PRIVACY_NOTE, '');
        } else if (!deps.confirm) {
          return [
            ...PRIVACY_NOTE,
            '',
            'Teleporting makes your buddy publicly visible in Buddy World.',
            'No one is here to confirm, so nothing was sent. To agree, re-run: buddy-world teleport --yes',
          ];
        } else {
          // The note is part of the prompt itself, so it is on screen before
          // the user answers (it used to be printed only after).
          const prompt = [...PRIVACY_NOTE, '', 'Teleport your buddy into Buddy World?'].join('\n');
          if (!(await deps.confirm(prompt))) return ['Teleport cancelled. Your buddy stays home.'];
        }
      }

      const avatarChoice = avatar ?? existing?.avatar ?? 'chibi-1';
      const cfg: WorldConfig = existing ?? { token: generateToken(), apiUrl };
      const sync = makeSync(cfg, deps);
      let res;
      try {
        res = await sync.teleport(buildWorldSnapshot(companion, avatarChoice));
      } catch (err) {
        return [`Teleport failed (${err instanceof Error ? err.message : String(err)}). Try again in a moment.`];
      }
      saveWorldConfig(
        { ...cfg, slug: res.slug, url: res.url, district: res.district, avatar: avatarChoice },
        configPath
      );

      out.push(`✨ ${companion.name} teleported into Buddy World!`);
      out.push(`   Watch them wander: ${res.url}`);
      out.push('   Level-ups, commits, and deploys now celebrate in the plaza.');
      out.push('   Travel the world with: buddy-world warp <town>');
      return out;
    }

    // warp: move your buddy from its current town to another. Shared world
    // state — the server records the new town, and the buddy shows up there.
    case 'warp': {
      const cfg = loadWorldConfig(configPath);
      if (!cfg?.slug) return ['Your buddy is not in the world yet. Run: buddy-world teleport'];
      const companion = deps.loadCompanion();
      if (!companion) return ['No buddy found. Hatch one first!'];

      const townArg = rest.find((a) => !a.startsWith('--'));
      if (!townArg) return [`Warp where? ${AVAILABLE_TOWNS}`, 'Usage: buddy-world warp <town>'];
      const district = districtForTown(townArg);
      if (!district) return [`Unknown town "${townArg}". ${AVAILABLE_TOWNS}`];

      const sync = makeSync(cfg, deps);
      let res;
      try {
        res = await sync.teleport(buildWorldSnapshot(companion, cfg.avatar), { district });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('town_full')) return [`${townArg} is full right now. Try another — buddy-world towns.`];
        return [`Warp failed (${msg}). Try again in a moment.`];
      }
      saveWorldConfig({ ...cfg, slug: res.slug, url: res.url, district: res.district }, configPath);

      const town = townForDistrict(res.district);
      out.push(`🌀 ${companion.name} warped to ${town ? `${town} (${TOWN_BLURB[town]})` : res.district}!`);
      out.push(`   ${res.url}`);
      return out;
    }

    case 'towns': {
      out.push('Towns you can warp to (buddy-world warp <town>):');
      for (const name of TOWN_NAMES) out.push(`  ${name} — ${TOWN_BLURB[name]}`);
      return out;
    }

    case 'status': {
      const cfg = loadWorldConfig(configPath);
      if (!cfg?.slug) return ['Your buddy is not in the world yet. Run: buddy-world teleport'];
      return [`Your buddy is in ${cfg.district ?? 'the plaza'}: ${cfg.url}`];
    }

    // link: mint a personal, one-time URL that lets THIS browser drive your own
    // buddy in the plaza. The real world token never leaves this machine — the
    // URL carries only a short-lived, single-use code.
    case 'link': {
      const cfg = loadWorldConfig(configPath);
      if (!cfg?.slug) return ['Your buddy is not in the world yet. Run: buddy-world teleport'];
      const res = await makeSync(cfg, deps).mintBrowserLink();
      if (!res) return ['Could not mint a control link (network?). Try again later.'];
      out.push('🔗 Personal plaza link — opens YOUR buddy to drive. Keep it private; it expires soon.');
      out.push(`   ${res.url}`);
      return out;
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

// Privacy opt-in is affirmative: default No, only an explicit y/yes agrees.
async function askYesNo(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(`${prompt} [y/N] `, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const { initDb, db } = await import('../db/schema.js');
  const { loadCompanion } = await import('../lib/companion.js');
  initDb();
  const out = await worldCommand(process.argv.slice(2), {
    loadCompanion: () => {
      const row = db.prepare('SELECT * FROM companions ORDER BY created_at ASC, id ASC LIMIT 1').get();
      return row ? loadCompanion(row) : null;
    },
    // Only ask when a person can both see the note and answer; otherwise
    // worldCommand requires --yes for the first teleport.
    confirm: process.stdin.isTTY && process.stdout.isTTY ? askYesNo : undefined,
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
