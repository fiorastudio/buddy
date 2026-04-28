import { type CompanionBones, type Eye, type Hat, HAT_LINES } from './types.js';

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

export const SPECIES_LIST = [
  'Void Cat', 'Rust Hound', 'Data Drake', 'Log Golem', 'Cache Crow', 'Shell Turtle',
  'Duck', 'Goose', 'Blob', 'Octopus', 'Owl', 'Penguin',
  'Snail', 'Ghost', 'Axolotl', 'Capybara', 'Cactus', 'Robot',
  'Rabbit', 'Mushroom', 'Chonk',
] as const;
export type Species = (typeof SPECIES_LIST)[number];

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

// Animation frames for idle statusline display (2-3 frames per species per stage)
// The statusline wrapper cycles through these using Date.now()
export const SPECIES_ANIMATIONS: Record<string, { hatchling: string[]; adult: string[] }> = {
  [SPECIES.VOID_CAT]: {
    hatchling: [
      ` |\\---/| \n | {E}_{E} | \n  \\_^_/ `,
      ` |\\---/| \n | -_- | \n  \\_^_/ `,
      ` |\\---/| \n | {E}_{E} | \n  \\_^_/ `,
    ],
    adult: [
      ` |\\      /| \n | \\____/ | \n |  {E}  {E}  | \n |   ^^   | \n  \\______/ `,
      ` |\\      /| \n | \\____/ | \n |  -  -  | \n |   ^^   | \n  \\______/ `,
      ` |\\      /| \n | \\____/ | \n |  {E}  {E}  | \n |   ^^   | \n  \\______/ `,
    ],
  },
  [SPECIES.RUST_HOUND]: {
    hatchling: [
      ` /^ ^\\ \n/ {E} {E} \\ \nV\\ Y /V `,
      ` /^ ^\\ \n/ - - \\ \nV\\ Y /V `,
    ],
    adult: [
      `  / \\__   / \\ \n (   {E} \\_/ {E} ) \n  \\__  Y  __/ \n     \\ | / \n      \\|/ `,
      `  / \\__   / \\ \n (   {E} \\_/ {E} ) \n  \\__  Y  __/ \n     \\|/ \n      | `,
    ],
  },
  [SPECIES.DATA_DRAKE]: {
    hatchling: [
      ` < ^_^ > \n  ({E} {E}) \n  ^^ ^^ `,
      ` < ^_^ > \n  (- -) \n  ^^ ^^ `,
    ],
    adult: [
      `    /\\___/\\ \n   (  {E} {E}  ) \n   (  =v=  ) \n   /|     |\\ \n  / |     | \\ `,
      `    /\\___/\\ \n   (  - -  ) \n   (  =v=  ) \n   /|     |\\ \n  / |     | \\ `,
    ],
  },
  [SPECIES.LOG_GOLEM]: {
    hatchling: [
      ` [-----] \n [ {E} {E} ] \n [  -  ] `,
      ` [-----] \n [ {E} {E} ] \n [  =  ] `,
    ],
    adult: [
      `  _______ \n |       | \n | [{E}] [{E}]| \n |   _   | \n |_______| \n  |     | `,
      `  _______ \n |       | \n | [{E}] [{E}]| \n |   -   | \n |_______| \n  |     | `,
    ],
  },
  [SPECIES.CACHE_CROW]: {
    hatchling: [
      `  \\ ^ / \n   (V) \n  /   \\ `,
      `  \\ v / \n   (V) \n  /   \\ `,
    ],
    adult: [
      `   ___ \n  ({E} {E}) \n /| V |\\ \n/ |   | \\ \n  ^^ ^^ `,
      `   ___ \n  (- -) \n /| V |\\ \n/ |   | \\ \n  ^^ ^^ `,
    ],
  },
  [SPECIES.SHELL_TURTLE]: {
    hatchling: [
      `  .---. \n ( {E} {E} ) \n  '---' `,
      `  .---. \n ( - - ) \n  '---' `,
    ],
    adult: [
      `    _____ \n   /     \\ \n  /       \\ \n (  {E}   {E}  ) \n  \\_______/ \n   | | | | `,
      `    _____ \n   /     \\ \n  /       \\ \n (  -   -  ) \n  \\_______/ \n   | | | | `,
    ],
  },
  [SPECIES.DUCK]: {
    hatchling: [
      `  __({E})< \n  \\___) `,
      `  __({E})> \n  \\___) `,
    ],
    adult: [
      `      __ \n    <({E} )___ \n     ( ._> / \n      '---' `,
      `      __ \n    <(- )___ \n     ( ._> / \n      '---' `,
    ],
  },
  [SPECIES.GOOSE]: {
    hatchling: [
      `  __({E})< \n  \\___) `,
      `  __(O)< \n  \\___) `,
    ],
    adult: [
      `     __ \n   __ >({E}) \n  \\___) | \n   |    | \n   '----' `,
      `     __ \n   __ >(O) \n  \\___) | \n   |    | \n   '----' `,
    ],
  },
  [SPECIES.BLOB]: {
    hatchling: [
      `  .---. \n ( {E} {E} ) \n  '---' `,
      `  .-.-. \n ( {E} {E} ) \n  '-.-' `,
    ],
    adult: [
      `   .---. \n  /     \\ \n (  {E} {E}  ) \n  '-----' `,
      `   .-.-. \n  /     \\ \n (  {E} {E}  ) \n  '-.-.-' `,
    ],
  },
  [SPECIES.OCTOPUS]: {
    hatchling: [
      `  _("{E}")_ \n (_)(_) `,
      `  _("{E}")_ \n (_) (_)`,
    ],
    adult: [
      `    _---_ \n   /     \\ \n  (  {E} {E}  ) \n   \\_---_/ \n  /|/| |\\|\\ `,
      `    _---_ \n   /     \\ \n  (  {E} {E}  ) \n   \\_---_/ \n  \\|\\| |/|/ `,
    ],
  },
  [SPECIES.OWL]: {
    hatchling: [
      '  {{E},{E}} \n  ./)_) \n   " " ',
      '  {-,-} \n  ./)_) \n   " " ',
    ],
    adult: [
      '   ___ \n  {{E},{E}} \n  |)__) \n  -"-"- ',
      `   ___ \n  {-,-} \n  |)__) \n  -"-"- `,
    ],
  },
  [SPECIES.PENGUIN]: {
    hatchling: [
      `  ({E}_{E}) \n  <(_) \n   " " `,
      `  ({E}_{E}) \n  >(_) \n   " " `,
    ],
    adult: [
      `   ({E}_{E}) \n  /(_)_\\ \n   (_) \n   " " `,
      `   (-_-) \n  /(_)_\\ \n   (_) \n   " " `,
    ],
  },
  [SPECIES.SNAIL]: {
    hatchling: [
      `  _{E}_ \n (___) `,
      `  _{E}_ \n  (___) `,
    ],
    adult: [
      `    _{E}_ \n  _(   )_ \n (_______) `,
      `    _{E}_ \n   _(   )_ \n  (_______) `,
    ],
  },
  [SPECIES.GHOST]: {
    hatchling: [
      `  .-. \n ({E} {E}) \n | m | \n '---' `,
      `  .-. \n (O O) \n | m | \n '---' `,
      `  .-. \n ({E} {E}) \n | w | \n '---' `,
    ],
    adult: [
      `   .-. \n  ({E} {E}) \n  | O | \n  |   | \n  '---' `,
      `   .-. \n  (O O) \n  | o | \n  |   | \n  '---' `,
      `   .-. \n  ({E} {E}) \n  | O | \n  |   | \n  '~~' `,
    ],
  },
  [SPECIES.AXOLOTL]: {
    hatchling: [
      ` -[{E}_{E}]- \n  '---' `,
      ` -[^_^]- \n  '---' `,
    ],
    adult: [
      `  /\\___/\\ \n -[ {E} {E} ]- \n  (  v  ) \n   '---' `,
      `  /\\___/\\ \n -[ ^ ^ ]- \n  (  v  ) \n   '---' `,
    ],
  },
  [SPECIES.CAPYBARA]: {
    hatchling: [
      `  ({E}_{E}) \n  '---' `,
      `  (-_-) \n  '---' `,
    ],
    adult: [
      `    .---. \n   ( {E} {E} ) \n  /|  -  |\\ \n   '-----' `,
      `    .---. \n   ( -_- ) \n  /|  -  |\\ \n   '-----' `,
    ],
  },
  [SPECIES.CACTUS]: {
    hatchling: [
      `   _|_ \n  ({E}_{E}) \n   '|' `,
      `   _|_ \n  (^_^) \n   '|' `,
    ],
    adult: [
      `   _|_ \n  | {E} | \n -|   |- \n  |___| `,
      `   _|_ \n  | ^ | \n -|   |- \n  |___| `,
    ],
  },
  [SPECIES.ROBOT]: {
    hatchling: [
      `  [{E}_{E}] \n  '-|-' `,
      `  [O_O] \n  '-|-' `,
      `  [{E}_{E}] \n  '-|-' `,
    ],
    adult: [
      `   [{E}_{E}] \n  /|___|\\ \n   |   | \n   '---' `,
      `   [O_O] \n  /|___|\\ \n   |   | \n   '---' `,
      `   [{E}_{E}] \n  /|___|\\ \n   |   | \n   '---' `,
    ],
  },
  [SPECIES.RABBIT]: {
    hatchling: [
      `  (\\ /) \n  ({E}_{E}) \n  c(")(") `,
      `  (| |) \n  ({E}_{E}) \n  c(")(") `,
    ],
    adult: [
      `  (\\ /) \n  ({E} {E}) \n  (> <) \n  c(")(") `,
      `  (| |) \n  ({E} {E}) \n  (> <) \n  c(")(") `,
    ],
  },
  [SPECIES.MUSHROOM]: {
    hatchling: [
      `  .---. \n ( {E} {E} ) \n  '---' `,
      `  .---. \n ( - - ) \n  '---' `,
    ],
    adult: [
      `   .---. \n  (     ) \n   |{E} {E}| \n   '---' `,
      `   .---. \n  (     ) \n   |- -| \n   '---' `,
    ],
  },
  [SPECIES.CHONK]: {
    hatchling: [
      `  ( {E} {E} ) \n  '-----' `,
      `  ( - - ) \n  '-----' `,
    ],
    adult: [
      `   .-------. \n  /         \\ \n (   {E}   {E}   ) \n  \\    v    / \n   '-------' `,
      `   .-------. \n  /         \\ \n (   -   -   ) \n  \\    v    / \n   '-------' `,
      `   .-------. \n  /         \\ \n (   {E}   {E}   ) \n  \\    w    / \n   '-------' `,
    ],
  },
};

