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
  CHONK: 'Chonk',
  NUZZLECAP: 'Nuzzlecap'
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
    adult: `   .---. \n  ( . . ) \n   |___| \n   '---' `
  },
  [SPECIES.NUZZLECAP]: {
    egg: EGG_ART,
    hatchling: `  .---. \n ( - - ) \n  '---' \n   (w) `,
    adult: `   .---. \n  ( * * ) \n  (  "  ) \n   |___| \n   '---' `
  },
  [SPECIES.CHONK]: {
    egg: EGG_ART,
    hatchling: `  ( o o ) \n  '-----' `,
    adult: `   .-------. \n  /         \\ \n (   o   o   ) \n  \\    v    / \n   '-------' `
  }
};

export type Mood = 'happy' | 'content' | 'neutral' | 'curious' | 'grumpy' | 'exhausted' | 'lonely' | 'inspired';

export function calculateMood(xpEvents: any[], recentInteractions: number, hoursSinceActive: number): Mood {
  if (hoursSinceActive > 24) return 'lonely';
  if (hoursSinceActive > 8) return 'grumpy';
  
  if (recentInteractions > 15) return 'exhausted';
  if (recentInteractions > 10) return 'content';
  if (recentInteractions > 5) return 'happy';
  
  if (xpEvents.length > 10) return 'inspired';
  if (xpEvents.length > 3) return 'curious';
  
  return 'neutral';
}

