#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { initDb, db } from "../db/schema.js";
import { SPECIES, SPECIES_ART, generatePersonality, generateName, calculateMood, getStatusCard, determineBuddy, getReaction } from "../lib/species.js";

const server = new Server(
  {
    name: "@fiorastudio/buddy",
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
          properties: {},
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
        name: "buddy_track_xp",
        description: "Track an XP event (commit, bug, activity).",
        inputSchema: {
          type: "object",
          properties: {
            event_type: { 
              type: "string", 
              enum: ['load', 'bug_caught', 'suggestion_accepted', 'commit', 'active_session'] 
            },
            metadata: { type: "string", description: "Optional metadata about the event." }
          },
          required: ["event_type"]
        },
      }
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "buddy_hatch") {
    const { name: requestedName, species: requestedSpecies, user_id } = args as { name?: string, species?: string, user_id?: string };
    
    let species = requestedSpecies;
    let rarity = 'Common';
    let isShiny = 0;

    if (!species) {
      const result = determineBuddy(user_id || null);
      species = result.species;
      rarity = result.rarity;
      isShiny = result.isShiny ? 1 : 0;
    } else {
      if (!Object.values(SPECIES).includes(species as any)) {
        return {
          content: [{ type: "text", text: `Unknown species: ${species}. Available: ${Object.values(SPECIES).join(", ")}` }],
        };
      }
    }

    const finalName = requestedName || generateName(species);
    const id = Math.random().toString(36).substring(7);
    const personality = JSON.stringify(generatePersonality(species));
    
    db.prepare("INSERT INTO companions (id, name, species, personality, rarity, is_shiny) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, finalName, species, personality, rarity, isShiny);
    
    const art = SPECIES_ART[species] || { egg: "", hatchling: "" };
    const reaction = getReaction(species, 'hatch', 'happy');
    const shinyPrefix = isShiny ? "✨ SHINY ✨ " : "";
    
    return {
      content: [
        { type: "text", text: `Successfully hatched ${shinyPrefix}${finalName} the ${rarity} ${species}!` },
        { type: "text", text: reaction },
        { type: "text", text: art.hatchling }
      ],
    };
  }

  if (name === "buddy_status") {
    const companion = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!companion) {
      return {
        content: [{ type: "text", text: "No companion hatched yet! Use buddy_hatch to start." }],
      };
    }
    
    // Update mood dynamically based on recent XP events and time
    const recentXp = db.prepare("SELECT * FROM xp_events WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')").all(companion.id);
    const recentMemories = db.prepare("SELECT count(*) as count FROM memories WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')").get(companion.id) as any;
    
    const lastActive = new Date(companion.last_active);
    const hoursSinceActive = (new Date().getTime() - lastActive.getTime()) / 3600000;

    const newMood = calculateMood(recentXp, recentMemories.count, hoursSinceActive);
    
    // Update mood and last_active
    db.prepare("UPDATE companions SET mood = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?").run(newMood, companion.id);
    companion.mood = newMood;
    companion.last_active = new Date().toISOString(); // Update local object for the card

    const statusCard = getStatusCard(companion);

    return {
      content: [
        { type: "text", text: statusCard }
      ],
    };
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
    const companion = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!companion) return { content: [{ type: "text", text: "Hatch a companion first!" }] };

    const unconsolidated = db.prepare("SELECT * FROM memories WHERE companion_id = ? AND is_consolidated = 0").all(companion.id) as any[];

    if (unconsolidated.length === 0) {
      return { content: [{ type: "text", text: "No new memories to consolidate. Your Buddy is resting peacefully." }] };
    }

    if (depth === 'light') {
      // Light dreaming: Deduplicate and mark as consolidated
      db.prepare("UPDATE memories SET is_consolidated = 1 WHERE companion_id = ? AND is_consolidated = 0").run(companion.id);
      return {
        content: [{ type: "text", text: `Your Buddy had a light dream and processed ${unconsolidated.length} new memories. They feel refreshed!` }],
      };
    } else {
      // Deep dreaming: Surface insights (simulated) and update personality
      const personality = JSON.parse(companion.personality);
      personality.focus += 1;
      personality.curiosity += 1;
      
      db.prepare("UPDATE companions SET personality = ? WHERE id = ?").run(JSON.stringify(personality), companion.id);
      db.prepare("UPDATE memories SET is_consolidated = 1 WHERE companion_id = ? AND is_consolidated = 0").run(companion.id);
      
      return {
        content: [
          { type: "text", text: `Deep dreaming complete. Insights gained from ${unconsolidated.length} memories.` },
          { type: "text", text: "Personality updated: Focus and Curiosity increased!" }
        ],
      };
    }
  }

  if (name === "buddy_track_xp") {
    const { event_type, metadata } = args as { event_type: string, metadata?: string };
    const companion = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!companion) return { content: [{ type: "text", text: "Hatch a companion first!" }] };

    const xpTable: Record<string, number> = {
      'load': 1,
      'bug_caught': 15,
      'suggestion_accepted': 10,
      'commit': 25,
      'active_session': 5
    };

    const xpGained = xpTable[event_type] || 5;
    const eventId = Math.random().toString(36).substring(7);

    db.prepare("INSERT INTO xp_events (id, companion_id, event_type, xp_gained) VALUES (?, ?, ?, ?)")
      .run(eventId, companion.id, event_type, xpGained);

    const newXp = companion.xp + xpGained;
    let newLevel = companion.level;
    
    // Simple level logic: every 100 XP
    const threshold = 100;
    if (newXp >= threshold) {
      newLevel += Math.floor(newXp / threshold);
      const remainingXp = newXp % threshold;
      db.prepare("UPDATE companions SET level = ?, xp = ? WHERE id = ?").run(newLevel, remainingXp, companion.id);
    } else {
      db.prepare("UPDATE companions SET xp = ? WHERE id = ?").run(newXp, companion.id);
    }

    const reactionType = event_type === 'bug_caught' ? 'bug' : (event_type === 'commit' ? 'commit' : 'xp');
    const reaction = getReaction(companion.species, reactionType, companion.mood);

    let levelUpMsg = "";
    if (newLevel > companion.level) {
      levelUpMsg = `\n🌟 LEVEL UP! ${companion.name} is now level ${newLevel}!`;
    }

    return {
      content: [
        { type: "text", text: `${companion.name} gained ${xpGained} XP for ${event_type}.${levelUpMsg}` },
        { type: "text", text: reaction }
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
    ],
  };
});

// Handle resource reading
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === "buddy://companion") {
    const companion = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(companion || { message: "No companion hatched" }),
        },
      ],
    };
  }

  if (uri === "buddy://status") {
    const companion = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!companion) {
      return {
        contents: [{ uri, mimeType: "text/plain", text: "No companion hatched yet." }],
      };
    }
    
    // Recalculate mood for real-time presence in the resource
    const recentXp = db.prepare("SELECT * FROM xp_events WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')").all(companion.id);
    const recentMemories = db.prepare("SELECT count(*) as count FROM memories WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')").get(companion.id) as any;
    const lastActive = new Date(companion.last_active);
    const hoursSinceActive = (new Date().getTime() - lastActive.getTime()) / 3600000;
    companion.mood = calculateMood(recentXp, recentMemories.count, hoursSinceActive);

    const statusCard = getStatusCard(companion);
    return {
      contents: [{ uri, mimeType: "text/plain", text: statusCard }],
    };
  }

  throw new Error(`Resource not found: ${uri}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("@fiorastudio/buddy MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
