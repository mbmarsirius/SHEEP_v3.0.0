#!/usr/bin/env node
/**
 * SHEEP AI - MCP Server
 *
 * Exposes SHEEP cognitive memory tools via the Model Context Protocol.
 * Connect from Cursor, Claude Desktop, or any MCP-compatible host.
 *
 * Configuration (environment variables):
 *   SHEEP_API_KEY  -- Your SHEEP API key (required)
 *   SHEEP_API_URL  -- API base URL (default: https://sheep-cloud-production.up.railway.app)
 *
 * Usage in Cursor / Claude Desktop:
 *   {
 *     "mcpServers": {
 *       "sheep": {
 *         "command": "npx",
 *         "args": ["-y", "@sheep-ai/mcp-server"],
 *         "env": { "SHEEP_API_KEY": "sk-sheep-..." }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SheepClient } from "./client.js";

// =============================================================================
// CONFIG
// =============================================================================

const apiKey = process.env.SHEEP_API_KEY;
if (!apiKey) {
  console.error("[sheep-mcp] SHEEP_API_KEY environment variable is required.");
  console.error("[sheep-mcp] Get your key at https://sheep.ai");
  process.exit(1);
}

const client = new SheepClient({
  apiKey,
  apiUrl: process.env.SHEEP_API_URL,
});

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new McpServer({
  name: "sheep-ai",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Tool: sheep_remember
// ---------------------------------------------------------------------------
server.tool(
  "sheep_remember",
  "Store a fact in SHEEP cognitive memory. Use for anything worth remembering about the user, their projects, preferences, or decisions.",
  {
    subject: z.string().describe("The entity (e.g. 'user', 'project', a person's name)"),
    predicate: z.string().describe("The relationship (e.g. 'prefers', 'works_at', 'name_is')"),
    object: z.string().describe("The value (e.g. 'TypeScript', 'Acme Corp', 'Alice')"),
    confidence: z.number().min(0).max(1).optional().describe("Confidence 0-1 (default 0.9)"),
  },
  async ({ subject, predicate, object, confidence }) => {
    try {
      const result = await client.remember(subject, predicate, object, confidence);
      return {
        content: [
          {
            type: "text" as const,
            text: `Remembered: ${result.fact.subject} ${result.fact.predicate} ${result.fact.object} (confidence: ${result.fact.confidence})`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: sheep_recall
// ---------------------------------------------------------------------------
server.tool(
  "sheep_recall",
  "Search SHEEP cognitive memory for relevant facts and episodes. Use when you need to remember something about the user, their preferences, past conversations, or context.",
  {
    query: z.string().describe("What to search for in memory"),
    type: z.enum(["facts", "episodes", "all"]).optional().describe("Memory type to search (default: all)"),
    limit: z.number().optional().describe("Maximum results (default: 10)"),
  },
  async ({ query, type, limit }) => {
    try {
      const result = await client.recall(query, type, limit);
      const facts = result.facts ?? [];
      if (facts.length === 0) {
        return { content: [{ type: "text" as const, text: "No memories found for that query." }] };
      }
      const lines = facts.map(
        (f, i) => `${i + 1}. ${f.subject} ${f.predicate} ${f.object} (${(f.confidence * 100).toFixed(0)}%)`,
      );
      return {
        content: [{ type: "text" as const, text: `Found ${facts.length} memory/memories:\n${lines.join("\n")}` }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: sheep_why
// ---------------------------------------------------------------------------
server.tool(
  "sheep_why",
  "Query causal reasoning - why did something happen? Finds cause-effect chains in memory.",
  {
    effect: z.string().describe("The effect/outcome to explain"),
    maxDepth: z.number().optional().describe("Maximum causal chain depth (default: 5)"),
  },
  async ({ effect, maxDepth }) => {
    try {
      const result = await client.why(effect, maxDepth);
      if (result.chain.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: result.message ?? "No causal knowledge found for that query.",
            },
          ],
        };
      }
      const lines = result.chain.map(
        (l, i) => `${i + 1}. ${l.cause} -> ${l.effect} (${l.mechanism}, ${(l.confidence * 100).toFixed(0)}%)`,
      );
      return {
        content: [{ type: "text" as const, text: `Causal chain:\n${lines.join("\n")}` }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: sheep_forget
// ---------------------------------------------------------------------------
server.tool(
  "sheep_forget",
  "Forget specific facts from memory. Use when the user asks to forget something or correct outdated information.",
  {
    topic: z.string().optional().describe("Topic/keyword to forget all related facts"),
    factId: z.string().optional().describe("Specific fact ID to forget"),
  },
  async ({ topic, factId }) => {
    try {
      const result = await client.forget({ topic, factId });
      return {
        content: [
          {
            type: "text" as const,
            text: `Forgotten ${result.forgotten} fact(s)${topic ? ` related to "${topic}"` : ""}.`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: sheep_stats
// ---------------------------------------------------------------------------
server.tool(
  "sheep_stats",
  "Get SHEEP memory statistics - total facts, episodes, causal links, etc.",
  {},
  async () => {
    try {
      const result = await client.status();
      const m = result.memory;
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `SHEEP Memory Stats (${result.tier} tier):`,
              `  Facts: ${m.facts}`,
              `  Episodes: ${m.episodes}`,
              `  Causal Links: ${m.causalLinks}`,
              `  Procedures: ${m.procedures}`,
              m.avgConfidence ? `  Avg Confidence: ${(m.avgConfidence * 100).toFixed(1)}%` : null,
              m.lastConsolidation ? `  Last Consolidation: ${m.lastConsolidation}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err}` }], isError: true };
    }
  },
);

// =============================================================================
// START
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[sheep-mcp] SHEEP AI MCP server running on stdio");
  console.error("[sheep-mcp] 5 tools available: sheep_remember, sheep_recall, sheep_why, sheep_forget, sheep_stats");
}

main().catch((err) => {
  console.error("[sheep-mcp] Fatal error:", err);
  process.exit(1);
});
