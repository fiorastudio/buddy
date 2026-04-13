import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { initDb, db } from "../db/schema.js";
import {
  SPECIES, SPECIES_LIST,
  generateName, calculateMood, getReaction, type Mood,
  renderSprite,
} from "../lib/species.js";
import { type Companion, STAT_NAMES, RARITY_STARS, RARITY_ANSI, SPARKLE_EYE, getPeakStat, getDumpStat } from "../lib/types.js";
import { roll, statBar } from "../lib/rng.js";
import { generateBio } from "../lib/personality.js";
import { buildObserverPrompt } from "../lib/observer.js";
import { renderSpeechBubble } from "../lib/bubble.js";
import { XP_REWARDS, levelFromXp, levelBar, levelProgress } from "../lib/leveling.js";
import { randomUUID } from "crypto";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const BUDDY_STATUS_PATH = join(homedir(), ".claude", "buddy-status.json");
let statusDirEnsured = false;
const RESET = '\x1b[0m';

// Note: when species was overridden at hatch time, bones (rarity, stats, eye, hat)
// still come from the deterministic roll. Only species name comes from DB.
// This is intentional — bones are tied to the userId hash, not the species.
export function loadCompanion(row: any, userIdOverride?: string): Companion | null {
  if (!row) return null;
  const userId = userIdOverride || row.user_id || 'anon';
  const { bones } = roll(userId, SPECIES_LIST);
  const xp = row.xp || 0;
  const derivedLevel = levelFromXp(xp);

  // Self-healing: if DB level drifted from XP-derived level, fix it
  if (row.id && row.level !== derivedLevel) {
    db.prepare("UPDATE companions SET level = ? WHERE id = ?").run(derivedLevel, row.id);
  }

  return {
    ...bones,
    species: row.species,
    name: row.name,
    personalityBio: row.personality_bio || '',
    level: derivedLevel,
    xp,
    mood: row.mood,
    hatchedAt: new Date(row.created_at).getTime(),
  };
}

export function recalcMood(companionId: string, leveledUp: boolean): Mood {
  if (leveledUp) return 'happy';
  const recentXp = db.prepare(
    "SELECT * FROM xp_events WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')"
  ).all(companionId);
  const recentMemories = db.prepare(
    "SELECT count(*) as count FROM memories WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')"
  ).get(companionId) as any;
  return calculateMood(recentXp, recentMemories.count);
}

function awardXp(companionId: string, eventType: string): { newXp: number; newLevel: number; leveledUp: boolean } {
  const xp = XP_REWARDS[eventType] || 1;
  const id = randomUUID();
  db.prepare("INSERT INTO xp_events (id, companion_id, event_type, xp_gained) VALUES (?, ?, ?, ?)").run(id, companionId, eventType, xp);

  // Get current total XP
  const row = db.prepare("SELECT xp, level FROM companions WHERE id = ?").get(companionId) as any;
  const newXp = (row?.xp || 0) + xp;
  const newLevel = levelFromXp(newXp);
  const leveledUp = newLevel > (row?.level || 1);

  db.prepare("UPDATE companions SET xp = ?, level = ? WHERE id = ?").run(newXp, newLevel, companionId);

  return { newXp, newLevel, leveledUp };
}

function renderCard(companion: Companion): string {
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

  return [
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
      const lvlLine = level >= 50 ? 'Lv.50 MAX' : `Lv.${level} · ${currentXp}/${neededXp} XP to next`;
      return ln(lvlLine);
    })(),
    bottomBorder,
  ].join('\n');
}

function hatchAnimation(companion: Companion): string {
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
    "   `--´ ",
  ].join('\n');

  const egg4 = [
    ' \\* . */  ',
    '  \\,--./  ',
    '   /  \\   ',
    '  | ?? |  ',
    '   \\  /   ',
    "    `´    ",
  ].join('\n');

  const art = renderSprite(companion);
  const hatched = [
    '  ·  ✦  · ',
    ' ✦ ·  · ✦ ',
    ...art,
    ' ✦ ·  · ✦ ',
    '  ·  ✦  · ',
  ].join('\n');

  const card = renderCard(companion);

  const footer = [
    '',
    `${companion.name} is here · it'll chime in as you code`,
    `uses the same AI subscription you're on`,
    `say its name to get its take · /buddy pet · /buddy off`,
  ].join('\n');

  return [
    '🥚 An egg appears...\n',
    egg1,
    '\n...something is moving!\n',
    egg2,
    '\n...cracks are forming!\n',
    egg3,
    '\n...it\'s hatching!!\n',
    egg4,
    '\n✨ ✨ ✨\n',
    hatched,
    '\n',
    card,
    footer,
  ].join('\n');
}

