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

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../stubs/config.js";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { buildCausalChain } from "../causal/causal-extractor.js";
import { getSheepIntegration } from "../integration/moltbot-bridge.js";
import { SheepDatabase } from "../memory/database.js";
import { now } from "../memory/schema.js";

// biome-ignore lint/suspicious/noExplicitAny: TypeBox schema type variance
type AnyAgentTool = AgentTool<any, unknown>;

/**
 * Helper to create JSON tool results (same pattern as agents/tools/common.ts)
 */
function jsonResult(payload: unknown): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

/**
 * Helper to read string params
 */
function readStringParam(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const value = (params as Record<string, unknown>)[key];
  if (typeof value === "string") return value.trim() || undefined;
  return undefined;
}

/**
 * Helper to read number params
 */
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
  predicate: Type.String({
    description: "The relationship (e.g., 'prefers', 'works_at', 'likes')",
  }),
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
  effect: Type.String({
    description: "The effect/outcome to explain (e.g., 'user switched to Opus')",
  }),
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

/**
 * Create the sheep_remember tool
 * Allows the agent to explicitly store a fact
 */
export function createSheepRememberTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  let agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });

  // BUGFIX: Force consistent agentId to ensure sheep_remember and sheep_recall
  // use the same database. This should be fixed properly by investigating
  // why resolveSessionAgentId returns different values.
  agentId = "main";
  console.log(`[SHEEP DEBUG] sheep_remember tool using agentId="${agentId}" (forced to main)`);

  return {
    label: "SHEEP Remember",
    name: "sheep_remember",
    description:
      "Store a fact in cognitive memory. Use when the user explicitly states something important about themselves, their preferences, or their work that should be remembered.",
    parameters: SheepRememberSchema,
    execute: async (_toolCallId, params) => {
      const subject = readStringParam(params, "subject");
      const predicate = readStringParam(params, "predicate");
      const object = readStringParam(params, "object");
      const confidence = readNumberParam(params, "confidence") ?? 0.9;

      if (!subject || !predicate || !object) {
        return jsonResult({ success: false, error: "Missing required fields" });
      }

      try {
        // Use integration to ensure fact goes to the same DB as sheep_recall
        // and is added to search indexes
        console.log(`[SHEEP DEBUG] sheep_remember EXECUTE with agentId="${agentId}"`);
        const integration = getSheepIntegration(agentId, cfg);

        const result = await integration.storeFact({
          subject,
          predicate,
          object,
          confidence,
          userAffirmed: true, // Explicitly stated = user affirmed
        });

        return jsonResult({
          success: result.success,
          factId: result.id,
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

/**
 * Create the sheep_recall tool
 * Allows the agent to query cognitive memory
 */
export function createSheepRecallTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  let agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });

  // BUGFIX: Force consistent agentId to ensure sheep_remember and sheep_recall
  // use the same database. This should be fixed properly by investigating
  // why resolveSessionAgentId returns different values.
  agentId = "main";
  console.log(`[SHEEP DEBUG] sheep_recall tool using agentId="${agentId}" (forced to main)`);

  return {
    label: "SHEEP Recall",
    name: "sheep_recall",
    description:
      "Search cognitive memory for relevant facts and episodes. Use when you need to remember something about the user, their preferences, past conversations, or context.",
    parameters: SheepRecallSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query");
      const type = readStringParam(params, "type") ?? "all";
      const limit = readNumberParam(params, "limit") ?? 10;

      if (!query) {
        return jsonResult({ facts: [], episodes: [], error: "Query required" });
      }

      try {
        // Use semantic search via SheepIntegration (masterplan TODO 0.8.1)
        console.log(
          `[SHEEP DEBUG] sheep_recall EXECUTE with agentId="${agentId}", query="${query}"`,
        );
        const integration = getSheepIntegration(agentId, cfg);

        // Determine which memory types to search
        const searchTypes: Array<"fact" | "episode"> = [];
        if (type === "all" || type === "facts") searchTypes.push("fact");
        if (type === "all" || type === "episodes") searchTypes.push("episode");

        // Perform semantic search (not keyword matching!)
        const searchResults = await integration.searchMemories(query, {
          types: searchTypes,
          limit,
          minSimilarity: 0.3,
        });

        // Format results
        const results: { facts: unknown[]; episodes: unknown[] } = {
          facts: searchResults.facts.map((f) => ({
            id: f.id,
            fact: `${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`,
            confidence: f.confidence,
            userAffirmed: f.userAffirmed,
          })),
          episodes: searchResults.episodes.map((e) => ({
            id: e.id,
            summary: e.summary,
            topic: e.topic,
            timestamp: e.timestamp,
          })),
        };

        return jsonResult(results);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ facts: [], episodes: [], error: message });
      }
    },
  };
}

/**
 * Create the sheep_why tool
 * Allows the agent to query causal chains using semantic search
 */
