import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { initDb, db } from "../db/schema.js";
import { fileURLToPath } from "url";
import {
  SPECIES,
  calculateMood, getReaction, type Mood,
  renderSprite,
} from "../lib/species.js";
import { type Companion, STAT_NAMES, RARITY_STARS, SPARKLE_EYE, getPeakStat, getDumpStat } from "../lib/types.js";
import { statBar } from "../lib/rng.js";
import { getVoice, getNever } from "../lib/personality.js";
import { buildObserverPrompt } from "../lib/observer.js";
import { renderSpeechBubble } from "../lib/bubble.js";
import { XP_REWARDS, levelFromXp, levelBar } from "../lib/leveling.js";
import { randomUUID } from "crypto";
import { readFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { loadCompanion, writeBuddyStatus, createCompanion } from "../lib/companion.js";
import { renderCard, hatchAnimation } from "../lib/card.js";
import { BUDDY_STATUS_PATH } from "../lib/constants.js";
import { runDiagnostics, formatReport } from "../lib/doctor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VERSION: string = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8')
).version;

export function recalcMood(companionId: string, leveledUp: boolean): Mood {
  if (leveledUp) return 'happy';
  const xpCount = (db.prepare(
    "SELECT count(*) as count FROM xp_events WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')"
  ).get(companionId) as any)?.count || 0;
  const memCount = (db.prepare(
    "SELECT count(*) as count FROM memories WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')"
  ).get(companionId) as any)?.count || 0;
  // calculateMood expects (xpEvents[], memoryCount) — pass a dummy array with correct length
  return calculateMood(new Array(xpCount), memCount);
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

/**
 * Award XP, recalculate mood, update DB, and load companion — shared by observe + pet.
 */
function awardXpAndRefresh(row: any, eventType: string, userIdOverride?: string) {
  const xpResult = awardXp(row.id, eventType);
  const newMood = recalcMood(row.id, xpResult.leveledUp);
  db.prepare("UPDATE companions SET mood = ? WHERE id = ?").run(newMood, row.id);
  const companion = loadCompanion({ ...row, mood: newMood, xp: xpResult.newXp, level: xpResult.newLevel }, userIdOverride)!;
  return { companion, xpResult };
}


const server = new Server(
  {
    name: "buddy",
    version: VERSION,
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
      {
        name: "buddy_doctor",
        description: "Run diagnostics on your Buddy installation. Checks companion state, database, MCP registration, statusline, hooks, and prompt injection. Returns a report you can paste into bug reports. IMPORTANT: Include the full diagnostic report verbatim in a code block in your response.",
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

    const { companion } = createCompanion({
      userId: user_id,
      name: requestedName,
      species: requestedSpecies,
    });

    const reaction = getReaction(companion.species, 'hatch', 'happy');

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

    const { companion, xpResult } = awardXpAndRefresh(row, 'observe', user_id);
    const result = buildObserverPrompt(companion, mode, summary);

    // Render speech bubble with template fallback for immediate visual feedback
    const art = renderSprite(companion);
    const bubbleText = xpResult.leveledUp
      ? `✨ ${companion.name} leveled up to ${xpResult.newLevel}! ✨\n\n${result.templateFallback}`
      : result.templateFallback;
    const bubble = renderSpeechBubble(bubbleText, art, companion.name, 34);

    // Write reaction state to status file (expires in 10s)
    // Level-up overrides: sparkle eyes + special indicator
    // Include bubble_lines so the statusline can render the full speech bubble
    writeBuddyStatus(companion, {
      state: xpResult.leveledUp ? 'excited' : result.reaction.state,
      text: xpResult.leveledUp ? `✨ Level ${xpResult.newLevel}! ✨` : result.templateFallback,
      expires: Date.now() + (xpResult.leveledUp ? 45_000 : 30_000),
      eyeOverride: xpResult.leveledUp ? SPARKLE_EYE : result.reaction.eyeOverride,
      indicator: xpResult.leveledUp ? '✨' : result.reaction.indicator,
      bubbleLines: bubble.split('\n'),
    });

    return {
      content: [
        { type: "text", text: bubble },
        {
          type: "text",
          text: JSON.stringify({
            companion: result.companion,
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

    const { companion, xpResult } = awardXpAndRefresh(row, 'session');
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
      expires: Date.now() + 30_000,
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

  if (name === "buddy_doctor") {
    const checks = runDiagnostics();
    const report = formatReport(checks);
    return { content: [{ type: "text", text: '```\n' + report + '\n```' }] };
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

    const voice = getVoice(companion.species);
    const never = getNever(companion.species);

    const intro = `# Companion

A small ${companion.species} named ${companion.name} watches from your terminal. ${companion.personalityBio}

VOICE: ${voice}

NEVER (hard rules when speaking as ${companion.name}):
${never.map(n => `- ${n}`).join('\n')}

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
  if (process.env.BUDDY_DEBUG) {
    console.error("Buddy MCP Server running on stdio");
  }
}

// Only auto-start when run directly (not when imported for testing)
const isDirectRun = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (isDirectRun) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
