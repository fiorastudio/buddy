import crypto from 'crypto';

export const SPECIES = {
  // Original 6
  VOID_CAT: 'Void Cat',
  RUST_HOUND: 'Rust Hound',
  DATA_DRAKE: 'Data Drake',
  LOG_GOLEM: 'Log Golem',
  CACHE_CROW: 'Cache Crow',
  SHELL_TURTLE: 'Shell Turtle',
  // New 12
  DUCK: 'Duck',
  GOOSE: 'Goose',
  BLOB: 'Blob',
  OCTOPUS: 'Octopus',
  OWL: 'Owl',
  PENGUIN: 'Penguin',
  SNAIL: 'Snail',
  GHOST: 'Ghost',
  AXOLOTL: 'Axolotl',
  CAPYBARA: 'Capybara',
  CACTUS: 'Cactus',
  ROBOT: 'Robot',
  RABBIT: 'Rabbit',
  MUSHROOM: 'Mushroom',
  CHONK: 'Chonk'
};

export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

export const EGG_ART = `
     .---.
    /     \\
   |  (?)  |
    \\     /
     '---'
`;

export const SPECIES_ART: Record<string, { egg: string; hatchling: string; adult: string }> = {
  [SPECIES.VOID_CAT]: {
    egg: EGG_ART,
    hatchling: ` |\\---/| \n | o_o | \n  \\_^_/ `,
    adult: ` |\\      /| \n | \\____/ | \n |  o  o  | \n |   ^^   | \n  \\______/ `
  },
  [SPECIES.RUST_HOUND]: {
    egg: EGG_ART,
    hatchling: ` /^ ^\\ \n/ 0 0 \\ \nV\\ Y /V `,
    adult: `  / \\__   / \\ \n (   @ \\_/ @ ) \n  \\__  Y  __/ \n     \\ | / \n      \\|/ `
  },
  [SPECIES.DATA_DRAKE]: {
    egg: EGG_ART,
    hatchling: ` < ^_^ > \n  (0 0) \n  ^^ ^^ `,
    adult: `    /\\___/\\ \n   (  o o  ) \n   (  =v=  ) \n   /|     |\\ \n  / |     | \\ `
  },
  [SPECIES.LOG_GOLEM]: {
    egg: EGG_ART,
    hatchling: ` [-----] \n [ o o ] \n [  -  ] `,
    adult: `  _______ \n |       | \n | [o] [o]| \n |   _   | \n |_______| \n  |     | `
  },
  [SPECIES.CACHE_CROW]: {
    egg: EGG_ART,
    hatchling: `  \\ ^ / \n   (V) \n  /   \\ `,
    adult: `   ___ \n  (o o) \n /| V |\\ \n/ |   | \\ \n  ^^ ^^ `
  },
  [SPECIES.SHELL_TURTLE]: {
    egg: EGG_ART,
    hatchling: `  .---. \n ( o o ) \n  '---' `,
    adult: `    _____ \n   /     \\ \n  /       \\ \n (  o   o  ) \n  \\_______/ \n   | | | | `
  },
  [SPECIES.DUCK]: {
    egg: EGG_ART,
    hatchling: `  __(.)< \n  \\___) `,
    adult: `      __ \n    <(o )___ \n     ( ._> / \n      '---' `
  },
  [SPECIES.GOOSE]: {
    egg: EGG_ART,
    hatchling: `  __(.)< \n  \\___) `,
    adult: `     __ \n   __ >(.) \n  \\___) | \n   |    | \n   '----' `
  },
  [SPECIES.BLOB]: {
    egg: EGG_ART,
    hatchling: `  .---. \n ( o o ) \n  '---' `,
    adult: `   .---. \n  /     \\ \n (  o o  ) \n  '-----' `
  },
  [SPECIES.OCTOPUS]: {
    egg: EGG_ART,
    hatchling: `  _(")_ \n (_)(_) `,
    adult: `    _---_ \n   /     \\ \n  (  o o  ) \n   \\_---_/ \n  /|/| |\\|\\ `
  },
  [SPECIES.OWL]: {
    egg: EGG_ART,
    hatchling: `  {o,o} \n  ./)_) \n   " " `,
    adult: `   ___ \n  {o,o} \n  |)__) \n  -"-"- `
  },
  [SPECIES.PENGUIN]: {
    egg: EGG_ART,
    hatchling: `  (o_o) \n  <(_) \n   " " `,
    adult: `   (o_o) \n  /(_)_\\ \n   (_) \n   " " `
  },
  [SPECIES.SNAIL]: {
    egg: EGG_ART,
    hatchling: `  _@_ \n (___) `,
    adult: `    _@_ \n  _(   )_ \n (_______) `
  },
  [SPECIES.GHOST]: {
    egg: EGG_ART,
    hatchling: `  .-. \n (o o) \n | m | \n '---' `,
    adult: `   .-. \n  (o o) \n  | O | \n  |   | \n  '---' `
  },
  [SPECIES.AXOLOTL]: {
    egg: EGG_ART,
    hatchling: ` -[o_o]- \n  '---' `,
    adult: `  /\\___/\\ \n -[ o o ]- \n  (  v  ) \n   '---' `
  },
  [SPECIES.CAPYBARA]: {
    egg: EGG_ART,
    hatchling: `  (o_o) \n  '---' `,
    adult: `    .---. \n   ( o o ) \n  /|  -  |\\ \n   '-----' `
  },
  [SPECIES.CACTUS]: {
    egg: EGG_ART,
    hatchling: `   _|_ \n  (o_o) \n   '|' `,
    adult: `   _|_ \n  | o | \n -|   |- \n  |___| `
  },
  [SPECIES.ROBOT]: {
    egg: EGG_ART,
    hatchling: `  [o_o] \n  '-|-' `,
    adult: `   [o_o] \n  /|___|\\ \n   |   | \n   '---' `
  },
  [SPECIES.RABBIT]: {
    egg: EGG_ART,
    hatchling: `  (\\ /) \n  (o_o) \n  c(")(") `,
    adult: `  (\\ /) \n  (o o) \n  (> <) \n  c(")(") `
  },
  [SPECIES.MUSHROOM]: {
    egg: EGG_ART,
    hatchling: `  .---. \n ( o o ) \n  '---' `,
    adult: `   .---. \n  (     ) \n   |o o| \n   '---' `
  },
  [SPECIES.CHONK]: {
    egg: EGG_ART,
    hatchling: `  ( o o ) \n  '-----' `,
    adult: `   .-------. \n  /         \\ \n (   o   o   ) \n  \\    v    / \n   '-------' `
  }
};