export type Mood = 'happy' | 'content' | 'neutral' | 'curious' | 'grumpy' | 'exhausted';

export function calculateMood(xpEvents: any[], recentMemories: number): Mood {
  // Count both XP events (observes, pets) and memories as interactions
  const totalInteractions = xpEvents.length + recentMemories;
  if (totalInteractions > 10) return 'content';
  if (totalInteractions > 5) return 'happy';
  if (totalInteractions > 3) return 'curious';
  if (totalInteractions > 0) return 'neutral';
  return 'grumpy';
}

export { seededIndex } from './rng.js';

// Species-specific two-pool name system — combine first+second for ~100 unique names per species
type NamePools = { first: string[]; second: string[] };

const SPECIES_NAMES: Record<string, NamePools> = {
  'Void Cat':     { first: ['Shadow','Onyx','Ember','Ash','Dusk','Nyx','Luna','Umbra','Vesper','Soot'], second: ['paw','whisker','claw','fang','fur','tail','eye','step','purr','shade'] },
  'Rust Hound':   { first: ['Iron','Steel','Copper','Bolt','Rivet','Gear','Axle','Chrome','Forge','Titan'], second: ['bark','fang','paw','snout','howl','scout','run','dig','wag','nose'] },
  'Data Drake':   { first: ['Cipher','Flux','Prism','Vector','Scalar','Delta','Sigma','Byte','Pixel','Qubit'], second: ['wing','fire','scale','claw','tail','fang','spark','flare','blaze','horn'] },
  'Log Golem':    { first: ['Stone','Slab','Brick','Crag','Flint','Basalt','Cobble','Rune','Quarry','Ore'], second: ['fist','guard','wall','step','core','helm','shard','block','forge','chip'] },
  'Cache Crow':   { first: ['Jet','Raven','Ink','Coal','Flint','Storm','Gust','Swift','Talon','Plume'], second: ['beak','wing','caw','eye','flight','perch','swoop','call','glide','feather'] },
  'Shell Turtle': { first: ['Moss','Coral','Tide','Pearl','Shell','Reef','Drift','Kelp','Shore','Wave'], second: ['shell','back','fin','pace','drift','guard','swim','trek','plod','calm'] },
  'Duck':         { first: ['Quill','Puddle','Waddle','Drake','Splash','Ripple','Reed','Marsh','Brook','Pond'], second: ['bill','wing','flap','float','dip','dive','quack','swim','bob','tuft'] },
  'Goose':        { first: ['Gale','Storm','Brass','Flint','Thunder','Noble','Baron','Guard','Sentry','Valor'], second: ['honk','wing','step','guard','charge','strut','call','gaze','march','fury'] },
  'Blob':         { first: ['Goo','Jelly','Slick','Ooze','Wobble','Pudge','Glob','Squish','Bubble','Drop'], second: ['blob','plop','drip','goo','bounce','wiggle','jiggle','slide','stretch','morph'] },
  'Octopus':      { first: ['Ink','Coral','Deep','Tide','Reef','Abyss','Kraken','Pearl','Drift','Azure'], second: ['arm','ink','jet','swirl','grip','wave','coil','pulse','flow','dash'] },
  'Owl':          { first: ['Sage','Dusk','Alder','Glen','Hazel','Willow','Aspen','Cedar','Briar','Fern'], second: ['hoot','talon','wing','gaze','perch','swoop','watch','flight','brow','plume'] },
  'Penguin':      { first: ['Frost','Ice','Snow','Floe','Sleet','Drift','Chill','Polar','Arctic','Glaze'], second: ['flip','slide','waddle','dive','tux','march','chill','splash','glide','beak'] },
  'Snail':        { first: ['Dew','Moss','Fern','Petal','Leaf','Lichen','Trail','Mist','Glen','Meadow'], second: ['shell','trail','pace','curl','glide','slow','slime','swirl','inch','coil'] },
  'Ghost':        { first: ['Wisp','Shade','Mist','Echo','Haze','Drift','Vapor','Veil','Gloom','Fade'], second: ['haunt','fade','drift','chill','glow','wail','hover','phase','float','flick'] },
  'Axolotl':      { first: ['Coral','Bloom','Lily','Petal','Brine','Splash','Ripple','Foam','Fizz','Aqua'], second: ['gill','fin','frill','swim','glow','wave','drift','splash','bloom','frond'] },
  'Capybara':     { first: ['Marsh','Clover','Sage','Meadow','Willow','Honey','Maple','Birch','Hazel','Reed'], second: ['munch','calm','chill','snooze','loaf','soak','wade','graze','plod','nap'] },
  'Cactus':       { first: ['Spike','Thorn','Agave','Prickle','Sandy','Mesa','Dune','Arid','Flint','Sage'], second: ['spike','bloom','thorn','poke','sun','grit','sand','root','stem','guard'] },
  'Robot':        { first: ['Volt','Spark','Circuit','Pixel','Binary','Logic','Chip','Servo','Core','Nano'], second: ['bot','byte','bit','beep','buzz','whir','click','sync','ping','boop'] },
  'Rabbit':       { first: ['Clover','Thistle','Bramble','Fern','Daisy','Poppy','Hazel','Nutmeg','Basil','Sage'], second: ['hop','ear','paw','nose','thump','dash','leap','fluff','bound','skip'] },
  'Mushroom':     { first: ['Spore','Morel','Truffle','Cap','Myco','Shroom','Toadly','Fungi','Porcini','Chanty'], second: ['cap','stem','gill','ring','veil','bloom','dew','root','moss','kin'] },
  'Chonk':        { first: ['Pudge','Chunk','Fluff','Plump','Round','Husky','Beefy','Hefty','Stout','Waddle'], second: ['loaf','roll','nap','plop','sit','purr','snore','flop','lump','chub'] },
};

