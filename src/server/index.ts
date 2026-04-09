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
    
    // Update mood dynamically based on recent XP events
    const recentXp = db.prepare("SELECT * FROM xp_events WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')").all(companion.id);
    const recentMemories = db.prepare("SELECT count(*) as count FROM memories WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')").get(companion.id) as any;
    
    const newMood = calculateMood(recentXp, recentMemories.count);
    db.prepare("UPDATE companions SET mood = ? WHERE id = ?").run(newMood, companion.id);
    companion.mood = newMood;

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
    // Placeholder for actual consolidation logic
    return {
      content: [{ type: "text", text: `Consolidation (${depth} dream) started. Checking patterns...` }],
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
  console.error("Buddy MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