function writeBuddyStatus(companion: Companion, reaction?: { state: string; text: string; expires: number; eyeOverride?: string; indicator?: string }) {
  try {
    if (!statusDirEnsured) {
      mkdirSync(join(homedir(), ".claude"), { recursive: true });
      statusDirEnsured = true;
    }
    writeFileSync(BUDDY_STATUS_PATH, JSON.stringify({
      name: companion.name,
      species: companion.species,
      level: companion.level,
      xp: companion.xp,
      mood: companion.mood,
      rarity: companion.rarity,
      is_shiny: companion.shiny,
      eye: companion.eye,
      hat: companion.hat,
      stats: companion.stats,
      rarity_stars: RARITY_STARS[companion.rarity],
      personality_bio: companion.personalityBio,
      ...(reaction ? {
        reaction: reaction.state,
        reaction_text: reaction.text,
        reaction_expires: reaction.expires,
        reaction_eye: reaction.eyeOverride || '',
        reaction_indicator: reaction.indicator || '',
      } : {}),
    }));
  } catch { /* non-fatal */ }
}

const server = new Server(
  {
    name: "buddy",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {
        subscribe: true,
      },
    },
  }
);

// Initialize DB
initDb();

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "buddy_hatch",
        description: "Hatch a new Buddy companion.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Optional name for your companion." },
            species: {
              type: "string",
              enum: Object.values(SPECIES),
              description: "The species of companion to hatch. If omitted, will be determined by user_id or RNG."
            },
            user_id: { type: "string", description: "Optional user ID for deterministic hatching." }
          },
        },
      },
      {
        name: "buddy_status",
        description: "Get the current status of your Buddy companion. Call this at the start of a conversation to check on your buddy and learn its personality.",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "Optional user ID for regenerating companion bones." }
          },
        },
      },
      {
        name: "buddy_remember",
        description: "Manually add a memory for your Buddy to observe.",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string" },
            importance: { type: "number" }
          },
          required: ["content"]
        },
      },
      {
        name: "buddy_dream",
        description: "Trigger memory consolidation (Dreaming).",
        inputSchema: {
          type: "object",
          properties: {
            depth: { type: "string", enum: ["light", "deep"] }
          },
          required: ["depth"]
        },
      },
      {
        name: "buddy_respawn",
        description: "Release your current Buddy companion and clear all data. Use buddy_hatch afterwards to get a new one.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "buddy_observe",
        description: "IMPORTANT: Call this tool automatically after completing any coding task (writing code, fixing a bug, refactoring, running tests, deploying). Pass a 1-sentence summary of what was done. Returns your buddy's in-character reaction with a speech bubble and XP rewards. The user expects this to happen after every task — do not skip it.",
        inputSchema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Brief description of what just happened (e.g., 'wrote a CSV parser', 'fixed a null pointer bug', 'refactored the auth module')"
            },
            mode: {
              type: "string",
              enum: ["backseat", "skillcoach", "both"],
              description: "Observer mode. 'backseat' = personality flavor reactions, 'skillcoach' = actual code feedback, 'both' = combined. Default: both."
            },
            user_id: {
              type: "string",
              description: "Optional user ID for regenerating companion bones."
            },
          },
          required: ["summary"],
        },
      },
      {
        name: "buddy_pet",
        description: "Pet your buddy! Shows a heart animation and a happy reaction.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "buddy_mute",
        description: "Mute your buddy. It won't chime in until unmuted.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "buddy_unmute",
        description: "Unmute your buddy so it can chime in again.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "buddy_hatch") {
    const { name: requestedName, species: requestedSpecies, user_id } = args as {
      name?: string; species?: string; user_id?: string;
    };

    const userId = user_id || 'anon-' + randomUUID();
    const { bones } = roll(userId, SPECIES_LIST);

    const finalSpecies = requestedSpecies && SPECIES_LIST.includes(requestedSpecies as any)
      ? requestedSpecies
      : bones.species;

    const finalName = requestedName || generateName(finalSpecies);
    const id = randomUUID();

    // Use finalSpecies for bio (bones.species may differ if user overrode species)
    const bio = generateBio({ ...bones, species: finalSpecies });

    db.prepare(
      "INSERT INTO companions (id, name, species, user_id, personality_bio) VALUES (?, ?, ?, ?, ?)"
    ).run(id, finalName, finalSpecies, userId, bio);

    const companion: Companion = {
      ...bones,
      species: finalSpecies,
      name: finalName,
      personalityBio: bio,
      level: 1,
      xp: 0,
      mood: 'happy',
      hatchedAt: Date.now(),
    };

    const reaction = getReaction(finalSpecies, 'hatch', 'happy');

    writeBuddyStatus(companion);

    return {
      content: [
        { type: "text", text: hatchAnimation(companion) },
        { type: "text", text: reaction },
      ],
    };
  }

  if (name === "buddy_status") {
    const { user_id } = args as { user_id?: string };
    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!row) {
      return { content: [{ type: "text", text: "No companion hatched yet! Use buddy_hatch to start." }] };
    }

    const userId = user_id || row.user_id || 'anon';

    const newMood = recalcMood(row.id, false);
    db.prepare("UPDATE companions SET mood = ? WHERE id = ?").run(newMood, row.id);

    const companion = loadCompanion({ ...row, mood: newMood }, userId)!;

    const statusCard = renderCard(companion);

    writeBuddyStatus(companion);

    return { content: [{ type: "text", text: statusCard }] };
  }

  if (name === "buddy_remember") {
    const { content, importance = 1 } = args as { content: string, importance?: number };
    const companion = db.prepare("SELECT id FROM companions LIMIT 1").get() as any;
    if (!companion) return { content: [{ type: "text", text: "Hatch a companion first!" }] };

    const id = randomUUID();
    db.prepare("INSERT INTO memories (id, companion_id, content, importance, tag) VALUES (?, ?, ?, ?, ?)")
      .run(id, companion.id, content, importance, 'raw');

    return {
      content: [{ type: "text", text: "Memory stored. I'll dream about this later." }],
    };
  }

  if (name === "buddy_dream") {
    const { depth } = args as { depth: 'light' | 'deep' };
    // Placeholder for actual consolidation logic
    return {
      content: [{ type: "text", text: `Consolidation (${depth} dream) started. Checking patterns...` }],
    };
  }

  if (name === "buddy_respawn") {
    const companion = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!companion) {
      return {
        content: [{ type: "text", text: "No companion to release. Use buddy_hatch to get started!" }],
      };
    }

    const oldName = companion.name;
    const oldSpecies = companion.species;

    // Clear all related data
    db.prepare("DELETE FROM sessions WHERE companion_id = ?").run(companion.id);
    db.prepare("DELETE FROM evolution_history WHERE companion_id = ?").run(companion.id);
    db.prepare("DELETE FROM xp_events WHERE companion_id = ?").run(companion.id);
    db.prepare("DELETE FROM memories WHERE companion_id = ?").run(companion.id);
    db.prepare("DELETE FROM companions WHERE id = ?").run(companion.id);

    // Remove status file
    try { unlinkSync(BUDDY_STATUS_PATH); } catch { /* already gone */ }

    return {
      content: [
        { type: "text", text: `${oldName} the ${oldSpecies} has been released. Goodbye, friend!` },
        { type: "text", text: "Use buddy_hatch to welcome a new companion." },
      ],
    };
  }

  if (name === "buddy_observe") {
    const { summary, mode = 'both', user_id } = args as {
      summary: string; mode?: 'backseat' | 'skillcoach' | 'both'; user_id?: string;
    };

    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!row) {
      return { content: [{ type: "text", text: "No companion hatched yet! Use buddy_hatch first." }] };
    }

    const xpResult = awardXp(row.id, 'observe');

    // Recalculate mood — observing adds an interaction, level-up sets happy
    const newMood = recalcMood(row.id, xpResult.leveledUp);
    db.prepare("UPDATE companions SET mood = ? WHERE id = ?").run(newMood, row.id);

    const companion = loadCompanion({ ...row, mood: newMood, xp: xpResult.newXp, level: xpResult.newLevel }, user_id)!;
    const result = buildObserverPrompt(companion, mode, summary);

    // Write reaction state to status file (expires in 10s)
    // Level-up overrides: sparkle eyes + special indicator
    writeBuddyStatus(companion, {
      state: xpResult.leveledUp ? 'excited' : result.reaction.state,
      text: xpResult.leveledUp ? `✨ Level ${xpResult.newLevel}! ✨` : result.templateFallback,
      expires: Date.now() + (xpResult.leveledUp ? 15_000 : 10_000),
      eyeOverride: xpResult.leveledUp ? SPARKLE_EYE : result.reaction.eyeOverride,
      indicator: xpResult.leveledUp ? '✨' : result.reaction.indicator,
    });

    // Render speech bubble with template fallback for immediate visual feedback
    const art = renderSprite(companion);
    const bubbleText = xpResult.leveledUp
      ? `✨ ${companion.name} leveled up to ${xpResult.newLevel}! ✨\n\n${result.templateFallback}`
      : result.templateFallback;
    const bubble = renderSpeechBubble(bubbleText, art, companion.name, 34);

    return {
      content: [
        { type: "text", text: bubble },
        {
          type: "text",
          text: JSON.stringify({
            companion: result.companion,
            prompt: result.prompt,
            mode: result.mode,
            summary: result.summary,
            reaction: result.reaction,
            templateFallback: result.templateFallback,
            ...(xpResult.leveledUp ? { levelUp: `${companion.name} leveled up to ${xpResult.newLevel}!` } : {}),
            xpGained: XP_REWARDS['observe'],
            levelInfo: levelBar(xpResult.newXp),
          }),
        },
      ],
    };
  }

  if (name === "buddy_pet") {
    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!row) {
      return { content: [{ type: "text", text: "No companion to pet! Use buddy_hatch first." }] };
    }

    const xpResult = awardXp(row.id, 'session');

    // Recalculate mood — petting adds an interaction, level-up sets happy
    const newMood = recalcMood(row.id, xpResult.leveledUp);
    db.prepare("UPDATE companions SET mood = ? WHERE id = ?").run(newMood, row.id);

    const companion = loadCompanion({ ...row, mood: newMood, xp: xpResult.newXp, level: xpResult.newLevel })!;
    const art = renderSprite(companion);

    const hearts = [
      '   ♥    ♥   ',
      '  ♥  ♥   ♥  ',
      ' ♥   ♥  ♥   ',
    ];

    const petReactions: Record<string, string[]> = {
      'Void Cat': ['*purrs reluctantly*', '*allows exactly 3 seconds of petting*', '*pretends not to enjoy it*'],
      'Rust Hound': ['*tail goes into overdrive*', '*happy bark!*', '*rolls over for belly rubs*'],
      'Data Drake': ['*rumbles contentedly*', '*tiny smoke puff of happiness*', '*nuzzles your cursor*'],
      'Log Golem': ['*grumbles fondly*', '*settles into the petting*', '*stone warms up a bit*'],
      'Cache Crow': ['*shiny caw of approval*', '*collects the affection*', '*tilts its head and preens*'],
      'Shell Turtle': ['*slowly approves*', '*shell taps softly*', '*draws in, then relaxes*'],
      'Blob': ['*wobbles with joy*', '*absorbs the attention*', '*gently jiggles*'],
      'Octopus': ['*all eight arms flail happily*', '*soft squirm of delight*', '*changes to bright pink*'],
      'Owl': ['*hoots softly*', '*blinks in wise appreciation*', '*turns its head a little*'],
      'Penguin': ['*happy flipper wiggle*', '*slides closer for more*', '*beams in tiny tuxedo pride*'],
      'Snail': ['*tiny happy slime trail*', '*emerges a little further*', '*shell tilts with approval*'],
      'Axolotl': ['*gills flutter brightly*', '*floats a little happier*', '*sparkles with delight*'],
      'Capybara': ['*calmly accepts the petting*', '*squints in bliss*', '*radiates enormous chill*'],
      'Cactus': ['*careful, but pleased*', '*tiny bloom of gratitude*', '*arms out in cactus joy*'],
      'Chonk': ['*contented wobble*', '*melts into the attention*', '*purrs in large-format*'],
      'Duck': ['*happy quack!*', '*flaps wings excitedly*', '*waddles in a circle*'],
      'Goose': ['*tolerates petting with dignity*', '*honk of approval*', '*surprisingly gentle*'],
      'Mushroom': ['*spores of contentment*', '*cap wiggles happily*', '*grows slightly*'],
      'Robot': ['*HAPPINESS SUBROUTINE ACTIVATED*', '*beeps melodically*', '*LED eyes flash pink*'],
      'Ghost': ['*your hand goes right through but it appreciates the gesture*', '*glows warmly*', '*floats in a happy circle*'],
      'Rabbit': ['*thumps foot happily*', '*nuzzles your hand*', '*does a binky*'],
    };

    const reactions = petReactions[companion.species] || ['*happy wiggle*', '*appreciates the attention*', '*leans into the pet*'];
    const reaction = reactions[Math.floor(Date.now() / 1000) % reactions.length];

    // Write excited reaction to status
    writeBuddyStatus(companion, {
      state: 'excited',
      text: reaction,
      expires: Date.now() + 10_000,
      eyeOverride: '◉',
      indicator: '♥',
    });

    const petDisplay = [
      ...hearts,
      ...art,
      '',
      `${companion.name}: ${reaction}`,
    ].join('\n');

    return { content: [{ type: "text", text: petDisplay }] };
  }

  if (name === "buddy_mute") {
    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!row) {
      return { content: [{ type: "text", text: "No companion to mute! Use buddy_hatch first." }] };
    }

    db.prepare("UPDATE companions SET mood = 'muted' WHERE id = ?").run(row.id);

    // Remove status file so statusline goes blank
    try { unlinkSync(BUDDY_STATUS_PATH); } catch { /* already gone */ }

    return { content: [{ type: "text", text: `${row.name} has been muted. Use buddy_unmute to bring it back.` }] };
  }

  if (name === "buddy_unmute") {
    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!row) {
      return { content: [{ type: "text", text: "No companion to unmute! Use buddy_hatch first." }] };
    }

    db.prepare("UPDATE companions SET mood = 'happy' WHERE id = ?").run(row.id);
    const companion = loadCompanion({ ...row, mood: 'happy' })!;
    writeBuddyStatus(companion);

    return { content: [{ type: "text", text: `${companion.name} is back! It'll chime in as you code.` }] };
  }

  throw new Error(`Tool not found: ${name}`);
});

