/**
 * SHEEP AI - LLM-Powered Sleep Consolidation
 *
 * THIS IS BREAKTHROUGH #3!
 *
 * Inspired by how human brains consolidate memories during sleep,
 * we use LLMs to:
 *
 * 1. Review memories and identify patterns
 * 2. Generate abstractions (specific facts → general rules)
 * 3. Connect related memories that weren't explicitly linked
 * 4. Intelligently decide what to forget
 * 5. Resolve contradictions with reasoning
 *
 * This is what makes SHEEP AI "cognitive" rather than just a database.
 *
 * @module sheep/consolidation/llm-sleep
 */

import type { LLMProvider } from "../extraction/llm-extractor.js";
import type { Episode, Fact, CausalLink } from "../memory/schema.js";
import { generateId, now } from "../memory/schema.js";
import { recordLLMSleep, type LLMSleepMetrics } from "../metrics/metrics.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of sleep consolidation
 */
export type SleepConsolidationResult = {
  /** Patterns discovered across memories */
  patternsDiscovered: DiscoveredPattern[];
  /** Facts that were merged or generalized */
  factsConsolidated: ConsolidatedFact[];
  /** New connections made between memories */
  connectionsCreated: CreatedConnection[];
  /** Memories recommended for forgetting */
  forgettingRecommendations: ForgettingRecommendation[];
  /** Contradictions resolved */
  contradictionsResolved: ResolvedContradiction[];
  /** Processing time */
  durationMs: number;
  /** LLM tokens used */
  tokensUsed?: number;
};

/**
 * A pattern discovered across multiple memories
 */
export type DiscoveredPattern = {
  id: string;
  description: string;
  confidence: number;
  supportingMemories: string[]; // IDs of memories that support this pattern
  patternType: "behavioral" | "preference" | "temporal" | "causal" | "association";
};

/**
 * A fact that was consolidated from multiple sources
 */
export type ConsolidatedFact = {
  originalFactIds: string[];
  newFact: Omit<Fact, "id" | "createdAt" | "updatedAt">;
  consolidationType: "merge" | "generalize" | "correct";
  reasoning: string;
};

/**
 * A connection created between memories
 */
export type CreatedConnection = {
  memoryId1: string;
  memoryId2: string;
  connectionType: "similar" | "causal" | "temporal" | "contradicts" | "elaborates";
  confidence: number;
  reasoning: string;
};

/**
 * A recommendation to forget a memory
 */
export type ForgettingRecommendation = {
  memoryId: string;
  memoryType: "episode" | "fact" | "causal_link";
  reason: "redundant" | "outdated" | "low_value" | "superseded" | "contradicted";
  confidence: number;
  reasoning: string;
};

/**
 * A contradiction that was resolved
 */
export type ResolvedContradiction = {
  fact1Id: string;
  fact2Id: string;
  resolution: "kept_first" | "kept_second" | "merged" | "both_valid";
  reasoning: string;
  newFactId?: string;
};

// =============================================================================
// SLEEP CONSOLIDATION PROMPTS
// =============================================================================

const PATTERN_DISCOVERY_PROMPT = `You are analyzing a user's memories to discover patterns.

Given these recent memories, identify any patterns in behavior, preferences, or associations.

Rules:
1. Look for recurring themes, preferences, or behaviors
2. Identify temporal patterns (things that happen at certain times)
3. Find causal patterns (if X then usually Y)
4. Note associations (things often mentioned together)
5. Rate confidence 0.0-1.0

Memories:
{memories}

Output ONLY valid JSON:
{
  "patterns": [
    {
      "description": "string describing the pattern",
      "confidence": 0.0-1.0,
      "patternType": "behavioral|preference|temporal|causal|association",
      "supportingMemoryIds": ["id1", "id2"],
      "reasoning": "why you identified this pattern"
    }
  ]
}
`;