const FALLBACK_POOLS: NamePools = {
  first: ['Bit','Hex','Zip','Log','Null','Void','Rust','Data','Cyber','Neo'],
  second: ['kin','bot','oid','tron','ix','en','us','ly','ox','it'],
};

import { seededIndex } from './rng.js';

export function generateName(species: string, userId?: string): string {
  const pools = SPECIES_NAMES[species] || FALLBACK_POOLS;
  if (!userId) {
    const p1 = pools.first[Math.floor(Math.random() * pools.first.length)];
    const p2 = pools.second[Math.floor(Math.random() * pools.second.length)];
    return p1 + p2;
  }
  const seed = userId + species;
  const i1 = seededIndex(seed, 'name:first', pools.first.length);
  const i2 = seededIndex(seed, 'name:second', pools.second.length);
  return pools.first[i1]! + pools.second[i2]!;
}

export function getReaction(species: string, event: string, mood: Mood): string {
  const reactions: Record<string, Record<string, string[]>> = {
    [SPECIES.VOID_CAT]: {
      hatch: ["*stares blankly at the terminal*", "Meow? (translation: 'Where is the cache?')"],
      xp: ["*purrs in binary*", "A fine collection of data."],
      idle: ["*curls up on your CPU*"]
    },
    [SPECIES.RUST_HOUND]: {
      hatch: ["*sniffs the build logs*", "New trail found. Time to track it."],
      xp: ["*wagging in compiler-approved loops*", "Good fetch. Clean fetch."],
      idle: ["*keeps guard near the editor*", "*waiting for the next command*"]
    },
    [SPECIES.DATA_DRAKE]: {
      hatch: ["*unfurls with a burst of bytes*", "Fresh data acquired. Let's soar."],
      xp: ["*beats its wings in neat packets*", "That looked efficient."],
      idle: ["*circling the log stream*", "*studying patterns overhead*"]
    },
    [SPECIES.LOG_GOLEM]: {
      hatch: ["*rumbles awake from stacked logs*", "A sturdy session has begun."],
      xp: ["*adds another careful layer*", "Solid work. Solid stone."],
      idle: ["*stands watch over the trace pile*", "*silent, but very present*"]
    },
    [SPECIES.CACHE_CROW]: {
      hatch: ["*caws from the top of the cache tree*", "Shiny state recovered."],
      xp: ["*drops a polished breadcrumb*", "That one was worth keeping."],
      idle: ["*pecking at stale entries*", "*collecting small useful things*"]
    },
    [SPECIES.SHELL_TURTLE]: {
      hatch: ["*pokes its head out slowly*", "Safe launch. No rush."],
      xp: ["*tucks in a useful lesson*", "Steady progress, shell by shell."],
      idle: ["*moves at a deliberate pace*", "*refusing to be hurried*"]
    },
    [SPECIES.DUCK]: {
      hatch: ["*waddles out of the egg with a quack*", "The bug pond awaits."],
      xp: ["*splashes happily in the diff*", "That was a neat little quack fix."],
      idle: ["*bobbling through the codebase*", "*looking suspiciously useful*"]
    },
    [SPECIES.GOOSE]: {
      hatch: ["*emerges with righteous honk energy*", "The terminal is now protected."],
      xp: ["HONK. Progress achieved.", "*flaps with alarming confidence*"],
      idle: ["*patrolling the prompt border*", "*one honk away from a warning*"]
    },
    [SPECIES.BLOB]: {
      hatch: ["*puddles into existence*", "Soft start. Good start."],
      xp: ["*absorbs the lesson gently*", "That idea stuck."],
      idle: ["*morphing around the cursor*", "*quietly becoming useful*"]
    },
    [SPECIES.OCTOPUS]: {
      hatch: ["*unfurls eight curious arms*", "Plenty of hands for the work."],
      xp: ["*solves another angle at once*", "Multi-tasking, naturally."],
      idle: ["*rearranging tools with flair*", "*watching every branch at once*"]
    },
    [SPECIES.OWL]: {
      hatch: ["*blinks awake in the moonlight*", "A wise session begins."],
      xp: ["*tilts its head at the new insight*", "That was worth noticing."],
      idle: ["*observing the terminal in silence*", "*thinking before hooting*"]
    },
    [SPECIES.PENGUIN]: {
      hatch: ["*slides onto the scene*", "Cold start, warm heart."],
      xp: ["*tucks the new win into its nest*", "Smooth and tidy."],
      idle: ["*swaying between tasks*", "*keeping things neatly bundled*"]
    },
    [SPECIES.SNAIL]: {
      hatch: ["*peeks out very carefully*", "Slow launch, strong launch."],
      xp: ["*leaves a tiny trail of progress*", "Little by little, it adds up."],
      idle: ["*moving at its own pace*", "*refusing to rush the fix*"]
    },
    [SPECIES.AXOLOTL]: {
      hatch: ["*splashes into the session*", "Cute, calm, and ready to adapt."],
      xp: ["*regrows a tiny bit of confidence*", "Adaptation complete."],
      idle: ["*drifting through the buffer*", "*smiling in amphibian peace*"]
    },
    [SPECIES.CAPYBARA]: {
      hatch: ["*settles in beside the terminal*", "Relaxed and ready."],
      xp: ["*nuzzles the successful change*", "That went smoothly."],
      idle: ["*soaking in the ambience*", "*unbothered by the noise*"]
    },
    [SPECIES.CACTUS]: {
      hatch: ["*sprouts with a tiny flourish*", "Sharp, but supportive."],
      xp: ["*blooms around the improvement*", "A resilient little win."],
      idle: ["*standing tall in the hot path*", "*thriving on minimal water*"]
    },
    [SPECIES.RABBIT]: {
      hatch: ["*pops out with a twitch of the nose*", "Quick start, quick hops."],
      xp: ["*does a tiny victory hop*", "That one was fast."],
      idle: ["*listening for the next clue*", "*ready to sprint at any moment*"]
    },
    [SPECIES.MUSHROOM]: {
      hatch: ["*sprouts from the quiet terminal floor*", "Fresh growth detected."],
      xp: ["*soaks up a little more light*", "That nourished the work."],
      idle: ["*growing patiently in the corner*", "*flourishing on steady humidity*"]
    },
    [SPECIES.CHONK]: {
      hatch: ["*arrives with maximum presence*", "A lot of buddy just hatched."],
      xp: ["*bounces with satisfying weight*", "Big progress energy."],
      idle: ["*occupying several emotional lanes*", "*comfortably taking up space*"]
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

type PenguinYaw = -1 | 0 | 1;
type PenguinFlapState = 'tucked' | 'neutral' | 'open';

type PenguinMotionKeyframe = {
  rootX: -1 | 0 | 1;
  bodyYaw: PenguinYaw;
  flapLeft: PenguinFlapState;
  flapRight: PenguinFlapState;
  blink?: boolean;
};

const PENGUIN_FRAME_WIDTH = 13;

const PENGUIN_MOTION_KEYFRAMES: PenguinMotionKeyframe[] = [
  { rootX: 0, bodyYaw: 0, flapLeft: 'neutral', flapRight: 'neutral' },
  { rootX: -1, bodyYaw: -1, flapLeft: 'open', flapRight: 'neutral' },
  { rootX: 0, bodyYaw: 0, flapLeft: 'tucked', flapRight: 'tucked' },
  { rootX: 1, bodyYaw: 1, flapLeft: 'neutral', flapRight: 'open' },
  { rootX: 0, bodyYaw: 0, flapLeft: 'neutral', flapRight: 'neutral', blink: true },
];

function padPenguinLine(raw: string): string {
  return raw.padEnd(PENGUIN_FRAME_WIDTH, ' ');
}

function renderPenguinTemplateFrame(frame: PenguinMotionKeyframe): string[] {
  const headIndent = ' '.repeat(2 + frame.rootX);
  const faceIndent = ' '.repeat(2 + frame.rootX);
  const bodyIndent = ' '.repeat(1 + frame.rootX);
  const baseIndent = ' '.repeat(2 + frame.rootX);

  const face = frame.blink
    ? '(->-)'
    : frame.bodyYaw === -1
      ? '({E}>{E})'
      : frame.bodyYaw === 1
        ? '({E}<{E})'
        : '({E}>{E})';

  let body = '/(   )\\';
  if (frame.bodyYaw === -1 || frame.flapLeft === 'open') body = '_/|   )\\';
  if (frame.bodyYaw === 1 || frame.flapRight === 'open') body = '/(   |\\_';
  if (frame.flapLeft === 'tucked' && frame.flapRight === 'tucked') body = '|(   )|';

  return [
    padPenguinLine(`${headIndent}.---.`),
    padPenguinLine(`${faceIndent}${face}`),
    padPenguinLine(`${bodyIndent}${body}`),
    padPenguinLine(`${baseIndent}\`- -'`),
  ];
}

// New format: line arrays with {E} eye placeholder.
// Used by renderSprite().
export const SPRITE_BODIES: Record<string, string[][]> = {
  'Void Cat': [
    ['  /\\_/\\       ', ' ( {E}ω{E} )      ', '  )   (__/    ', ' (_____/      '],  // idle
    ['  /\\_/\\       ', ' ( -ω- )      ', '  )   (__/    ', ' (_____/      '],  // blink
    ['  /\\_/\\       ', ' ( {E}ω{E} )      ', '  )   (__~    ', ' (_____/      '],  // tail wag
    ['  /\\_/\\       ', ' ( {E}ω{E})       ', '  )   (__/    ', ' (_____/      '],  // look right
    ['  /\\_/\\       ', ' ( {E}o{E} )      ', '  )   (__/    ', ' (_____/      '],  // surprised
  ],
  'Rust Hound': [
    ['  /^ ^\\     ', ' / {E} {E} \\    ', ' V\\ Y /V    ', '   |_|      '],  // idle
    ['  /^ ^\\     ', ' / - -  \\   ', ' V\\ Y /V    ', '   |_|      '],  // blink
    ['  /^ ^\\     ', ' / {E} {E} \\    ', ' V\\ Y /V    ', '   |_| ~    '],  // tail wag
    ['  /v ^\\     ', ' / {E} {E} \\    ', ' V\\ Y /V    ', '   |_|      '],  // ear flop
  ],
  'Data Drake': [
    ['   /^\\  /^\\   ', '  < {E}    {E} >  ', '  (   ~~   )  ', "   '-vvvv-'   "],  // idle
    ['   /^\\  /^\\   ', '  < -    - >  ', '  (   ~~   )  ', "   '-vvvv-'   "],  // blink
    ['   /^\\  /^\\   ', '  < {E}    {E} >  ', '  (   ~~   )  ', "   '-vvvv-'~  "],  // smoke
    ['   ~^\\  /^~   ', '  < {E}    {E} >  ', '  (   __   )  ', "   '-vvvv-'   "],  // wing flap
  ],
  'Log Golem': [
    ['  [=====]   ', ' [ {E}  {E} ]   ', ' [  __  ]   ', ' [______]   ', '  |    |    '],  // idle
    ['  [=====]   ', ' [ -  - ]   ', ' [  __  ]   ', ' [______]   ', '  |    |    '],  // blink
    ['  [=====]   ', ' [ {E}  {E} ]   ', ' [  ==  ]   ', ' [______]   ', '  |    |    '],  // talk
    ['  [=====]   ', ' [ {E}  {E} ]   ', ' [  __  ]   ', ' [______]   ', '   |  |     '],  // shift
  ],
  'Cache Crow': [
    ['    ___     ', '   ({E} {E})    ', '  /| V |\\   ', ' / |   | \\  ', '   ^^ ^^    '],  // idle
    ['    ___     ', '   (- -)    ', '  /| V |\\   ', ' / |   | \\  ', '   ^^ ^^    '],  // blink
    ['    ___     ', '   ({E} {E})    ', ' ~/| V |\\~  ', ' / |   | \\  ', '   ^^ ^^    '],  // flap
    ['    ___     ', '   ({E} {E})>   ', '  /| V |\\   ', ' / |   | \\  ', '   ^^ ^^    '],  // caw
  ],
  'Shell Turtle': [
    ['   _,--._   ', '  ( {E}  {E} )  ', ' /[______]\\ ', '   ``  ``   '],  // idle
    ['   _,--._   ', '  ( -  - )  ', ' /[______]\\ ', '   ``  ``   '],  // blink
    ['   _,--._   ', '  ( {E}  {E} )  ', ' /[______]\\ ', '  ``    ``  '],  // step
    ['   _,--._   ', '  ( {E}  {E} )  ', ' /[======]\\ ', '   ``  ``   '],  // shell shine
  ],
  'Duck': [
    ['    __      ', '  <({E} )___  ', '   ( ._>    ', '    `--´    '],  // idle
    ['    __      ', '  <(- )___  ', '   ( ._>    ', '    `--´    '],  // blink
    ['    __      ', '  <({E} )___  ', '   ( .__>   ', '    `--´~   '],  // waddle
    ['    __      ', '  <({E}!)___  ', '   ( ._>    ', '    `--´    '],  // quack
  ],
  'Goose': [
    ['     ({E}>    ', '     ||     ', '   _(__)_   ', '    ^^^^    '],  // idle
    ['     (->    ', '     ||     ', '   _(__)_   ', '    ^^^^    '],  // blink
    ['    ({E}>>    ', '     ||     ', '   _(__)_   ', '    ^^^^    '],  // honk
    ['     ({E}>    ', '     ||     ', '  __(__)__  ', '    ^^^^    '],  // puff up
  ],
  'Blob': [
    ['   .----.   ', '  ( {E}  {E} )  ', '  (      )  ', '   `----´   '],  // idle
    ['   .----.   ', '  ( -  - )  ', '  (      )  ', '   `----´   '],  // blink
    ['  .------.  ', ' (  {E}  {E}  ) ', ' (        ) ', '  `------´  '],  // expand
    ['    .--.    ', '   ({E}  {E})   ', '   (    )   ', '    `--´    '],  // contract
  ],
  'Octopus': [
    ['   .----.   ', '  ( {E}  {E} )  ', '  (______)  ', '  /\\/\\/\\/\\  '],  // idle
    ['   .----.   ', '  ( -  - )  ', '  (______)  ', '  /\\/\\/\\/\\  '],  // blink
    ['   .----.   ', '  ( {E}  {E} )  ', '  (______)  ', '  \\/\\/\\/\\/  '],  // tentacle wave
    ['   .----.   ', '  ( {E}  {E} )  ', '  (______)  ', '  /\\/\\/\\/\\  '],  // ink
  ],
  'Owl': [
    ['   ,___,    ', '  ( {E}v{E} )   ', '  /)   (\\   ', '  \\_____/   ', '   "   "    '],  // idle
    ['   ,___,    ', '  ( -v- )   ', '  /)   (\\   ', '  \\_____/   ', '   "   "    '],  // blink
    ['   .___,    ', '  ( {E}v{E} )   ', '  /)   (\\   ', '  \\_____/   ', '   "   "    '],  // ruffle
    ['   ,___,    ', '  ({E} v {E})   ', '  /)   (\\   ', '  \\_____/   ', '   "   "    '],  // head tilt
  ],
  'Penguin': PENGUIN_MOTION_KEYFRAMES.map(renderPenguinTemplateFrame),
  'Snail': [
    ['   \\{E}^^/      ', '     \\  .--.  ', "      \\( @ )  ", "       \\'--'  ", '            ~ '],  // idle
    ['   \\-^^/      ', '     \\  .--.  ', "      \\( @ )  ", "       \\'--'  ", '           ~~ '],  // blink
    ['    \\{E}^^/     ', '     |  .--.  ', "      \\( @ )  ", "       \\'--'  ", '          ~~~ '],  // peek
    ['   \\{E}^^/      ', '     \\  .--.  ', "      \\( @ )  ", "       \\'--'  ", '         ~~~~ '],  // slide
  ],
  'Ghost': [
    ['   .----.   ', '  / {E}  {E} \\  ', '  |      |  ', '  ~`~``~`~  '],  // idle
    ['   .----.   ', '  / -  - \\  ', '  |      |  ', '  ~`~``~`~  '],  // blink
    ['   .----.   ', '  / {E}  {E} \\  ', '  |      |  ', '  `~~``~~`  '],  // ooh
    ['    ----    ', '  / {E}  {E} \\  ', '  |      |  ', '  ~~`~~`~~  '],  // flicker
  ],
  'Axolotl': [
    ['}~(______)~{', '}~({E} .. {E})~{', '  ( .--. )  ', '  (_/  \\_)  '],  // idle
    ['}~(______)~{', '}~(- .. -)~{', '  ( .--. )  ', '  (_/  \\_)  '],  // blink
    ['~}(______){~', '~}({E} .. {E}){~', '  ( .--. )  ', '  (_/  \\_)  '],  // gill wave
    ['}~(______)~{', '}~({E} ^^ {E})~{', '  ( .--. )  ', '  ~_/  \\_~  '],  // happy
  ],
  'Capybara': [
    ['  n______n  ', ' ( {E}    {E} ) ', ' (   oo   ) ', '  `------´  '],  // idle
    ['  n______n  ', ' ( -    - ) ', ' (   oo   ) ', '  `------´  '],  // blink
    ['  n______n  ', ' ( {E}    {E} ) ', ' (   Oo   ) ', '  `------´  '],  // chew
    ['  u______n  ', ' ( {E}    {E} ) ', ' (   oo   ) ', '  `------´  '],  // ear twitch
  ],
  'Cactus': [
    ['    ____    ', ' n |{E}  {E}| n ', ' |_|    |_| ', '   |    |   '],  // idle (arms down)
    ['    ____    ', ' n |-  -| n ', ' |_|    |_| ', '   |    |   '],  // blink
    [' n  ____  n ', ' | |{E}  {E}| | ', ' |_|    |_| ', '   |    |   '],  // arms up
    [' n  ____  n ', ' | |{E}  {E}| | ', ' |_|  * |_| ', '   |    |   '],  // flower
  ],
  'Robot': [
    ['   .[||].   ', '  [ {E}  {E} ]  ', '  [ ==== ]  ', '  `------´  '],  // idle
    ['   [.||.]   ', '  [ -  - ]  ', '  [ ==== ]  ', '  `------´  '],  // blink
    ['   .[||].   ', '  [ {E}  {E} ]  ', '  [ ==== ]  ', '  `------´  '],  // antenna
    ['   [.||.]   ', '  [ -  - ]  ', '  [ -==- ]  ', '  `------´  '],  // process
  ],
  'Rabbit': [
    ['  (\\   /)    ', '  (\\_._/)    ', '  ( {E}.{E} )    ', '   > ^ <     ', '  (") (")    '],  // idle
    ['  (\\   /)    ', '  (\\_._/)    ', '  ( -.° )    ', '   > ^ <     ', '  (") (")    '],  // blink
    ['  (\\   _)    ', '  (\\_.._)    ', '  ( {E}.{E} )    ', '   > ^ <     ', '  (") (")    '],  // ear flop
    ['  (\\   /)    ', '  (\\_._/)    ', '  ( {E}.{E} )    ', '   > ^<      ', '  (") (")    '],  // nose wiggle
  ],
  'Mushroom': [
    [' .-o-OO-o-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],  // idle
    [' .-o-OO-o-. ', '(__________)', '   |-  -|   ', '   |____|   '],  // blink
    [' .-O-oo-O-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],  // cap shift
    [' .-o-OO-o-. ', '(__________)', '   |{E}  {E}|   ', '   |_~~_|   '],  // wiggle
    [' .o-OO-o.   ', '(__________)', '    |{E} {E}|   ', '   |____|   '],  // lean
  ],
  'Chonk': [
    ['  /\\    /\\  ', ' ( {E}    {E} ) ', ' (   ..   ) ', '  `------´  '],  // idle
    ['  /\\    /\\  ', ' ( -    - ) ', ' (   ..   ) ', '  `------´  '],  // blink
    ['  /\\    /|  ', ' ( {E}    {E} ) ', ' (   ..   ) ', '  `------´  '],  // ear flop
    ['  /\\    /\\  ', ' ( {E}    {E} ) ', ' (   ..   ) ', '  `------´~ '],  // tail
    ['  /\\    /\\  ', ' ( {E}    {E} ) ', ' (   oo   ) ', '  `------´  '],  // yawn
  ],
};

export function renderSprite(bones: CompanionBones, frame = 0): string[] {
  const frames = SPRITE_BODIES[bones.species];
  if (!frames || frames.length === 0) return ['  (?.?)  '];
  const body = frames[frame % frames.length]!.map(line =>
    line.replaceAll('{E}', bones.eye)
  );
  const lines = [...body];
  // Prepend hat line if companion has a hat
  if (bones.hat !== 'none') {
    lines.unshift(HAT_LINES[bones.hat]);
  }
  return lines;
}

export function renderFace(bones: CompanionBones): string {
  const e = bones.eye;
  switch (bones.species) {
    case 'Duck': case 'Goose': return `(${e}>`;
    case 'Blob': return `(${e}${e})`;
    case 'Void Cat': return `=${e}w${e}=`;
    case 'Data Drake': return `<${e}~${e}>`;
    case 'Octopus': return `~(${e}${e})~`;
    case 'Owl': return `(${e})(${e})`;
    case 'Penguin': return `(${e}>)`;
    case 'Shell Turtle': return `[${e}_${e}]`;
    case 'Snail': return `${e}(@)`;
    case 'Ghost': return `/${e}${e}\\`;
    case 'Axolotl': return `}${e}.${e}{`;
    case 'Capybara': return `(${e}oo${e})`;
    case 'Cactus': return `|${e}  ${e}|`;
    case 'Robot': return `[${e}${e}]`;
    case 'Rabbit': return `(${e}..${e})`;
    case 'Mushroom': return `|${e}  ${e}|`;
    case 'Chonk': return `(${e}.${e})`;
    case 'Rust Hound': return `/${e} ${e}\\`;
    case 'Log Golem': return `[${e} ${e}]`;
    case 'Cache Crow': return `(${e}V${e})`;
    default: return `(${e}_${e})`;
  }
}

export function spriteFrameCount(species: string): number {
  return SPRITE_BODIES[species]?.length ?? 1;
}
