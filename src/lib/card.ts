// src/lib/card.ts — extracted rendering (ASCII card, hatch animation, rescue animation)

import { renderSprite } from './species.js';
import { type Companion, STAT_NAMES, RARITY_STARS } from './types.js';
import { statBar } from './rng.js';
import { levelProgress } from './leveling.js';

/**
 * Render a bordered ASCII stat card for a companion.
 */
export function renderCard(companion: Companion): string {
  const art = renderSprite(companion);
  const stars = RARITY_STARS[companion.rarity];
  const statLines = STAT_NAMES.map(s => statBar(s, companion.stats[s]));

  const cardWidth = 44;
  const inner = cardWidth - 4;
  const topBorder = '.' + '_'.repeat(cardWidth - 2) + '.';
  const bottomBorder = "'" + '_'.repeat(cardWidth - 2) + "'";
  const emptyLine = '| ' + ' '.repeat(inner) + ' |';
  const ln = (text: string) => '| ' + text.padEnd(inner) + ' |';

  const headerLeft = `${stars} ${companion.rarity.toUpperCase()}`;
  const headerRight = companion.species.toUpperCase();
  const headerGap = inner - headerLeft.length - headerRight.length;
  const headerLine = ln(headerLeft + ' '.repeat(Math.max(1, headerGap)) + headerRight);

  const bioLines: string[] = [];
  if (companion.personalityBio) {
    const bioText = `"${companion.personalityBio}"`;
    const words = bioText.split(' ');
    let cur = '';
    for (const w of words) {
      if (cur.length + w.length + 1 > inner - 2 && cur) {
        bioLines.push(ln(' ' + cur));
        cur = w;
      } else {
        cur = cur ? `${cur} ${w}` : w;
      }
    }
    if (cur) bioLines.push(ln(' ' + cur));
  }

  const card = [
    topBorder,
    headerLine,
    emptyLine,
    ...art.map(l => ln(l)),
    emptyLine,
    ln(companion.name),
    ...(bioLines.length > 0 ? [emptyLine, ...bioLines] : []),
    emptyLine,
    ...statLines.map(l => ln(l)),
    emptyLine,
    (() => {
      const { level, currentXp, neededXp } = levelProgress(companion.xp);
      const lvlLine = level >= 50 ? 'Lv.50 MAX' : `Lv.${level} \u00b7 ${currentXp}/${neededXp} XP to next`;
      return ln(lvlLine);
    })(),
    bottomBorder,
  ].join('\n');
  return '```\n' + card + '\n```';
}

/**
 * Render the full hatch animation sequence + card.
 */
export function hatchAnimation(companion: Companion): string {
  const egg1 = [
    '        ',
    '   .--. ',
    '  /    \\',
    ' |  ??  |',
    '  \\    /',
    "   '--' ",
  ].join('\n');

  const egg2 = [
    '    *   ',
    '   .--. ',
    '  / *  \\',
    ' | \\??/ |',
    '  \\  * /',
    "   '--' ",
  ].join('\n');

  const egg3 = [
    '  * . * ',
    '   ,--. ',
    '  / /\\ \\',
    ' | |??| |',
    '  \\ \\/ /',
    "   `--\u00b4 ",
  ].join('\n');

  const egg4 = [
    ' \\* . */  ',
    '  \\,--./  ',
    '   /  \\   ',
    '  | ?? |  ',
    '   \\  /   ',
    "    `\u00b4    ",
  ].join('\n');

  const art = renderSprite(companion);
  const hatched = [
    '  \u00b7  \u2726  \u00b7 ',
    ' \u2726 \u00b7  \u00b7 \u2726 ',
    ...art,
    ' \u2726 \u00b7  \u00b7 \u2726 ',
    '  \u00b7  \u2726  \u00b7 ',
  ].join('\n');

  const card = renderCard(companion);

  const footer = [
    '',
    `${companion.name} is here \u00b7 it'll chime in as you code`,
    `uses the same AI subscription you're on`,
    `say its name to get its take \u00b7 /buddy pet \u00b7 /buddy off`,
  ].join('\n');

  const output = [
    '\uD83E\uDD5A An egg appears...\n',
    egg1,
    '\n...something is moving!\n',
    egg2,
    '\n...cracks are forming!\n',
    egg3,
    '\n...it\'s hatching!!\n',
    egg4,
    '\n\u2728 \u2728 \u2728\n',
    hatched,
    '\n',
    card,
    footer,
  ].join('\n');
  return '```\n' + output + '\n```';
}

/**
 * Render a rescue animation (signal found -> companion appears).
 */
export function rescueAnimation(companion: Companion): string {
  const signal1 = [
    '      .',
    '    . | .',
    '      |',
    '   [SIGNAL]',
    '      |',
    '   ...scanning...',
  ].join('\n');

  const signal2 = [
    '   )) . ((',
    '    ).|.(  ',
    '     |||   ',
    '  [FOUND!] ',
    '     |||   ',
    '  ...locked on...',
  ].join('\n');

  const art = renderSprite(companion);
  const rescued = [
    '  \u00b7  \u2726  \u00b7 ',
    ' \u2726 \u00b7  \u00b7 \u2726 ',
    ...art,
    ' \u2726 \u00b7  \u00b7 \u2726 ',
    '  \u00b7  \u2726  \u00b7 ',
  ].join('\n');

  const card = renderCard(companion);

  const footer = [
    '',
    `${companion.name} has been rescued! Welcome home.`,
    `it'll chime in as you code`,
    `say its name to get its take \u00b7 /buddy pet \u00b7 /buddy off`,
  ].join('\n');

  const output = [
    '\uD83D\uDCE1 Scanning for lost companions...\n',
    signal1,
    '\n...signal detected!\n',
    signal2,
    '\n\u2728 \u2728 \u2728\n',
    rescued,
    '\n',
    card,
    footer,
  ].join('\n');
  return '```\n' + output + '\n```';
}