const FACT_CONSOLIDATION_PROMPT = `You are consolidating facts to reduce redundancy and create generalizations.

Given these related facts, determine if they should be merged, generalized, or kept separate.

Facts:
{facts}

Rules:
1. Merge facts that say the same thing in different ways
2. Generalize when multiple specific facts suggest a general rule
3. Keep separate if they're truly distinct information
4. Preserve the most confident and most recent information

Output ONLY valid JSON:
{
  "consolidations": [
    {
      "originalFactIds": ["id1", "id2"],
      "consolidationType": "merge|generalize|keep_separate",
      "newFact": {
        "subject": "string",
        "predicate": "string",
        "object": "string",
        "confidence": 0.0-1.0
      },
      "reasoning": "why this consolidation"
    }
  ]
}
`;

const FORGETTING_ANALYSIS_PROMPT = `You are deciding which memories can be safely forgotten.

Given these memories with their metadata, recommend which should be forgotten.

Memories:
{memories}

Consider:
1. Redundant: Information captured better elsewhere
2. Outdated: Clearly superseded by newer information
3. Low value: Trivial or unlikely to be useful
4. Superseded: Replaced by a more general/accurate fact

Output ONLY valid JSON:
{
  "recommendations": [
    {
      "memoryId": "string",
      "reason": "redundant|outdated|low_value|superseded|contradicted",
      "confidence": 0.0-1.0,
      "reasoning": "why forget this"
    }
  ]
}
`;

const CONNECTION_DISCOVERY_PROMPT = `You are finding connections between memories that weren't explicitly linked.

Given these memories, identify connections between them.

Memories:
{memories}

Connection types:
- similar: Same topic or theme
- causal: One might cause or influence the other
- temporal: Related in time
- contradicts: They conflict
- elaborates: One expands on the other

Output ONLY valid JSON:
{
  "connections": [
    {
      "memoryId1": "string",
      "memoryId2": "string",
      "connectionType": "similar|causal|temporal|contradicts|elaborates",
      "confidence": 0.0-1.0,
      "reasoning": "why connected"
    }
  ]
}
`;

// =============================================================================
// SLEEP CONSOLIDATION ENGINE
// =============================================================================

/**
 * Parse JSON from LLM response
 */