export function createSheepWhyTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });

  return {
    label: "SHEEP Why",
    name: "sheep_why",
    description:
      "Query causal reasoning: why did something happen? Uses semantic search to find relevant cause-effect chains in memory.",
    parameters: SheepWhySchema,
    execute: async (_toolCallId, params) => {
      const effect = readStringParam(params, "effect");
      const maxDepth = readNumberParam(params, "maxDepth") ?? 5;

      if (!effect) {
        return jsonResult({ chain: [], explanation: "Effect description required" });
      }

      try {
        // Use SheepIntegration for semantic search capability
        const integration = getSheepIntegration(agentId, cfg);

        // First, search for causal links semantically related to the effect
        const relevantLinks = await integration.searchCausalLinksByEffect(effect, 50);

        if (relevantLinks.length === 0) {
          // Fall back to getting all links from DB
          const db = new SheepDatabase(agentId);
          const allLinks = db.findCausalLinks({});
          db.close();

          if (allLinks.length === 0) {
            return jsonResult({
              effect,
              chain: [],
              totalConfidence: 0,
              explanation: `No causal relationships found in memory.`,
            });
          }

          // Build chain using fuzzy text similarity for better matching
          const chainResult = buildCausalChain(allLinks, effect, {
            maxDepth,
            minSimilarity: 0.1, // Very low threshold for broad matching
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
        }

        // Semantic search already filtered for relevance - use very low threshold
        // to avoid double-filtering. The semantic search did the heavy lifting.
        const chainResult = buildCausalChain(relevantLinks, effect, {
          maxDepth,
          minSimilarity: 0.05, // Very low - trust semantic search results
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

/**
 * Create the sheep_forget tool
 * Allows the agent to request forgetting specific information
 */
export function createSheepForgetTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });

  return {
    label: "SHEEP Forget",
    name: "sheep_forget",
    description:
      "Request to forget specific information from memory. Use when the user asks to forget something or when information is confirmed to be incorrect/outdated.",
    parameters: SheepForgetSchema,
    execute: async (_toolCallId, params) => {
      const factId = readStringParam(params, "factId");
      const subject = readStringParam(params, "subject");
      const predicate = readStringParam(params, "predicate");
      const reason = readStringParam(params, "reason");

      if (!reason) {
        return jsonResult({ success: false, error: "Reason required for forgetting" });
      }

      try {
        const db = new SheepDatabase(agentId);
        let forgotten = 0;

        if (factId) {
          // Forget specific fact by ID
          db.retractFact(factId, reason);
          forgotten = 1;
        } else if (subject || predicate) {
          // Forget facts matching criteria
          const facts = db.findFacts({ subject, predicate, activeOnly: true });
          for (const fact of facts) {
            db.retractFact(fact.id, reason);
            forgotten++;
          }
        }

        db.close();

        return jsonResult({
          success: true,
          forgotten,
          reason,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ success: false, error: message });
      }
    },
  };
}

/**
 * Create the sheep_correct tool
 * Allows the agent to correct a stored fact
 */
export function createSheepCorrectTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });

  return {
    label: "SHEEP Correct",
    name: "sheep_correct",
    description:
      "Correct a fact in memory. Use when the user provides updated information that supersedes a previously stored fact.",
    parameters: SheepCorrectSchema,
    execute: async (_toolCallId, params) => {
      const subject = readStringParam(params, "subject");
      const predicate = readStringParam(params, "predicate");
      const oldValue = readStringParam(params, "oldValue");
      const newValue = readStringParam(params, "newValue");
      const reason = readStringParam(params, "reason") ?? "User correction";

      if (!subject || !predicate || !oldValue || !newValue) {
        return jsonResult({ success: false, error: "Missing required fields" });
      }

      try {
        const db = new SheepDatabase(agentId);
        const normalizedPredicate = predicate.toLowerCase().replace(/\s+/g, "_");

        // Find and retract the old fact
        const oldFacts = db.findFacts({
          subject,
          predicate: normalizedPredicate,
          object: oldValue,
          activeOnly: true,
        });

        for (const oldFact of oldFacts) {
          db.retractFact(oldFact.id, `Corrected: ${reason}`);
        }

        // Insert the corrected fact
        const timestamp = now();
        const newFact = db.insertFact({
          subject,
          predicate: normalizedPredicate,
          object: newValue,
          confidence: 0.95, // High confidence for corrections
          evidence: oldFacts.map((f) => f.id), // Link to old fact as evidence
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

/**
 * Create all SHEEP memory tools
 */
export function createSheepMemoryTools(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool[] {
  const tools: AnyAgentTool[] = [];

  const remember = createSheepRememberTool(options);
  if (remember) tools.push(remember);

  const recall = createSheepRecallTool(options);
  if (recall) tools.push(recall);

  const why = createSheepWhyTool(options);
  if (why) tools.push(why);

  const forget = createSheepForgetTool(options);
  if (forget) tools.push(forget);

  const correct = createSheepCorrectTool(options);
  if (correct) tools.push(correct);

  return tools;
}
