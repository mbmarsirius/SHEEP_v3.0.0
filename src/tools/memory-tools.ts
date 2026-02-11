/**
 * SHEEP AI - Agent Memory Tools
 *
 * Tools that allow the agent to explicitly interact with SHEEP's cognitive memory:
 * - sheep_remember: Store a fact or episode explicitly
 * - sheep_recall: Retrieve memories by query
 * - sheep_why: Query causal chains ("why did X happen?")
 * - sheep_forget: Request forgetting of specific information
 * - sheep_correct: Correct a stored fact
 *
 * @module sheep/tools/memory-tools
 */

import { type TSchema, Type } from "@sinclair/typebox";
import { buildCausalChain } from "../causal/causal-extractor.js";
import { SheepDatabase } from "../memory/database.js";
import { now } from "../memory/schema.js";

// =============================================================================
// TYPES
// =============================================================================

/** Agent tool definition (standalone, compatible with pi-agent-core interface) */
export type AgentTool<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  inputSchema: TSchema;
  execute: (input: TInput) => Promise<AgentToolResult<TOutput>>;
};

/** Agent tool result */
export type AgentToolResult<T = unknown> = {
  content: T;
  isError?: boolean;
};

// biome-ignore lint/suspicious/noExplicitAny: TypeBox schema type variance
type AnyAgentTool = AgentTool<any, unknown>;

/** Resolve agent ID from environment */
function resolveSessionAgentId(): string {
  return process.env.SHEEP_AGENT_ID ?? process.env.AGENT_ID ?? "default";
}

// =============================================================================
// HELPERS
// =============================================================================

function jsonResult(payload: unknown): AgentToolResult<unknown> {
  return { content: payload };
}

function readStringParam(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const value = (params as Record<string, unknown>)[key];
  if (typeof value === "string") return value.trim() || undefined;
  return undefined;
}

function readNumberParam(params: unknown, key: string): number | undefined {
  if (!params || typeof params !== "object") return undefined;
  const value = (params as Record<string, unknown>)[key];
  if (typeof value === "number") return value;
  return undefined;
}

// =============================================================================
// TOOL SCHEMAS
// =============================================================================

const SheepRememberSchema = Type.Object({
  subject: Type.String({ description: "The entity this fact is about (e.g., 'user', 'project')" }),
  predicate: Type.String({ description: "The relationship (e.g., 'prefers', 'works_at', 'likes')" }),
  object: Type.String({ description: "The value (e.g., 'TypeScript', 'Acme Corp')" }),
  confidence: Type.Optional(
    Type.Number({ description: "Confidence 0-1 (default: 0.9 for explicit statements)" }),
  ),
});

