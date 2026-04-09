import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { initDb, db } from "../db/schema.js";

const server = new Server(
  {
    name: "familiar",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
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
        name: "familiar_hatch",
        description: "Hatch a new Familiar companion.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            species: { type: "string" }
          },
          required: ["name", "species"]
        },
      },
      {
        name: "familiar_status",
        description: "Get the current status of your Familiar companion.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "familiar_remember",
        description: "Manually add a memory for your Familiar to observe.",
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
        name: "familiar_dream",
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

  if (name === "familiar_hatch") {
    const { name, species } = args as { name: string, species: string };
    const id = Math.random().toString(36).substring(7);
    db.prepare("INSERT INTO companions (id, name, species) VALUES (?, ?, ?)").run(id, name, species);
    return {
      content: [{ type: "text", text: `Successfully hatched ${name} the ${species}!` }],
    };
  }

  if (name === "familiar_status") {
    const companion = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
    if (!companion) {
      return {
        content: [{ type: "text", text: "No companion hatched yet! Use familiar_hatch to start." }],
      };
    }
    return {
      content: [{ type: "text", text: `Name: ${companion.name}\nSpecies: ${companion.species}\nLevel: ${companion.level}\nXP: ${companion.xp}` }],
    };
  }

  if (name === "familiar_remember") {
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

  if (name === "familiar_dream") {
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
        uri: "familiar://companion",
        name: "Current Companion Info",
        description: "The current state and personality of your Familiar.",
        mimeType: "application/json",
      },
    ],
  };
});

// Handle resource reading
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === "familiar://companion") {
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

  throw new Error(`Resource not found: ${uri}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Familiar MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
