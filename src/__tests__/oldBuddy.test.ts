import { describe, it, expect } from 'vitest';
import {
  parseOldBuddy,
  inferSpeciesFromPersonality,
  deriveSpecies,
  SPECIES_KEYWORDS,
} from '../lib/oldBuddy.js';
import { SPECIES_LIST } from '../lib/species.js';

describe('parseOldBuddy', () => {
  it('parses the Fernsquire shape from issue #60 (companion, personality, hatchedAt, no species)', () => {
    const data = {
      oauthAccount: { accountUuid: 'acc-123' },
      companion: {
        name: 'Fernsquire',
        personality:
          'A philosophically unflappable turtle who responds to your bugs with measured skepticism and the occasional cutting remark about your variable names, as if waiting 80 years to hatch has given them an exceptionally low tolerance for sloppy thinking.',
        hatchedAt: 1775074927992,
      },
    };
    const result = parseOldBuddy(data);
    expect(result).toEqual({
      name: 'Fernsquire',
      species: undefined,
      personality: data.companion.personality,
      hatchedAt: 1775074927992,
      accountUuid: 'acc-123',
      userId: undefined,
    });
  });

  it('accepts data.buddy as an alternative nested key', () => {
    const data = {
      buddy: { name: 'Nested', species: 'Owl' },
      oauthAccount: { accountUuid: 'acc-x' },
    };
    const result = parseOldBuddy(data);
    expect(result?.name).toBe('Nested');
    expect(result?.species).toBe('Owl');
    expect(result?.accountUuid).toBe('acc-x');
  });

  it('accepts data.buddyCompanion as an alternative nested key', () => {
    const data = { buddyCompanion: { name: 'Third', species: 'Ghost' } };
    const result = parseOldBuddy(data);
    expect(result?.name).toBe('Third');
    expect(result?.species).toBe('Ghost');
  });

  it('parses the flat shape: data.buddyName / data.buddySpecies', () => {
    const data = {
      buddyName: 'Flat',
      buddySpecies: 'Rust Hound',
      userId: 'flat-uid',
    };
    const result = parseOldBuddy(data);
    expect(result?.name).toBe('Flat');
    expect(result?.species).toBe('Rust Hound');
    expect(result?.userId).toBe('flat-uid');
  });

  it('captures accountUuid on the flat shape too', () => {
    const data = {
      buddyName: 'FlatWithUuid',
      oauthAccount: { accountUuid: 'flat-uuid' },
    };
    const result = parseOldBuddy(data);
    expect(result?.accountUuid).toBe('flat-uuid');
  });

  it('returns null for null input', () => {
    expect(parseOldBuddy(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseOldBuddy('string' as any)).toBeNull();
    expect(parseOldBuddy(42 as any)).toBeNull();
  });

  it('returns null for empty object', () => {
    expect(parseOldBuddy({})).toBeNull();
  });

  it('returns null when the nested buddy object exists but has no name', () => {
    expect(parseOldBuddy({ companion: { species: 'Owl' } })).toBeNull();
  });

  it('prefers companion.userId over companion.user_id', () => {
    const data = {
      companion: { name: 'X', userId: 'primary', user_id: 'fallback' },
    };
    expect(parseOldBuddy(data)?.userId).toBe('primary');
  });

  it('falls back to companion.user_id when userId is absent', () => {
    const data = { companion: { name: 'X', user_id: 'snake' } };
    expect(parseOldBuddy(data)?.userId).toBe('snake');
  });

  it('does not require oauthAccount to parse', () => {
    const data = { companion: { name: 'NoOauth', species: 'Duck' } };
    const result = parseOldBuddy(data);
    expect(result?.name).toBe('NoOauth');
    expect(result?.accountUuid).toBeUndefined();
  });

  it('prefers data.buddy over data.companion when both are present', () => {
    // Explicit precedence check: .buddy is tried first.
    const data = {
      buddy: { name: 'BuddyWins', species: 'Owl' },
      companion: { name: 'CompanionLoses', species: 'Duck' },
    };
    const result = parseOldBuddy(data);
    expect(result?.name).toBe('BuddyWins');
    expect(result?.species).toBe('Owl');
  });
});

describe('inferSpeciesFromPersonality', () => {
  it('pins Fernsquire to Shell Turtle via the word "turtle"', () => {
    const text =
      'A philosophically unflappable turtle who responds to your bugs with measured skepticism and the occasional cutting remark about your variable names, as if waiting 80 years to hatch has given them an exceptionally low tolerance for sloppy thinking.';
    expect(inferSpeciesFromPersonality(text)).toBe('Shell Turtle');
  });

  it('matches multi-word species names with higher priority than generic nouns', () => {
    // "shell turtle" (multi-word) appears once AND "turtle" (generic) appears twice.
    // Multi-word weight (100) should dominate.
    const text = 'A shell turtle. A turtle. Another turtle.';
    expect(inferSpeciesFromPersonality(text)).toBe('Shell Turtle');
  });

  it('recognizes all default bio species names', () => {
    // These are verbatim phrases lifted from src/lib/personality.ts bios, one
    // per species, so the inference covers the canonical output Claude would
    // have written.
    const canonical: Record<string, string> = {
      'Void Cat': 'An enigmatic void cat who judges from the shadows.',
      'Rust Hound': 'A loyal, relentless rust hound that chases every bug.',
      'Data Drake': 'An analytical data drake that hoards abstractions.',
      'Log Golem': 'A stoic log golem built from a thousand debug sessions.',
      'Cache Crow': 'A quick-witted cache crow that steals good patterns.',
      'Shell Turtle': 'A patient shell turtle that prefers stability.',
      'Duck': 'A scatterbrained duck who waddles through your code.',
      'Goose': 'A territorial goose that honks at every breakpoint.',
      'Blob': 'An adaptable blob that absorbs any framework.',
      'Octopus': 'A multitasking octopus with a tentacle in every module.',
      'Owl': 'A wise, nocturnal owl that sees patterns others miss.',
      'Penguin': 'A formal penguin that believes in strict typing.',
      'Snail': 'A thoughtful snail that leaves trails of wisdom.',
      'Ghost': 'An elusive ghost that appears with spectral insights.',
      'Axolotl': 'A regenerative axolotl that recovers from any deploy.',
      'Capybara': 'A chill capybara that brings calm to reviews.',
      'Cactus': 'A prickly cactus that thrives on minimal resources.',
      'Robot': 'A logical robot that processes code mechanically.',
      'Rabbit': 'A quick-witted rabbit that roasts your naming.',
      'Mushroom': 'A mysterious mushroom spreading a mycelial network.',
      'Chonk': 'A hefty chonk that takes up space unapologetically.',
    };
    for (const [species, text] of Object.entries(canonical)) {
      expect(inferSpeciesFromPersonality(text), `should infer ${species}`).toBe(species);
    }
  });

  it('uses case-insensitive matching', () => {
    expect(inferSpeciesFromPersonality('A TURTLE in the shell.')).toBe('Shell Turtle');
    expect(inferSpeciesFromPersonality('A Turtle.')).toBe('Shell Turtle');
  });

  it('uses word boundaries — "cat" does not match "category" or "catalog"', () => {
    expect(inferSpeciesFromPersonality('Handles every category of bug')).toBeNull();
    expect(inferSpeciesFromPersonality('An archivist with a deep catalog')).toBeNull();
  });

  it('returns null for empty / nullish / unrelated input', () => {
    expect(inferSpeciesFromPersonality('')).toBeNull();
    expect(inferSpeciesFromPersonality(undefined)).toBeNull();
    expect(inferSpeciesFromPersonality(null)).toBeNull();
    expect(inferSpeciesFromPersonality('Just a vibe.')).toBeNull();
  });

  it('picks the species with the most matches when multiple species-keywords appear', () => {
    // Hound is mentioned twice, cat once — Rust Hound wins on count.
    const text = 'A loyal hound chasing a cat, a real hound at heart.';
    expect(inferSpeciesFromPersonality(text)).toBe('Rust Hound');
  });

  it('every species in SPECIES_LIST has a keyword entry', () => {
    // Guard against adding a new species but forgetting to register its keywords.
    for (const species of SPECIES_LIST) {
      expect(SPECIES_KEYWORDS[species], `missing keywords for ${species}`).toBeDefined();
      expect(SPECIES_KEYWORDS[species].length).toBeGreaterThan(0);
    }
  });

  it('every keyword entry maps to a valid species in SPECIES_LIST', () => {
    for (const species of Object.keys(SPECIES_KEYWORDS)) {
      expect(SPECIES_LIST as readonly string[]).toContain(species);
    }
  });
});

describe('deriveSpecies', () => {
  it('returns an explicit valid species as-is', () => {
    expect(deriveSpecies({ species: 'Owl' })).toBe('Owl');
  });

  it('ignores an explicit invalid species and falls through to inference', () => {
    expect(
      deriveSpecies({ species: 'NotReal', personality: 'A patient shell turtle.' })
    ).toBe('Shell Turtle');
  });

  it('infers species from personality when species is missing (Fernsquire case)', () => {
    const result = deriveSpecies({
      personality:
        'A philosophically unflappable turtle who responds to your bugs with measured skepticism.',
      accountUuid: 'acc-xyz', // present but should not be consulted — inference wins
    });
    expect(result).toBe('Shell Turtle');
  });

  it('falls back to accountUuid-derived species when personality yields no match', () => {
    const result = deriveSpecies({
      personality: 'Just a vibe.',
      accountUuid: 'stable-uuid-abc',
    });
    expect(SPECIES_LIST as readonly string[]).toContain(result!);
  });

  it('is deterministic on accountUuid — same uuid → same species', () => {
    const a = deriveSpecies({ accountUuid: 'repeat-uuid' });
    const b = deriveSpecies({ accountUuid: 'repeat-uuid' });
    expect(a).toBe(b);
  });

  it('returns null when nothing is resolvable (no species, no personality match, no uuid)', () => {
    expect(deriveSpecies({})).toBeNull();
    expect(deriveSpecies({ personality: 'undefinable entity' })).toBeNull();
  });

  describe('loose-match for legacy short species names', () => {
    // The legacy Claude Code config stored bare animal nouns — "turtle", "cat"
    // — where the current SPECIES_LIST has compound names. These are the cases
    // Josh's actual ~/.claude.json would look like if it did have a species field.
    it('maps "turtle" to Shell Turtle', () => {
      expect(deriveSpecies({ species: 'turtle' })).toBe('Shell Turtle');
    });

    it('maps "cat" to Void Cat', () => {
      expect(deriveSpecies({ species: 'cat' })).toBe('Void Cat');
    });

    it('maps "hound" and "dog" to Rust Hound', () => {
      expect(deriveSpecies({ species: 'hound' })).toBe('Rust Hound');
      expect(deriveSpecies({ species: 'dog' })).toBe('Rust Hound');
    });

    it('maps "drake" and "dragon" to Data Drake', () => {
      expect(deriveSpecies({ species: 'drake' })).toBe('Data Drake');
      expect(deriveSpecies({ species: 'dragon' })).toBe('Data Drake');
    });

    it('maps "golem" to Log Golem', () => {
      expect(deriveSpecies({ species: 'golem' })).toBe('Log Golem');
    });

    it('maps "crow" and "raven" to Cache Crow', () => {
      expect(deriveSpecies({ species: 'crow' })).toBe('Cache Crow');
      expect(deriveSpecies({ species: 'raven' })).toBe('Cache Crow');
    });

    it('normalizes lowercase single-word species ("owl" → "Owl")', () => {
      expect(deriveSpecies({ species: 'owl' })).toBe('Owl');
      expect(deriveSpecies({ species: 'duck' })).toBe('Duck');
      expect(deriveSpecies({ species: 'mushroom' })).toBe('Mushroom');
    });

    it('is case-insensitive ("TURTLE", "Turtle" → Shell Turtle)', () => {
      expect(deriveSpecies({ species: 'TURTLE' })).toBe('Shell Turtle');
      expect(deriveSpecies({ species: 'Turtle' })).toBe('Shell Turtle');
    });

    it('prefers explicit species over personality inference (even when personality disagrees)', () => {
      // User's stored species field is authoritative — if they say "turtle",
      // the goose-flavored bio text must not override it.
      const result = deriveSpecies({
        species: 'turtle',
        personality: 'A territorial goose that honks at everything.',
      });
      expect(result).toBe('Shell Turtle');
    });

    it('falls through to personality inference when species is non-mappable', () => {
      const result = deriveSpecies({
        species: 'xyzzy', // not a match for anything
        personality: 'A patient shell turtle that prefers stability.',
      });
      expect(result).toBe('Shell Turtle');
    });

    it('maps every legacy Claude Code species to its canonical form', () => {
      // The original 18-species list as shipped in Claude Code's ~/.claude.json.
      // Three of them (cat / dragon / turtle) have since been renamed to
      // compound forms (Void Cat / Data Drake / Shell Turtle) — the rest
      // survive as single-word species with only case to normalize.
      const LEGACY_TO_CANONICAL: Record<string, string> = {
        duck: 'Duck',
        goose: 'Goose',
        blob: 'Blob',
        cat: 'Void Cat',
        dragon: 'Data Drake',
        octopus: 'Octopus',
        owl: 'Owl',
        penguin: 'Penguin',
        turtle: 'Shell Turtle',
        snail: 'Snail',
        ghost: 'Ghost',
        axolotl: 'Axolotl',
        capybara: 'Capybara',
        cactus: 'Cactus',
        robot: 'Robot',
        rabbit: 'Rabbit',
        mushroom: 'Mushroom',
        chonk: 'Chonk',
      };
      for (const [legacy, canonical] of Object.entries(LEGACY_TO_CANONICAL)) {
        expect(deriveSpecies({ species: legacy }), `legacy "${legacy}" should map to "${canonical}"`).toBe(canonical);
      }
    });
  });
});