const SheepRecallSchema = Type.Object({
  query: Type.String({ description: "What to search for in memory" }),
  type: Type.Optional(
    Type.String({ description: "Memory type: 'facts', 'episodes', 'all' (default: 'all')" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum results (default: 10)" })),
});

const SheepWhySchema = Type.Object({
  effect: Type.String({ description: "The effect/outcome to explain" }),
  maxDepth: Type.Optional(Type.Number({ description: "Maximum causal chain depth (default: 5)" })),
});

const SheepForgetSchema = Type.Object({
  factId: Type.Optional(Type.String({ description: "Specific fact ID to forget" })),
  subject: Type.Optional(Type.String({ description: "Forget facts about this subject" })),
  predicate: Type.Optional(Type.String({ description: "Forget facts with this predicate" })),
  reason: Type.String({ description: "Why this should be forgotten" }),
});

const SheepCorrectSchema = Type.Object({
  subject: Type.String({ description: "The entity this fact is about" }),
  predicate: Type.String({ description: "The relationship" }),
  oldValue: Type.String({ description: "The incorrect value" }),
  newValue: Type.String({ description: "The correct value" }),
  reason: Type.Optional(Type.String({ description: "Why this correction is needed" })),
});

// =============================================================================
// TOOL IMPLEMENTATIONS
// =============================================================================

export function createSheepRememberTool(): AnyAgentTool {
  return {
    name: "sheep_remember",
    description:
      "Store a fact in cognitive memory. Use when the user explicitly states something important about themselves, their preferences, or their work.",
    inputSchema: SheepRememberSchema,
    execute: async (params) => {
      const subject = readStringParam(params, "subject");
      const predicate = readStringParam(params, "predicate");
      const object = readStringParam(params, "object");
      const confidence = readNumberParam(params, "confidence") ?? 0.9;

      if (!subject || !predicate || !object) {
        return jsonResult({ success: false, error: "Missing required fields" });
      }

      try {
        const agentId = resolveSessionAgentId();
        const db = new SheepDatabase(agentId);
        const timestamp = now();

        const fact = db.insertFact({
          subject,
          predicate: predicate.toLowerCase().replace(/\s+/g, "_"),
          object,
          confidence,
          evidence: ["user_explicit"],
          firstSeen: timestamp,
          lastConfirmed: timestamp,
          userAffirmed: true,
        });

        db.close();

        return jsonResult({
          success: true,
          factId: fact.id,
          stored: `${subject} ${predicate} ${object}`,
          confidence,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ success: false, error: message });
      }
    },
  };
}

export function createSheepRecallTool(): AnyAgentTool {
  return {
    name: "sheep_recall",
    description:
      "Search cognitive memory for relevant facts and episodes. Use when you need to remember something about the user, their preferences, past conversations, or context.",
    inputSchema: SheepRecallSchema,
    execute: async (params) => {
      const query = readStringParam(params, "query");
      const type = readStringParam(params, "type") ?? "all";
      const limit = readNumberParam(params, "limit") ?? 10;

      if (!query) {
        return jsonResult({ facts: [], episodes: [], error: "Query required" });
      }

      try {
        const agentId = resolveSessionAgentId();
        const db = new SheepDatabase(agentId);

        // Simple keyword-based recall from facts
        const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const allFacts = (type === "all" || type === "facts")
          ? db.findFacts({ activeOnly: true })
          : [];

        const matchedFacts = allFacts
          .map((f) => {
            const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
            const score = queryWords.filter((w) => text.includes(w)).length;
            return { fact: f, score };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((r) => ({
            id: r.fact.id,
            fact: `${r.fact.subject} ${r.fact.predicate.replace(/_/g, " ")} ${r.fact.object}`,
            confidence: r.fact.confidence,
          }));

        const episodes: Array<{ id: string; summary: string; topic: string; timestamp: string }> = [];

        db.close();

        return jsonResult({ facts: matchedFacts, episodes });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ facts: [], episodes: [], error: message });
      }
    },
  };
}

export function createSheepWhyTool(): AnyAgentTool {
  return {
    name: "sheep_why",
    description:
      "Query causal reasoning: why did something happen? Finds cause-effect chains in memory.",
    inputSchema: SheepWhySchema,
    execute: async (params) => {
      const effect = readStringParam(params, "effect");
      const maxDepth = readNumberParam(params, "maxDepth") ?? 5;

      if (!effect) {
        return jsonResult({ chain: [], explanation: "Effect description required" });
      }

      try {
        const agentId = resolveSessionAgentId();
        const db = new SheepDatabase(agentId);
        const allLinks = db.findCausalLinks({});
        db.close();

        if (allLinks.length === 0) {
          return jsonResult({
            effect,
            chain: [],
            totalConfidence: 0,
            explanation: "No causal relationships found in memory.",
          });
        }

        const chainResult = buildCausalChain(allLinks, effect, {
          maxDepth,
          minSimilarity: 0.1,
        });

        return jsonResult({
          effect,
          chain: chainResult.chain.map((link) => ({
            cause: link.causeDescription,
            effect: link.effectDescription,
            mechanism: link.mechanism,
            confidence: link.confidence,
          })),
          totalConfidence: chainResult.totalConfidence,
          explanation: chainResult.explanation,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ chain: [], explanation: `Error: ${message}` });
      }
    },
  };
}

export function createSheepForgetTool(): AnyAgentTool {
  return {
    name: "sheep_forget",
    description:
      "Request to forget specific information from memory. Use when the user asks to forget something or when information is incorrect/outdated.",
    inputSchema: SheepForgetSchema,
    execute: async (params) => {
      const factId = readStringParam(params, "factId");
      const subject = readStringParam(params, "subject");
      const predicate = readStringParam(params, "predicate");
      const reason = readStringParam(params, "reason");

      if (!reason) {
        return jsonResult({ success: false, error: "Reason required for forgetting" });
      }

      try {
        const agentId = resolveSessionAgentId();
        const db = new SheepDatabase(agentId);
        let forgotten = 0;

        if (factId) {
          db.retractFact(factId, reason);
          forgotten = 1;
        } else if (subject || predicate) {
          const facts = db.findFacts({ subject, predicate, activeOnly: true });
          for (const fact of facts) {
            db.retractFact(fact.id, reason);
            forgotten++;
          }
        }

        db.close();
        return jsonResult({ success: true, forgotten, reason });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ success: false, error: message });
      }
    },
  };
}

export function createSheepCorrectTool(): AnyAgentTool {
  return {
    name: "sheep_correct",
    description:
      "Correct a fact in memory. Use when the user provides updated information that supersedes a previously stored fact.",
    inputSchema: SheepCorrectSchema,
    execute: async (params) => {
      const subject = readStringParam(params, "subject");
      const predicate = readStringParam(params, "predicate");
      const oldValue = readStringParam(params, "oldValue");
      const newValue = readStringParam(params, "newValue");
      const reason = readStringParam(params, "reason") ?? "User correction";

      if (!subject || !predicate || !oldValue || !newValue) {
        return jsonResult({ success: false, error: "Missing required fields" });
      }

      try {
        const agentId = resolveSessionAgentId();
        const db = new SheepDatabase(agentId);
        const normalizedPredicate = predicate.toLowerCase().replace(/\s+/g, "_");

        const oldFacts = db.findFacts({
          subject,
          predicate: normalizedPredicate,
          object: oldValue,
          activeOnly: true,
        });

        for (const oldFact of oldFacts) {
          db.retractFact(oldFact.id, `Corrected: ${reason}`);
        }

        const timestamp = now();
        const newFact = db.insertFact({
          subject,
          predicate: normalizedPredicate,
          object: newValue,
          confidence: 0.95,
          evidence: oldFacts.map((f) => f.id),
          firstSeen: timestamp,
          lastConfirmed: timestamp,
          userAffirmed: true,
        });

        db.close();

        return jsonResult({
          success: true,
          corrected: `${subject} ${predicate}: ${oldValue} → ${newValue}`,
          oldFactsRetracted: oldFacts.length,
          newFactId: newFact.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ success: false, error: message });
      }
    },
  };
}

// =============================================================================
// TOOL COLLECTION
// =============================================================================

export function createSheepMemoryTools(): AnyAgentTool[] {
  return [
    createSheepRememberTool(),
    createSheepRecallTool(),
    createSheepWhyTool(),
    createSheepForgetTool(),
    createSheepCorrectTool(),
  ];
}