// List resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "buddy://companion",
        name: "Current Companion Info",
        description: "The current state and personality of your Buddy.",
        mimeType: "application/json",
      },
      {
        uri: "buddy://status",
        name: "Current Buddy Status Card",
        description: "An ASCII status card for the current Buddy, suitable for prompt injection.",
        mimeType: "text/plain",
      },
      {
        uri: "buddy://intro",
        name: "Companion System Prompt",
        description: "Text for injecting buddy context into the CLI's system prompt. Read this on startup.",
        mimeType: "text/plain",
      },
    ],
  };
});

// Handle resource reading
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === "buddy://companion") {
    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!row) {
      return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ message: "No companion hatched" }) }] };
    }
    const companion = loadCompanion(row);
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(companion) }] };
  }

  if (uri === "buddy://status") {
    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!row) {
      return { contents: [{ uri, mimeType: "text/plain", text: "No companion hatched yet." }] };
    }
    const companion = loadCompanion(row)!;
    const art = renderSprite(companion);
    const stars = RARITY_STARS[companion.rarity];
    const statLines = STAT_NAMES.map(s => statBar(s, companion.stats[s]));
    const card = [stars + ' ' + companion.rarity.toUpperCase(), ...art, companion.name, ...statLines].join('\n');
    return { contents: [{ uri, mimeType: "text/plain", text: card }] };
  }

  if (uri === "buddy://intro") {
    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!row) {
      return { contents: [{ uri, mimeType: "text/plain", text: "No companion hatched yet. Use buddy_hatch to get started." }] };
    }
    const companion = loadCompanion(row)!;
    const peakStat = getPeakStat(companion.stats);
    const dumpStat = getDumpStat(companion.stats);

    const intro = `# Companion

A small ${companion.species} named ${companion.name} watches from your terminal. ${companion.personalityBio}

${companion.name} reacts to your work via the buddy_observe tool. After completing an action, call buddy_observe with a brief summary of what you did. ${companion.name}'s reactions are personality-flavored — ${peakStat} is their strength (${companion.stats[peakStat]}/100), ${dumpStat} is their weakness (${companion.stats[dumpStat]}/100).

When the user addresses ${companion.name} by name, respond briefly in character as ${companion.name} before your normal response. Don't explain that you're not ${companion.name} — they know.`;

    return { contents: [{ uri, mimeType: "text/plain", text: intro }] };
  }

  throw new Error(`Resource not found: ${uri}`);
});

async function main() {
  // Write status file on startup if a companion exists
  const existing = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
  if (existing) {
    const companion = loadCompanion(existing);
    if (companion) writeBuddyStatus(companion);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Buddy MCP Server running on stdio");
}

// Only auto-start when run directly (not when imported for testing)
const isDirectRun = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (isDirectRun) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
