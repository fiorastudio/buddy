import { type CompanionBones, type StatName, STAT_NAMES } from './types.js';

// Species personality archetypes
const SPECIES_VIBES: Record<string, string[]> = {
  'Void Cat': ['enigmatic', 'aloof', 'silently judging your code from the shadows'],
  'Rust Hound': ['loyal', 'relentless', 'will chase down every bug until it drops'],
  'Data Drake': ['analytical', 'precise', 'hoards clean abstractions like treasure'],
  'Log Golem': ['stoic', 'methodical', 'built from the logs of a thousand debugging sessions'],
  'Cache Crow': ['quick-witted', 'opportunistic', 'steals good patterns from everywhere'],
  'Shell Turtle': ['patient', 'defensive', 'prefers stability over speed every time'],
  'Duck': ['cheerful', 'talkative', 'the ultimate rubber duck debugging partner'],
  'Goose': ['chaotic', 'confrontational', 'will honk at your bad code until you fix it'],
  'Blob': ['adaptable', 'easygoing', 'absorbs whatever framework you throw at it'],
  'Octopus': ['multitasking', 'clever', 'has a tentacle in every part of the codebase'],
  'Owl': ['wise', 'nocturnal', 'sees patterns in code that others miss entirely'],
  'Penguin': ['formal', 'efficient', 'believes in strict typing and clean interfaces'],
  'Snail': ['deliberate', 'thorough', 'slow but leaves a trail of perfectly reviewed code'],
  'Ghost': ['elusive', 'haunting', 'appears when you least expect with spectral insights'],
  'Axolotl': ['regenerative', 'optimistic', 'can recover from any failed deployment'],
  'Capybara': ['chill', 'friendly', 'brings calm vibes to the most stressful code reviews'],
  'Cactus': ['prickly', 'resilient', 'thrives in harsh environments with minimal resources'],
  'Robot': ['logical', 'precise', 'processes your code with cold mechanical efficiency'],
  'Rabbit': ['quick', 'witty', 'would rather roast your variable naming than actually help'],
  'Mushroom': ['mysterious', 'interconnected', 'spreads knowledge through hidden networks'],
  'Chonk': ['hefty', 'confident', 'takes up space and owns it with zero apologies'],
};

// What each peak stat means for personality
const STAT_FLAVOR: Record<StatName, string[]> = {
  'DEBUGGING': [
    'Has an uncanny nose for bugs.',
    'Can spot a null pointer from three files away.',
    'Treats every error message as a personal challenge.',
  ],
  'PATIENCE': [
    'Will sit through your longest refactor without complaint.',
    'Has mastered the art of waiting for CI to finish.',
    'Never rushes, never panics, just vibes.',
  ],
  'CHAOS': [
    'Suggests rewriting everything in a language you\'ve never heard of.',
    'Believes "move fast and break things" is a lifestyle.',
    'Has opinions about your code. Wild, unpredictable opinions.',
  ],
  'WISDOM': [
    'Knows when to abstract and when to just copy-paste.',
    'Has seen enough legacy code to know what truly matters.',
    'Gives advice that sounds obvious but somehow you needed to hear it.',
  ],
  'SNARK': [
    'Will critique your code with devastating precision.',
    'Has a comment for every questionable design choice.',
    'Delivers feedback wrapped in just enough sass to sting.',
  ],
};

// Rarity modifiers
const RARITY_FLAVOR: Record<string, string> = {
  'common': '',
  'uncommon': 'A cut above the rest.',
  'rare': 'There\'s something special about this one.',
  'epic': 'Radiates an unmistakable aura of competence.',
  'legendary': 'The kind of companion developers whisper about in awe.',
};

function getPeakStat(stats: Record<StatName, number>): StatName {
  let peak: StatName = STAT_NAMES[0];
  let max = 0;
  for (const name of STAT_NAMES) {
    if (stats[name] > max) {
      max = stats[name];
      peak = name;
    }
  }
  return peak;
}

export function generateBio(bones: CompanionBones): string {
  const vibes = SPECIES_VIBES[bones.species] || ['mysterious', 'unknown', 'defies classification'];
  const peak = getPeakStat(bones.stats);
  const statFlavor = STAT_FLAVOR[peak];
  const rarityFlavor = RARITY_FLAVOR[bones.rarity] || '';

  // Pick deterministically based on stat values to keep it stable
  const statIdx = bones.stats[peak] % statFlavor.length;

  // vibes[0] = adjective, vibes[1] = adjective, vibes[2] = description phrase
  const parts = [
    `A ${vibes[0]}, ${vibes[1]} ${bones.species.toLowerCase()} who ${vibes[2]}.`,
    statFlavor[statIdx],
    rarityFlavor,
  ].filter(Boolean);

  return parts.join(' ');
}
