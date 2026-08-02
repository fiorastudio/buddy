// src/lib/cards.ts
// RO-style card album. Cards are milestone collectibles derived purely
// from level + peak stat + stat values — no storage, always consistent
// with the buddy's current state. The album is the RO "gotta collect
// them all" hook: a visible set that fills in as the buddy grows.

export type StatName = 'DEBUGGING' | 'PATIENCE' | 'CHAOS' | 'WISDOM' | 'SNARK';

export interface Card {
  name: string;
  emoji: string;
  hint: string; // how it's earned (shown when locked)
}

type Rule = Card & { earned: (level: number, peak: StatName, stats: Record<string, number>) => boolean };

// Peak-stat "monster" cards, RO-flavored, unlocked when a stat maxes high.
const STAT_CARDS: Record<StatName, Card> = {
  DEBUGGING: { name: 'Debug Card', emoji: '🐛', hint: 'DEBUGGING ≥ 90' },
  PATIENCE: { name: 'Patience Card', emoji: '🧘', hint: 'PATIENCE ≥ 90' },
  CHAOS: { name: 'Chaos Card', emoji: '💥', hint: 'CHAOS ≥ 90' },
  WISDOM: { name: 'Wisdom Card', emoji: '📖', hint: 'WISDOM ≥ 90' },
  SNARK: { name: 'Snark Card', emoji: '🎭', hint: 'SNARK ≥ 90' },
};

const RULES: Rule[] = [
  { name: 'Novice Card', emoji: '🥚', hint: 'hatch a buddy', earned: () => true },
  { name: 'Poring Card', emoji: '🩷', hint: 'reach level 5', earned: (l) => l >= 5 },
  { name: 'Job Card', emoji: '⚔️', hint: 'reach level 10 (first job)', earned: (l) => l >= 10 },
  { name: 'Second Job Card', emoji: '🛡️', hint: 'reach level 25 (second job)', earned: (l) => l >= 25 },
  { name: 'Transcendent Card', emoji: '👑', hint: 'reach level 45', earned: (l) => l >= 45 },
  { name: 'MVP Card', emoji: '🏆', hint: 'reach level 50 (max)', earned: (l) => l >= 50 },
  ...(Object.keys(STAT_CARDS) as StatName[]).map((s): Rule => ({
    ...STAT_CARDS[s],
    earned: (_l, _p, stats) => (stats[s] ?? 0) >= 90,
  })),
];

export const CARD_CATALOG: Card[] = RULES.map(({ earned, ...card }) => card);

export function earnedCards(level: number, peak: StatName, stats: Record<string, number>): Card[] {
  return RULES.filter((r) => r.earned(level, peak, stats)).map(({ earned, ...card }) => card);
}