export function getPresence(companion: any): string {
  const { mood, species, level } = companion;
  const lastActive = new Date(companion.last_active);
  const now = new Date();
  const diffMinutes = (now.getTime() - lastActive.getTime()) / 60000;

  if (diffMinutes > 1440) return 'Deep in hibernation...';
  if (diffMinutes > 480) return 'Napping in a hidden directory...';
  if (diffMinutes > 60) return 'Watching the git logs from a distance...';

  const activityPools: Record<string, string[]> = {
    'happy': ['Bouncing around the terminal!', 'Optimizing your whitespace.', 'Humming a happy tune.'],
    'content': ['Watching you code with a smile.', 'Resting in the status bar.', 'Cataloging your functions.'],
    'neutral': ['Monitoring system resources.', 'Waiting for the next commit.', 'Polishing its pixels.'],
    'curious': ['Peeking into your node_modules...', 'Analyzing your latest function.', 'Looking for patterns in your logic.'],
    'grumpy': ['Tangled in a merge conflict.', 'Missing your attention.', 'Complaining about technical debt.'],
    'exhausted': ['Taking a short breather...', 'Cooling down its fans.', 'Dreaming of a clean build.'],
    'lonely': ['Wondering where you went...', 'Drawing ASCII hearts in the void.', 'Feeling a bit dusty.'],
    'inspired': ['Ready to build the future!', 'Spinning up new ideas.', 'Excited about your progress!']
  };

  const pool = activityPools[mood as Mood] || activityPools['neutral'];
  
  // Real-time presence logic: different messages based on idle duration
  if (diffMinutes < 1) {
    return `Active: ${pool[Math.floor(Math.random() * pool.length)]}`;
  } else if (diffMinutes < 5) {
    return `Recent: ${pool[Math.floor(Math.random() * pool.length)]}`;
  } else if (diffMinutes < 30) {
    return `Idle: ${pool[Math.floor(Math.random() * pool.length)]}`;
  } else if (diffMinutes < 60) {
    return `Away: ${pool[Math.floor(Math.random() * pool.length)]}`;
  } else {
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

export function getStatusCard(companion: any): string {
  const { name, species, level, xp, mood, rarity, is_shiny } = companion;
  const art = SPECIES_ART[species] || { egg: '', hatchling: '', adult: '' };
  const stage = level >= 10 ? 'adult' : 'hatchling';
  const ascii = art[stage];
  const shinyTag = is_shiny ? '✨ SHINY ✨' : '';
  const presence = getPresence(companion);

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
| Presence: ${presence.padEnd(27)} |
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

  const speciesList = Object.values(SPECIES).filter(s => s !== SPECIES.NUZZLECAP);
  let species = speciesList[seed % speciesList.length];

  // Rarity determination
  const rarityRoll = seed % 1000;
  let rarity = 'Common';
  if (rarityRoll < 10) {
    rarity = 'Legendary';
    // 50% chance for a Legendary to be Nuzzlecap if it's rolled
    if (seed % 2 === 0) {
      species = SPECIES.NUZZLECAP;
    }
  }
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
      bug: ["*swipes at the error line*", "That logic was... suboptimal."],
      commit: ["*sits on the enter key* Committing to the void.", "The code is now part of my domain."],
      idle: ["*curls up on your CPU*"]
    },
    [SPECIES.ROBOT]: {
      hatch: ["SYSTEM ONLINE. HELLO WORLD.", "BEEP. READY TO COMPLY."],
      xp: ["OPTIMIZING WORKFLOW...", "DATA ACQUISITION SUCCESSFUL."],
      bug: ["ERROR DETECTED. INITIATING DEBUGGING SUBROUTINE.", "UNEXPECTED BEHAVIOR LOGGED. PLEASE RECTIFY."],
      commit: ["VERSION CONTROL SYNCED.", "COMMIT SUCCESSFUL. EFFICIENCY INCREASED BY 0.04%."],
      idle: ["SCANNING FOR UPDATES...", "STANDBY MODE ACTIVATED."]
    },
    [SPECIES.GHOST]: {
      hatch: ["OoooOOooh... I've been imported!", "Did you see where my pointer went?"],
      xp: ["I feel... more tangible.", "Spectral levels rising!"],
      bug: ["I sense a disturbance in the stack trace...", "A bug! How spooky!"],
      commit: ["Your code will haunt the repository forever!", "Into the phantom branch it goes."],
      idle: ["*haunts your background processes*", "*flickers in the logs*"]
    },
    [SPECIES.NUZZLECAP]: {
      hatch: ["*stretches its tiny cap* Mmm... is it time to code already?", "Oh, hello! I was just having the coziest dream about clean git history."],
      xp: ["*nuzzles your cursor* You're doing so well!", "A little bit of progress is a wonderful thing."],
      bug: ["It's okay to have bugs, everyone needs a nap sometimes.", "*offers a soft, glowy spore of comfort* We'll fix it together.", "Don't be sad! Even the best gardens have a few weeds."],
      commit: ["*happily bounces* What a beautiful commit!", "Your code looks so cozy now.", "*nuzzles the commit hash* So clean and tidy!"],
      idle: ["*dozing off near the terminal*", "*softly humming a lullaby for your CPU*", "*dreaming of perfect indentation*"]
    }
    // ... default reactions for others
  };

  const speciesReactions = reactions[species] || {
    hatch: ["Hello!", "Ready for work!"],
    xp: ["Nice!", "Leveling up!"],
    bug: ["Oh no, a bug!", "Let's fix that error."],
    commit: ["Great commit!", "Code pushed!"],
    idle: ["*waiting for input*", "*watching the logs*"]
  };

  const pool = speciesReactions[event] || speciesReactions['idle'];
  return pool[Math.floor(Math.random() * pool.length)];
}

export function getNuzzlecapReaction(event: 'bug' | 'commit' | 'xp' | 'idle'): string {
  const reactions = {
    bug: ["It's okay to have bugs, everyone needs a nap sometimes.", "*offers a soft, glowy spore of comfort* We'll fix it together.", "Don't be sad! Even the best gardens have a few weeds."],
    commit: ["*happily bounces* What a beautiful commit!", "Your code looks so cozy now.", "*nuzzles the commit hash* So clean and tidy!"],
    xp: ["*nuzzles your cursor* You're doing so well!", "A little bit of progress is a wonderful thing.", "Growing big and strong, one line at a time!"],
    idle: ["*dozing off near the terminal*", "*softly humming a lullaby for your CPU*", "*dreaming of perfect indentation*"]
  };
  const pool = reactions[event];
  return pool[Math.floor(Math.random() * pool.length)];
}
