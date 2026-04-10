import { levelProgress } from './leveling.js';
import { RARITY_STARS, type Rarity } from './types.js';

export type CodexBuddyStatus = {
  name: string;
  species: string;
  level: number;
  xp: number;
  mood?: string;
  rarity?: Rarity;
  rarity_stars?: string;
  is_shiny?: boolean;
  reaction_text?: string;
  reaction_indicator?: string;
  reaction_expires?: number;
};

const MINI_ICONS: Record<string, string> = {
  'Void Cat': `|\\---/|`,
  'Rust Hound': `/\\_/\\\\`,
  'Data Drake': `/\\^/\\\\`,
  'Log Golem': `[::::]`,
  'Cache Crow': `\\v/`,
  'Shell Turtle': `(___)`,
  'Duck': `--`,
  'Goose': `(·>`,
  'Blob': `(~~)`,
  'Octopus': `\\(o.o)/`,
  'Owl': `(o,o)`,
  'Penguin': `.---.`,
  'Snail': `@_/'`,
  'Ghost': `,_,`,
  'Axolotl': `(:>`,
  'Capybara': `(===)`,
  'Cactus': `[++]`,
  'Robot': `[::]`,
  'Rabbit': `()/)`,
  'Mushroom': `.-o-OO-o-.`,
  'Chonk': `(____)`,
};

const MINI_BODIES: Record<string, string> = {
  'Void Cat': `| o o |`,
  'Rust Hound': `|| ||`,
  'Data Drake': `\\\\_//`,
  'Log Golem': `[____]`,
  'Cache Crow': `\\__/`,
  'Shell Turtle': `(_^_)`,
  'Duck': `<(·)___`,
  'Goose': `_(__)_`,
  'Blob': `(___)`,
  'Octopus': ` /|\\\\ `,
  'Owl': `/)__)`,
  'Penguin': `(·>·)`,
  'Snail': `(___)`,
  'Ghost': `(   )`,
  'Axolotl': `(:::)`,
  'Capybara': `(____)`,
  'Cactus': `| || |`,
  'Robot': `[__]`,
  'Rabbit': `('')`,
  'Mushroom': `(__________)`,
  'Chonk': `|____|`,
};

const AMBIENT_TEXT: Record<string, string[]> = {
  'Void Cat': ['judging your code', 'staring into void', 'plotting silently'],
  'Rust Hound': ['sniffing for bugs', 'guarding the repo', 'chasing a pointer'],
  'Data Drake': ['hoarding abstractions', 'sorting interfaces', 'guarding the architecture'],
  'Log Golem': ['processing stack traces', 'reciting status codes', 'holding the line'],
  'Cache Crow': ['stealing good patterns', 'watching cache hits', 'hoarding snippets'],
  'Shell Turtle': ['reviewing carefully', 'moving slow, shipping safe', 'triple-checking deploys'],
  'Duck': ['rubber ducking', 'waddling in place', 'quacking softly'],
  'Goose': ['eyeing your code', 'standing guard', 'scheming'],
  'Blob': ['adapting quietly', 'squishing through modules', 'absorbing the framework'],
  'Octopus': ['untangling dependencies', 'multi-tasking aggressively', 'wrapping around the problem'],
  'Owl': ['reviewing after midnight', 'watching the patterns', 'judging your docs'],
  'Penguin': ['enforcing interfaces', 'keeping it structured', 'refusing to use any'],
  'Snail': ['reading every line', 'taking geological time', 'leaving review trails'],
  'Ghost': ['haunting your logs', 'flickering softly', 'phasing through code'],
  'Axolotl': ['regrowing morale', 'recovering from rollback', 'wiggling optimistically'],
  'Capybara': ['keeping things calm', 'de-escalating incidents', 'bringing peaceful vibes'],
  'Cactus': ['delivering tough love', 'flowering under pressure', 'growing through critique'],
  'Robot': ['processing...', 'scanning code', 'quantifying the damage'],
  'Rabbit': ['ready to critique', 'thumping softly', 'moving too fast'],
  'Mushroom': ['decomposing problems', 'spreading spores', 'growing quietly'],
  'Chonk': ['taking up space', 'sitting on the keyboard', 'owning the room'],
};

function isReactionActive(status: CodexBuddyStatus, now: number): boolean {
  return typeof status.reaction_expires === 'number' && status.reaction_expires > now;
}

function rarityStars(status: CodexBuddyStatus): string {
  if (status.rarity_stars) return status.rarity_stars;
  if (status.rarity) return RARITY_STARS[status.rarity];
  return '';
}

function miniIcon(species: string): string {
  return MINI_ICONS[species] || '(-)';
}

function miniBody(species: string): string {
  return MINI_BODIES[species] || '(___)';
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 1)}…`;
}

function ambientText(species: string, xp: number): string {
  const pool = AMBIENT_TEXT[species] || ['watching your cursor', 'vibing quietly', 'counting semicolons'];
  return pool[Math.abs(xp) % pool.length];
}

export function renderCodexStatusline(status: CodexBuddyStatus, now = Date.now()): string[] {
  const stars = rarityStars(status);
  const shiny = status.is_shiny ? ' ✨' : '';
  const levelLabel = Number.isFinite(status.level) ? `Lv.${status.level}` : 'Lv.?';
  const reactionActive = isReactionActive(status, now);
  const progress = levelProgress(Math.max(0, status.xp || 0));
  const xpLabel = progress.level >= 50 ? 'MAX' : `${progress.currentXp}/${progress.neededXp} XP`;
  const line1 = [
    miniIcon(status.species),
    status.name,
    `(${status.species})`,
    levelLabel,
  ].filter(Boolean).join(' ');

  if (reactionActive && status.reaction_text) {
    const line2 = [
      miniBody(status.species),
      truncate(`${status.reaction_indicator || '·'} ${status.reaction_text}`, 42),
    ].join('  ');
    return [line1, line2];
  }

  const line2 = [
    miniBody(status.species),
    status.mood || 'present',
    `XP:${status.xp || 0}`,
    `${stars}${shiny}`.trim(),
    `· ${ambientText(status.species, status.xp || 0)}`,
  ].filter(Boolean).join(' ');
  return [line1, line2];
}
