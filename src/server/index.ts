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
import {
  deriveSessionId,
  formatModeResponse,
  getStressedVoice,
  isValidSessionId,
  planModeChange,
  pruneOldSessions,
  purge,
  resolveProjectRoot,
  runMaxModePipeline,
  telemetry,
  type PurgeScope,
} from "../lib/reasoning/index.js";

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
        description: "Call after every coding task with a 1-sentence summary. Returns your buddy's in-character reaction + XP. In max mode, also pass claims/edges/cwd (schemas below); the observer prompt restates extraction guidance each turn.",
        inputSchema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Brief description of what just happened (e.g. 'wrote a CSV parser', 'fixed a null pointer bug')."
            },
            mode: {
              type: "string",
              enum: ["backseat", "skillcoach", "both"],
              description: "Voice mode. Default: companion's stored setting (usually 'both')."
            },
            user_id: { type: "string", description: "Optional user id for deterministic bones." },
            claims: {
              type: "array",
              description: "Max-mode only. 1-4 substantive assertions from the turn that just ended. Skip trivia/restatements.",
              items: {
                type: "object",
                properties: {
                  text: { type: "string", description: "≤240 chars, single sentence." },
                  basis: { type: "string", enum: ["research","empirical","deduction","analogy","definition","llm_output","assumption","vibes"], description: "Epistemic source: research=cited, empirical=measured, deduction=derived, analogy=X-is-like-Y, definition=naming, llm_output=model-ungrounded, assumption=stated-without-justification, vibes=unsourced-hunch." },
                  speaker: { type: "string", enum: ["user","assistant"] },
                  confidence: { type: "string", enum: ["low","medium","high"] },
                  external_id: { type: "string", description: "Unique within this payload, e.g. 'c1'." },
                },
                required: ["text","basis","speaker","confidence","external_id"],
              },
            },
            edges: {
              type: "array",
              description: "Max-mode only. Claim relationships. `from`/`to` reference external_ids in this payload OR 8-char UUID prefixes from 'Recent claims' in the observer prompt.",
              items: {
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  type: { type: "string", enum: ["supports","depends_on","contradicts","questions"] },
                },
                required: ["from","to","type"],
              },
            },
            cwd: {
              type: "string",
              description: "Strongly recommended in max mode. Absolute path of the project root — namespaces the reasoning graph per workspace. Without it, all projects collapse into one graph when the server wasn't launched from a project dir."
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
        name: "buddy_mode",
        description: "Set buddy's voice mode and/or max mode. Voice mode controls tone: 'backseat' (personality only), 'skillcoach' (code feedback), or 'both'. Max mode (boolean) turns on structural reasoning analysis — buddy notices when claims are load-bearing, unchallenged, or well-sourced, and weaves the observation into its in-character reaction. Both fields are orthogonal. Call with no arguments to see current settings.",
        inputSchema: {
          type: "object",
          properties: {
            voice: {
              type: "string",
              enum: ["backseat", "skillcoach", "both"],
              description: "The voice mode to set. Omit to leave unchanged."
            },
            max: {
              type: "boolean",
              description: "Turn max mode on or off. When on, buddy extracts claims from conversation and surfaces structural findings in character. Omit to leave unchanged."
            },
            mode: {
              type: "string",
              enum: ["backseat", "skillcoach", "both"],
              description: "Deprecated alias for 'voice'. Prefer 'voice' for new calls."
            }
          },
        },
      },
      {
        name: "buddy_forget",
        description: "Purge stored reasoning data (claims, edges, findings log). Scope 'session' clears one workspace/day graph; 'all' clears everything. Only affects the reasoning layer — companion, XP, and memories are untouched.",
        inputSchema: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              enum: ["session", "all"],
              description: "'session' (default) = one workspace/day only. 'all' = all stored claims across all workspaces."
            },
            session_id: {
              type: "string",
              description: "Optional explicit session id (format: <cwd-hash>-<YYYYMMDD>). Use with scope='session' to purge a workspace you're not currently in. Get ids from buddy_reasoning_status."
            },
            cwd: {
              type: "string",
              description: "Optional working-directory hint for scope='session'. Ignored if session_id is supplied."
            },
          },
        },
      },
      {
        name: "buddy_reasoning_status",
        description: "Inspect what max mode has stored: claim count, findings history, graph size per session. Useful for users who want to audit what's in buddy.db or debug max-mode behavior.",
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
    // Reasoning-layer companion-scoped state (findings log + observe seq).
    // Workspace-scoped state (reasoning_claims / reasoning_edges) is preserved —
    // a new companion in the same workspace inherits the accumulated graph.
    db.prepare("DELETE FROM reasoning_findings_log WHERE companion_id = ?").run(companion.id);
    db.prepare("DELETE FROM reasoning_observe_seq WHERE companion_id = ?").run(companion.id);
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
    const { summary, mode: modeArg, user_id, claims, edges, cwd } = args as {
      summary: string;
      mode?: 'backseat' | 'skillcoach' | 'both';
      user_id?: string;
      claims?: unknown;
      edges?: unknown;
      cwd?: string;
    };

    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!row) {
      return { content: [{ type: "text", text: "No companion hatched yet! Use buddy_hatch first." }] };
    }

    const { companion, xpResult } = awardXpAndRefresh(row, 'observe', user_id);
    // Priority: explicit arg > DB setting > default 'both'
    const mode: 'backseat' | 'skillcoach' | 'both' = modeArg || row.observer_mode || 'both';

    // Max-mode pipeline — strictly additive. Any failure drops to normal flow.
    const maxModeOn = (row.max_mode ?? 0) === 1;
    telemetry.incObserve(maxModeOn);

    let maxInjection: Parameters<typeof buildObserverPrompt>[3] = undefined;
    let maxModeSessionId: string | null = null;
    let maxModeWorkspace: string | null = null;
    let maxModeWorkspaceSource: string | null = null;
    if (maxModeOn) {
      try {
        // Pass the caller's hint as-is (undefined if absent). The pipeline's
        // resolveProjectRoot tries env vars and project-marker walk-up
        // before falling back to process.cwd(). Passing process.cwd() here
        // would short-circuit that search.
        const out = runMaxModePipeline(db, {
          companionId: row.id,
          cwd: typeof cwd === 'string' && cwd ? cwd : undefined,
          claims,
          edges,
        });
        maxInjection = {
          finding: out.finding,
          stressedVoice: out.finding ? getStressedVoice(companion.species) : null,
          extractionInstruction: out.extractionInstruction,
        };
        maxModeSessionId = out.sessionId;
        maxModeWorkspace = out.resolvedRoot.path;
        maxModeWorkspaceSource = out.resolvedRoot.source;
      } catch (err) {
        // Never let max-mode failures break observe. Fall through to a
        // normal (finding-less) reaction. Record the failure for the
        // doctor, and log under BUDDY_DEBUG so we have a thread to pull
        // on if this path starts firing in real usage.
        telemetry.recordPipelineFailure();
        if (process.env.BUDDY_DEBUG) {
          console.error('[buddy] max-mode pipeline failed:', err);
        }
        maxInjection = undefined;
      }
    }

    const result = buildObserverPrompt(companion, mode, summary, maxInjection);

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
            ...(result.finding ? { finding: { type: result.finding.type, claim: result.finding.claim_text } } : {}),
            ...(maxModeOn ? { maxMode: true } : {}),
            ...(maxModeSessionId ? { sessionId: maxModeSessionId } : {}),
            ...(maxModeWorkspace ? { workspace: maxModeWorkspace, workspaceSource: maxModeWorkspaceSource } : {}),
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

    // Write excited reaction + pet-hearts TTL to status
    writeBuddyStatus(companion, {
      state: 'excited',
      text: reaction,
      expires: Date.now() + 30_000,
      eyeOverride: '◉',
      indicator: '♥',
      petActiveUntil: Date.now() + 5_000,
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

  if (name === "buddy_mode") {
    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!row) {
      return { content: [{ type: "text", text: "No companion yet! Use buddy_hatch first." }] };
    }

    const plan = planModeChange(args as any);

    if (plan.kind === 'update') {
      if (plan.newVoice !== undefined) {
        db.prepare("UPDATE companions SET observer_mode = ? WHERE id = ?").run(plan.newVoice, row.id);
        row.observer_mode = plan.newVoice;
      }
      if (plan.newMax !== undefined) {
        db.prepare("UPDATE companions SET max_mode = ? WHERE id = ?").run(plan.newMax, row.id);
        row.max_mode = plan.newMax;
      }
      const companion = loadCompanion(row)!;
      writeBuddyStatus(companion);
    }

    const text = formatModeResponse(plan, {
      observer_mode: row.observer_mode ?? null,
      max_mode: ((row.max_mode ?? 0) === 1 ? 1 : 0),
    });
    return { content: [{ type: "text", text }] };
  }

  if (name === "buddy_forget") {
    const { scope, cwd, session_id } = args as { scope?: PurgeScope; cwd?: string; session_id?: string };
    const effectiveScope: PurgeScope = scope === 'all' ? 'all' : 'session';

    // Validate session_id shape when supplied — a garbage id would silently
    // delete nothing, which is confusing. Surface the error instead.
    if (typeof session_id === 'string' && session_id && !isValidSessionId(session_id)) {
      return {
        content: [{
          type: "text",
          text: `Invalid session_id "${session_id}". Expected format: <16-hex>-<YYYYMMDD>. Run buddy_reasoning_status to list valid ids.`,
        }],
      };
    }

    const sessionId = effectiveScope === 'session'
      ? (typeof session_id === 'string' && session_id
          ? session_id
          : deriveSessionId(resolveProjectRoot(typeof cwd === 'string' ? cwd : undefined).path))
      : undefined;
    const res = purge(db, effectiveScope, sessionId);
    const scopeLabel = effectiveScope === 'all'
      ? 'all workspaces'
      : (typeof session_id === 'string' && session_id ? `session ${session_id}` : 'current workspace/day');
    return {
      content: [{
        type: "text",
        text: `Forgot ${res.claims} claim(s), ${res.edges} edge(s), ${res.findings} finding(s) from ${scopeLabel}.`
      }]
    };
  }

  if (name === "buddy_reasoning_status") {
    const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    const totalClaims = (db.prepare("SELECT count(*) as n FROM reasoning_claims").get() as any)?.n ?? 0;
    const totalEdges = (db.prepare("SELECT count(*) as n FROM reasoning_edges").get() as any)?.n ?? 0;
    const totalFindings = (db.prepare("SELECT count(*) as n FROM reasoning_findings_log").get() as any)?.n ?? 0;
    const sessionRows = db.prepare(
      `SELECT session_id, count(*) as n, min(created_at) as oldest, max(created_at) as newest
       FROM reasoning_claims GROUP BY session_id ORDER BY newest DESC LIMIT 10`
    ).all() as Array<{ session_id: string; n: number; oldest: number; newest: number }>;

    const stats = telemetry.snapshot();
    const maxOn = row && (row.max_mode ?? 0) === 1 ? 'on' : 'off';
    const currentRoot = resolveProjectRoot(undefined);

    const lines: string[] = [];
    lines.push(`Reasoning layer (max mode: ${maxOn})`);
    lines.push(`  workspace (this process): ${currentRoot.path} [${currentRoot.source}${currentRoot.envVar ? ':' + currentRoot.envVar : currentRoot.markerFound ? ':' + currentRoot.markerFound : ''}]`);
    lines.push(`  stored:   ${totalClaims} claim(s), ${totalEdges} edge(s), ${totalFindings} finding(s)`);
    if (sessionRows.length > 0) {
      lines.push(`  sessions (most recent):`);
      for (const s of sessionRows) {
        const oldestDate = new Date(s.oldest).toISOString().slice(0, 10);
        lines.push(`    ${s.session_id} — ${s.n} claim(s), since ${oldestDate}`);
      }
    } else {
      lines.push(`  sessions: none`);
    }
    lines.push('');
    lines.push(`Runtime (since process start)`);
    lines.push(`  observes:         ${stats.observes_total} total, ${stats.observes_max_mode} with max mode on`);
    lines.push(`  claims received:  ${stats.claims_received_total} (written ${stats.claims_written}, dropped ${stats.claims_dropped})`);
    lines.push(`  edges received:   ${stats.edges_received_total} (written ${stats.edges_written}, dropped ${stats.edges_dropped})`);
    lines.push(`  findings:         ${stats.findings_surfaced_total} surfaced`);
    if (stats.findings_surfaced_total > 0) {
      for (const [type, count] of Object.entries(stats.findings_by_type)) {
        if (count > 0) lines.push(`    ${type}: ${count}`);
      }
    }
    if (stats.detector_latency_ms_count > 0) {
      const avg = Math.round(stats.detector_latency_ms_sum / stats.detector_latency_ms_count);
      lines.push(`  detector latency: avg ${avg}ms, max ${stats.detector_latency_ms_max}ms, budget exceeded ${stats.budget_exceeded_total} time(s)`);
    }
    if (stats.pipeline_failures_total > 0) {
      lines.push(`  pipeline failures: ${stats.pipeline_failures_total} (set BUDDY_DEBUG=1 for stderr traces)`);
    }
    lines.push('');
    lines.push(`Stored in: ~/.buddy/buddy.db (plaintext SQLite, never leaves your machine).`);
    lines.push(`Purge with buddy_forget (scope: session | all).`);

    return { content: [{ type: "text", text: lines.join('\n') }] };
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

  // Prune reasoning sessions older than retention window. Best-effort.
  try { pruneOldSessions(db); } catch { /* non-fatal */ }

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
