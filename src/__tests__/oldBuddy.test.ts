import { describe, it, expect } from 'vitest';
import {
  parseOldBuddy,
  inferSpeciesFromPersonality,
  deriveSpecies,
  rollWithCCCompat,
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

    it('infers species from companion name', () => {
      expect(deriveSpecies({ name: 'Gritblob' })).toBe('Blob');
      expect(deriveSpecies({ name: 'ShadowCat' })).toBe('Void Cat');
      expect(deriveSpecies({ name: 'Ducksworth' })).toBe('Duck');
      expect(deriveSpecies({ name: 'Shroomsworth' })).toBe('Mushroom');
    });

    it('name inference is tried before personality', () => {
      // Name says "blob", personality says "turtle" — name wins
      expect(deriveSpecies({
        name: 'Gritblob',
        personality: 'a turtle who likes to swim',
      })).toBe('Blob');
    });

    it('falls back to personality when name has no keywords', () => {
      expect(deriveSpecies({
        name: 'Sparky',
        personality: 'a patient troubleshooter turtle',
      })).toBe('Shell Turtle');
    });
  });
});

describe('parseOldBuddy — top-level userID', () => {
  it('pulls userID from top-level .claude.json (CC format)', () => {
    const data = {
      userID: 'top-level-uid-123',
      companion: {
        name: 'Gritblob',
        personality: 'A patient troubleshooter',
        hatchedAt: 1775047109797,
      },
    };
    const result = parseOldBuddy(data);
    expect(result?.userId).toBe('top-level-uid-123');
  });

  it('companion-level userId takes precedence over top-level', () => {
    const data = {
      userID: 'top-level',
      companion: {
        name: 'Test',
        userId: 'companion-level',
      },
    };
    const result = parseOldBuddy(data);
    expect(result?.userId).toBe('companion-level');
  });

  it('flat shape also picks up top-level userID', () => {
    const data = {
      userID: 'top-uid',
      buddyName: 'FlatBuddy',
      buddySpecies: 'Duck',
    };
    const result = parseOldBuddy(data);
    expect(result?.userId).toBe('top-uid');
  });
});

describe('rollWithCCCompat', () => {
  it('returns valid bones with all required fields', () => {
    const { bones, engine } = rollWithCCCompat('test-user-id');
    expect(bones).toHaveProperty('species');
    expect(bones).toHaveProperty('eye');
    expect(bones).toHaveProperty('rarity');
    expect(bones).toHaveProperty('stats');
    expect(bones).toHaveProperty('hat');
    expect(bones).toHaveProperty('shiny');
    expect(['bun', 'fnv1a']).toContain(engine);
  }, 15000);

  it('is deterministic for the same userId', () => {
    const a = rollWithCCCompat('determinism-test');
    const b = rollWithCCCompat('determinism-test');
    expect(a.bones.stats).toEqual(b.bones.stats);
    expect(a.bones.species).toBe(b.bones.species);
    expect(a.bones.eye).toBe(b.bones.eye);
    expect(a.bones.rarity).toBe(b.bones.rarity);
  }, 15000);

  it('produces different results for different userIds', () => {
    const a = rollWithCCCompat('user-alpha');
    const b = rollWithCCCompat('user-beta');
    // Stats should differ (extremely unlikely to match by chance)
    expect(a.bones.stats).not.toEqual(b.bones.stats);
  }, 15000);

  // A two-userId comparison reads as "unlucky fixture" when it fails. It
  // wasn't: `bun -e <script> <arg>` silently drops trailing arguments, so the
  // hash input was a constant and EVERY rescued companion rolled identical
  // bones. Sampling many ids makes that failure mode unmistakable.
  // Sample size is a deliberate tradeoff. Each roll spawns a `bun`
  // subprocess whose cost is ~9ms warm but seconds under load, and these
  // tests are already timing-fragile for that reason. A dozen ids is far more
  // than enough discrimination: the bug collapsed EVERY id to one vector, so
  // it fails at 1-of-12 with enormous margin, while adding a third of the
  // subprocess churn a larger sample would.
  it('spreads across many userIds rather than collapsing to one roll', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `spread-user-${i}`);
    const vectors = new Set(ids.map(id => JSON.stringify(rollWithCCCompat(id).bones.stats)));
    expect(vectors.size).toBeGreaterThan(ids.length / 2);
  }, 30000);

  it('species is from CC list (18 species, short names)', () => {
    const CC_SPECIES = [
      'duck', 'goose', 'blob', 'cat', 'dragon', 'octopus', 'owl', 'penguin',
      'turtle', 'snail', 'ghost', 'axolotl', 'capybara', 'cactus', 'robot',
      'rabbit', 'mushroom', 'chonk',
    ];
    const { bones } = rollWithCCCompat('species-test');
    expect(CC_SPECIES).toContain(bones.species);
  }, 15000);

  it('eye is never ✦ (sparkle reserved in our system)', () => {
    // Single roll — Bun spawn is expensive, don't loop
    const { bones } = rollWithCCCompat('sparkle-eye-test');
    expect(bones.eye).not.toBe('✦');
  }, 15000);
});