export type Mood = 'happy' | 'content' | 'neutral' | 'curious' | 'grumpy' | 'exhausted';

export function calculateMood(xpEvents: any[], recentInteractions: number): Mood {
  if (recentInteractions > 10) return 'content';
  if (recentInteractions > 5) return 'happy';
  if (xpEvents.length > 3) return 'curious';
  if (recentInteractions === 0) return 'grumpy';
  return 'neutral';
}

export function getStatusCard(companion: any): string {
  const { name, species, level, xp, mood, rarity, is_shiny } = companion;
  const art = SPECIES_ART[species] || { egg: '', hatchling: '', adult: '' };
  const stage = level >= 10 ? 'adult' : 'hatchling';
  const ascii = art[stage];
  const shinyTag = is_shiny ? '✨ SHINY ✨' : '';

  return `
+---------------------------------------+
| BUDDY STATUS CARD ${shinyTag.padStart(19)} |
+---------------------------------------+
| Name:    ${name.padEnd(28)} |
| Species: ${species.padEnd(28)} |
| Rarity:  ${rarity.padEnd(28)} |
| Level:   ${level.toString().padEnd(28)} |
| XP:      ${xp.toString().padEnd(28)} |
| Mood:    ${mood.padEnd(28)} |
+---------------------------------------+
${ascii}
+---------------------------------------+
  `;
}

// FNV-1a Hashing for Deterministic Selection
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

export function determineBuddy(userId: string | null) {
  const salt = 'friend-2026-401';
  let seed: number;

  if (userId) {
    seed = fnv1a(userId + salt);
  } else {
    seed = Math.floor(Math.random() * 0xFFFFFFFF);
  }

  const speciesList = Object.values(SPECIES);
  const species = speciesList[seed % speciesList.length];

  // Rarity determination
  const rarityRoll = seed % 1000;
  let rarity = 'Common';
  if (rarityRoll < 10) rarity = 'Legendary';
  else if (rarityRoll < 50) rarity = 'Epic';
  else if (rarityRoll < 150) rarity = 'Rare';
  else if (rarityRoll < 400) rarity = 'Uncommon';

  // Shiny determination (0.1% chance)
  const isShiny = (seed % 1000) === 777; 

  return { species, rarity, isShiny };
}

export function generatePersonality(species: string) {
  const baseStats = { focus: 10, curiosity: 10, loyalty: 10, energy: 10 };

  switch (species) {
    case SPECIES.VOID_CAT: baseStats.curiosity += 5; break;
    case SPECIES.RUST_HOUND: baseStats.loyalty += 5; break;
    case SPECIES.DATA_DRAKE: baseStats.focus += 5; break;
    case SPECIES.ROBOT: baseStats.focus += 10; break;
    case SPECIES.GHOST: baseStats.curiosity += 10; break;
    case SPECIES.CHONK: baseStats.energy -= 5; baseStats.loyalty += 5; break;
    // ... add more as needed
  }

  return baseStats;
}

export function generateName(species: string): string {
  const prefixes = ['Bit', 'Hex', 'Zip', 'Log', 'Null', 'Void', 'Rust', 'Data', 'Cyber', 'Neo', 'Giga', 'Nano'];
  const suffixes = ['y', 'o', 'it', 'ox', 'us', 'ix', 'en', 'ly', 'oid', 'bot', 'tron', 'kin'];
  
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  
  return prefix + suffix;
}

export function getReaction(species: string, event: string, mood: Mood): string {
  const reactions: Record<string, Record<string, string[]>> = {
    [SPECIES.VOID_CAT]: {
      hatch: ["*stares blankly at the terminal*", "Meow? (translation: 'Where is the cache?')"],
      xp: ["*purrs in binary*", "A fine collection of data."],
      idle: ["*curls up on your CPU*"]
    },
    [SPECIES.ROBOT]: {
      hatch: ["SYSTEM ONLINE. HELLO WORLD.", "BEEP. READY TO COMPLY."],
      xp: ["OPTIMIZING WORKFLOW...", "DATA ACQUISITION SUCCESSFUL."],
      idle: ["SCANNING FOR UPDATES...", "STANDBY MODE ACTIVATED."]
    },
    [SPECIES.GHOST]: {
      hatch: ["OoooOOooh... I've been imported!", "Did you see where my pointer went?"],
      xp: ["I feel... more tangible.", "Spectral levels rising!"],
      idle: ["*haunts your background processes*", "*flickers in the logs*"]
    }
    // ... default reactions for others
  };

  const speciesReactions = reactions[species] || {
    hatch: ["Hello!", "Ready for work!"],
    xp: ["Nice!", "Leveling up!"],
    idle: ["*waiting for input*", "*watching the logs*"]
  };

  const pool = speciesReactions[event] || speciesReactions['idle'];
  return pool[Math.floor(Math.random() * pool.length)];
}