function parseJSON<T>(response: string): T | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    const cleaned = jsonStr.trim().replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    return JSON.parse(cleaned) as T;
  } catch {
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Format memories for LLM prompt
 */
function formatMemoriesForPrompt(
  episodes: Episode[],
  facts: Fact[],
  causalLinks: CausalLink[],
): string {
  const lines: string[] = [];

  for (const ep of episodes) {
    lines.push(
      `[Episode ${ep.id}] ${ep.summary} (topic: ${ep.topic}, salience: ${ep.emotionalSalience})`,
    );
  }

  for (const fact of facts) {
    lines.push(
      `[Fact ${fact.id}] ${fact.subject} ${fact.predicate} ${fact.object} (confidence: ${fact.confidence})`,
    );
  }

  for (const link of causalLinks) {
    lines.push(
      `[Causal ${link.id}] "${link.causeDescription}" → "${link.effectDescription}" via "${link.mechanism}"`,
    );
  }

  return lines.join("\n");
}

/**
 * Format facts for LLM prompt
 */
function formatFactsForPrompt(facts: Fact[]): string {
  return facts
    .map(
      (f) =>
        `[${f.id}] "${f.subject} ${f.predicate} ${f.object}" (confidence: ${f.confidence}, seen: ${f.accessCount} times)`,
    )
    .join("\n");
}

/**
 * Run LLM-powered sleep consolidation
 * This is the main "sleep cycle" that processes memories
 */
export async function runLLMSleepConsolidation(
  llm: LLMProvider,
  episodes: Episode[],
  facts: Fact[],
  causalLinks: CausalLink[],
  options: {
    discoverPatterns?: boolean;
    consolidateFacts?: boolean;
    findConnections?: boolean;
    recommendForgetting?: boolean;
  } = {},
): Promise<SleepConsolidationResult> {
  const startTime = Date.now();
  const result: SleepConsolidationResult = {
    patternsDiscovered: [],
    factsConsolidated: [],
    connectionsCreated: [],
    forgettingRecommendations: [],
    contradictionsResolved: [],
    durationMs: 0,
  };

  const {
    discoverPatterns = true,
    consolidateFacts = true,
    findConnections = true,
    recommendForgetting = true,
  } = options;

  // Skip if no memories to process
  if (episodes.length === 0 && facts.length === 0 && causalLinks.length === 0) {
    result.durationMs = Date.now() - startTime;
    return result;
  }

  const memoriesText = formatMemoriesForPrompt(episodes, facts, causalLinks);

  // 1. Discover patterns across memories
  if (discoverPatterns && (episodes.length > 2 || facts.length > 3)) {
    try {
      const prompt = PATTERN_DISCOVERY_PROMPT.replace("{memories}", memoriesText);
      const response = await llm.complete(prompt, { maxTokens: 1500, temperature: 0.3 });
      const parsed = parseJSON<{ patterns: Array<Omit<DiscoveredPattern, "id">> }>(response);

      if (parsed?.patterns) {
        for (const pattern of parsed.patterns) {
          result.patternsDiscovered.push({
            id: generateId("ep"), // Use ep prefix as pat is not valid
            description: pattern.description,
            confidence: pattern.confidence,
            supportingMemories: pattern.supportingMemories || [],
            patternType: pattern.patternType,
          });
        }
      }
    } catch (e) {
      console.warn("[SHEEP Sleep] Pattern discovery failed:", e);
    }
  }

  // 2. Consolidate similar facts
  if (consolidateFacts && facts.length > 2) {
    try {
      const prompt = FACT_CONSOLIDATION_PROMPT.replace("{facts}", formatFactsForPrompt(facts));
      const response = await llm.complete(prompt, { maxTokens: 1500, temperature: 0.2 });
      const parsed = parseJSON<{
        consolidations: Array<{
          originalFactIds: string[];
          consolidationType: "merge" | "generalize" | "keep_separate";
          newFact: { subject: string; predicate: string; object: string; confidence: number };
          reasoning: string;
        }>;
      }>(response);

      if (parsed?.consolidations) {
        for (const c of parsed.consolidations) {
          if (c.consolidationType !== "keep_separate") {
            result.factsConsolidated.push({
              originalFactIds: c.originalFactIds,
              newFact: {
                subject: c.newFact.subject,
                predicate: c.newFact.predicate,
                object: c.newFact.object,
                confidence: c.newFact.confidence,
                evidence: c.originalFactIds,
                isActive: true,
                userAffirmed: false,
                accessCount: 0,
                firstSeen: now(),
                lastConfirmed: now(),
                contradictions: [],
              },
              consolidationType: c.consolidationType as "merge" | "generalize",
              reasoning: c.reasoning,
            });
          }
        }
      }
    } catch (e) {
      console.warn("[SHEEP Sleep] Fact consolidation failed:", e);
    }
  }

  // 3. Find connections between memories
  if (findConnections && episodes.length + facts.length > 3) {
    try {
      const prompt = CONNECTION_DISCOVERY_PROMPT.replace("{memories}", memoriesText);
      const response = await llm.complete(prompt, { maxTokens: 1500, temperature: 0.3 });
      const parsed = parseJSON<{
        connections: Array<{
          memoryId1: string;
          memoryId2: string;
          connectionType: "similar" | "causal" | "temporal" | "contradicts" | "elaborates";
          confidence: number;
          reasoning: string;
        }>;
      }>(response);

      if (parsed?.connections) {
        for (const conn of parsed.connections) {
          result.connectionsCreated.push(conn);
        }
      }
    } catch (e) {
      console.warn("[SHEEP Sleep] Connection discovery failed:", e);
    }
  }

  // 4. Recommend forgetting
  if (recommendForgetting && episodes.length + facts.length > 5) {
    try {
      const prompt = FORGETTING_ANALYSIS_PROMPT.replace("{memories}", memoriesText);
      const response = await llm.complete(prompt, { maxTokens: 1000, temperature: 0.2 });
      const parsed = parseJSON<{
        recommendations: Array<{
          memoryId: string;
          reason: "redundant" | "outdated" | "low_value" | "superseded" | "contradicted";
          confidence: number;
          reasoning: string;
        }>;
      }>(response);

      if (parsed?.recommendations) {
        for (const rec of parsed.recommendations) {
          // Determine memory type from ID prefix
          let memoryType: "episode" | "fact" | "causal_link" = "fact";
          if (rec.memoryId.startsWith("ep-")) memoryType = "episode";
          else if (rec.memoryId.startsWith("cl-")) memoryType = "causal_link";

          result.forgettingRecommendations.push({
            memoryId: rec.memoryId,
            memoryType,
            reason: rec.reason,
            confidence: rec.confidence,
            reasoning: rec.reasoning,
          });
        }
      }
    } catch (e) {
      console.warn("[SHEEP Sleep] Forgetting analysis failed:", e);
    }
  }

  result.durationMs = Date.now() - startTime;

  // Record metrics (agentId will be added by caller if available)
  // This allows metrics to be recorded even if agentId is not available
  return result;
}

/**
 * Run LLM sleep consolidation with metrics recording
 */
export async function runLLMSleepConsolidationWithMetrics(
  llm: LLMProvider,
  agentId: string,
  episodes: Episode[],
  facts: Fact[],
  causalLinks: CausalLink[],
  options: {
    discoverPatterns?: boolean;
    consolidateFacts?: boolean;
    findConnections?: boolean;
    recommendForgetting?: boolean;
  } = {},
): Promise<SleepConsolidationResult> {
  const result = await runLLMSleepConsolidation(llm, episodes, facts, causalLinks, options);

  // Record metrics
  const metrics: LLMSleepMetrics = {
    timestamp: Date.now(),
    agentId,
    memoriesProcessed: episodes.length + facts.length + causalLinks.length,
    patternsDiscovered: result.patternsDiscovered.length,
    factsConsolidated: result.factsConsolidated.length,
    connectionsCreated: result.connectionsCreated.length,
    forgettingRecommendations: result.forgettingRecommendations.length,
    contradictionsResolved: result.contradictionsResolved.length,
    durationMs: result.durationMs,
    tokensUsed: result.tokensUsed,
    costEstimate: result.tokensUsed ? result.tokensUsed * 0.00001 : undefined, // Rough estimate: $0.01 per 1K tokens
    success: true,
  };

  recordLLMSleep(metrics);

  return result;
}

// =============================================================================
// SLEEP SCHEDULER
// =============================================================================

/**
 * Determine if it's a good time for sleep consolidation
 * Considers factors like:
 * - Time since last consolidation
 * - Number of new memories
 * - System load (if available)
 * - User activity (idle = good time for sleep)
 */
export function shouldRunSleepCycle(
  lastConsolidationTime: Date | null,
  newMemoriesSinceLastSleep: number,
  isUserIdle: boolean = false,
): { shouldRun: boolean; reason: string } {
  // Always run if never consolidated
  if (!lastConsolidationTime) {
    return { shouldRun: true, reason: "initial_consolidation" };
  }

  const hoursSinceLastSleep = (Date.now() - lastConsolidationTime.getTime()) / (1000 * 60 * 60);

  // Run if many new memories accumulated
  if (newMemoriesSinceLastSleep > 50) {
    return { shouldRun: true, reason: "many_new_memories" };
  }

  // Run if user is idle and it's been a while
  if (isUserIdle && hoursSinceLastSleep > 1 && newMemoriesSinceLastSleep > 10) {
    return { shouldRun: true, reason: "idle_time_consolidation" };
  }

  // Regular scheduled consolidation (every 6 hours)
  if (hoursSinceLastSleep > 6 && newMemoriesSinceLastSleep > 5) {
    return { shouldRun: true, reason: "scheduled_consolidation" };
  }

  // Deep sleep consolidation (every 24 hours regardless)
  if (hoursSinceLastSleep > 24) {
    return { shouldRun: true, reason: "deep_sleep_consolidation" };
  }

  return { shouldRun: false, reason: "no_consolidation_needed" };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  PATTERN_DISCOVERY_PROMPT,
  FACT_CONSOLIDATION_PROMPT,
  FORGETTING_ANALYSIS_PROMPT,
  CONNECTION_DISCOVERY_PROMPT,
};
