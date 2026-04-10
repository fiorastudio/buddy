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
  SPECIES, SPECIES_LIST, SPECIES_ART, SPECIES_ANIMATIONS,
  generateName, calculateMood, getReaction,
  renderSprite, renderFace, spriteFrameCount,
} from "../lib/species.js";
import { type Companion, STAT_NAMES, RARITY_STARS, RARITY_ANSI } from "../lib/types.js";
import { roll, statBar } from "../lib/rng.js";
import { generateBio } from "../lib/personality.js";
import { buildObserverPrompt } from "../lib/observer.js";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const BUDDY_STATUS_PATH = join(homedir(), ".claude", "buddy-status.json");
const RESET = '\x1b[0m';

// Note: when species was overridden at hatch time, bones (rarity, stats, eye, hat)
// still come from the deterministic roll. Only species name comes from DB.
// This is intentional — bones are tied to the userId hash, not the species.
function loadCompanion(row: any, userIdOverride?: string): Companion | null {
  if (!row) return null;
  const userId = userIdOverride || row.user_id || 'anon';
  const { bones } = roll(userId, SPECIES_LIST);
  return {
    ...bones,
    species: row.species,
    name: row.name,
    personalityBio: row.personality_bio || '',
    level: row.level,
    xp: row.xp,
    mood: row.mood,
    hatchedAt: new Date(row.created_at).getTime(),
  };
}

function hatchAnimation(companion: Companion): string {
  const stars = RARITY_STARS[companion.rarity];
  const art = renderSprite(companion);
  const shinyTag = companion.shiny ? ' ✨ SHINY ✨' : '';
  const statLines = STAT_NAMES.map(s => statBar(s, companion.stats[s]));

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

  const hatched = [
    '  ·  ✦  · ',
    ' ✦ ·  · ✦ ',
    ...art,
    ' ✦ ·  · ✦ ',
    '  ·  ✦  · ',
  ].join('\n');

  const card = [
    '╔══════════════════════════════════════╗',
    `║  ${stars} ${companion.rarity.toUpperCase()}${shinyTag}`.padEnd(39) + '║',
    `║  ${companion.species}`.padEnd(39) + '║',
    '╠══════════════════════════════════════╣',
    '║' + ' '.repeat(38) + '║',
    ...art.map(l => '║  ' + l.padEnd(36) + '║'),
    '║' + ' '.repeat(38) + '║',
    `║  ${companion.name}`.padEnd(39) + '║',
    companion.personalityBio ? `║  "${companion.personalityBio}"`.padEnd(39) + '║' : null,
    '║' + ' '.repeat(38) + '║',
    ...statLines.map(l => '║  ' + l.padEnd(36) + '║'),
    '║' + ' '.repeat(38) + '║',
    '╚══════════════════════════════════════╝',
  ].filter(Boolean).join('\n');

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
  ].join('\n');
}

function writeBuddyStatus(companion: Companion, reaction?: { state: string; text: string; expires: number }) {
  try {
    mkdirSync(join(homedir(), ".claude"), { recursive: true });
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
        description: "Get the current status of your Buddy companion.",
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
        description: "Get your buddy's reaction to what just happened. Returns a personality prompt for the CLI's AI to generate an in-character response, plus a template fallback. Call this after completing an action to get your buddy's take.",
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
      }
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

    const userId = user_id || 'anon-' + Math.random().toString(36).substring(7);
    const { bones } = roll(userId, SPECIES_LIST);

    const finalSpecies = requestedSpecies && SPECIES_LIST.includes(requestedSpecies as any)
      ? requestedSpecies
      : bones.species;

    const finalName = requestedName || generateName(finalSpecies);
    const id = Math.random().toString(36).substring(7);

    const bio = generateBio(bones);

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

    const recentXp = db.prepare(
      "SELECT * FROM xp_events WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')"
    ).all(row.id);
    const recentMemories = db.prepare(
      "SELECT count(*) as count FROM memories WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')"
    ).get(row.id) as any;
    const newMood = calculateMood(recentXp, recentMemories.count);
    db.prepare("UPDATE companions SET mood = ? WHERE id = ?").run(newMood, row.id);

    const companion = loadCompanion({ ...row, mood: newMood }, userId)!;

    const art = renderSprite(companion);
    const stars = RARITY_STARS[companion.rarity];
    const shinyTag = companion.shiny ? ' ✨' : '';
    const statLines = STAT_NAMES.map(s => statBar(s, companion.stats[s]));

    const statusCard = [
      `${stars} ${companion.rarity.toUpperCase()}${shinyTag}  ${companion.species}`,
      '',
      ...art,
      '',
      `${companion.name}`,
      companion.personalityBio ? `"${companion.personalityBio}"` : '',
      '',
      ...statLines,
      '',
      `Level: ${companion.level}  XP: ${companion.xp}  Mood: ${companion.mood}`,
    ].filter(Boolean).join('\n');

    writeBuddyStatus(companion);

    return { content: [{ type: "text", text: statusCard }] };
  }

  if (name === "buddy_remember") {
    const { content, importance = 1 } = args as { content: string, importance?: number };
    const companion = db.prepare("SELECT id FROM companions LIMIT 1").get() as any;
    if (!companion) return { content: [{ type: "text", text: "Hatch a companion first!" }] };

    const id = Math.random().toString(36).substring(7);
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

    const companion = loadCompanion(row, user_id)!;
    const result = buildObserverPrompt(companion, mode, summary);

    // Write reaction state to status file (expires in 10s)
    writeBuddyStatus(companion, {
      state: result.reaction.state,
      text: result.templateFallback,
      expires: Date.now() + 10_000,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            companion: result.companion,
            prompt: result.prompt,
            mode: result.mode,
            summary: result.summary,
            reaction: result.reaction,
            templateFallback: result.templateFallback,
          }),
        },
      ],
    };
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
    const peakStat = STAT_NAMES.reduce((a, b) => companion.stats[a] > companion.stats[b] ? a : b);
    const dumpStat = STAT_NAMES.reduce((a, b) => companion.stats[a] < companion.stats[b] ? a : b);

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

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
