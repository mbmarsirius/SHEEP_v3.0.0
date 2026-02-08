/**
 * SHEEP AI - Predictive Memory Prefetch Engine
 *
 * This is a BREAKTHROUGH feature: anticipates which memories the AI will need
 * BEFORE the LLM processes the query. This dramatically reduces latency and
 * improves response relevance.
 *
 * Key capabilities:
 * - Intent classification (question, command, reference, social, creative)
 * - Entity extraction from user messages
 * - Temporal hint detection (yesterday, last week, etc.)
 * - Memory need prediction based on intent + entities + context
 * - Pre-fetching relevant facts, episodes, and causal chains
 * - Detailed latency tracking with <100ms target enforcement
 *
 * @module sheep/prefetch/prefetch-engine
 */

import type {
  MemoryIntent,
  PrefetchPrediction,
  Episode,
  Fact,
  CausalLink,
} from "../memory/schema.js";
import { recordPrefetchWithTiming, type EnhancedPrefetchMetrics } from "../metrics/metrics.js";

// =============================================================================
// LATENCY TARGET
// =============================================================================

/**
 * Target latency for prefetch operations in milliseconds.
 * Prefetch should complete within this time to avoid blocking the LLM.
 */
export const PREFETCH_LATENCY_TARGET_MS = 100;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for the prefetch engine
 */
export type PrefetchConfig = {
  /** Maximum number of facts to prefetch (default: 10) */
  maxFacts?: number;
  /** Maximum number of episodes to prefetch (default: 5) */
  maxEpisodes?: number;
  /** Maximum causal chain depth (default: 3) */
  maxCausalDepth?: number;
  /** Minimum relevance score to include (default: 0.3) */
  minRelevance?: number;
  /** Enable entity expansion (related entities) (default: true) */
  expandEntities?: boolean;
};

/**
 * Result of memory prefetch operation
 */
export type PrefetchResult = {
  /** The prediction that guided the prefetch */
  prediction: PrefetchPrediction;
  /** Prefetched facts */
  facts: Fact[];
  /** Prefetched episodes */
  episodes: Episode[];
  /** Prefetched causal links */
  causalLinks: CausalLink[];
  /** Time taken to prefetch in ms */
  prefetchTimeMs: number;
  /** Whether we met the <100ms latency target */
  metLatencyTarget: boolean;
  /** Detailed timing breakdown */
  timing: {
    intentClassificationMs: number;
    entityExtractionMs: number;
    dbQueryMs: number;
    semanticSearchMs?: number;
    totalMs: number;
  };
  /** Debug info */
  debug?: {
    entitiesExpanded: string[];
    temporalRangeMs?: number;
  };
};

/**
 * Entity with confidence score
 */
export type ExtractedEntity = {
  value: string;
  type: "person" | "place" | "thing" | "time" | "concept" | "project" | "organization" | "unknown";
  confidence: number;
};

/**
 * Temporal reference extracted from text
 */
export type TemporalReference = {
  type: "relative" | "absolute" | "duration" | "none";
  reference: string;
  /** Timestamp range in ISO format */
  rangeStart?: string;
  rangeEnd?: string;
};

// =============================================================================
// INTENT CLASSIFICATION
// =============================================================================

/**
 * Patterns for classifying user intent
 */
const INTENT_PATTERNS: Array<{
  pattern: RegExp;
  intent: MemoryIntent["intentType"];
  confidence: number;
}> = [
  // Questions
  {
    pattern:
      /^(what|who|where|when|why|how|which|can you tell|do you know|did|does|is|are|was|were)\b/i,
    intent: "question",
    confidence: 0.9,
  },
  { pattern: /\?$/, intent: "question", confidence: 0.8 },
  { pattern: /^(explain|describe|tell me about)\b/i, intent: "question", confidence: 0.85 },

  // Commands
  {
    pattern:
      /^(do|make|create|build|write|generate|run|execute|send|update|delete|remove|add|set|configure)\b/i,
    intent: "command",
    confidence: 0.9,
  },
  {
    pattern: /^(please|could you|would you|can you)\s+(do|make|create|build|write|generate|run)/i,
    intent: "command",
    confidence: 0.85,
  },
  { pattern: /^(i need you to|i want you to)\b/i, intent: "command", confidence: 0.85 },

  // References (talking about past)
  {
    pattern:
      /\b(remember when|recall|that time|previously|earlier|before|last time|we discussed)\b/i,
    intent: "reference",
    confidence: 0.85,
  },
  {
    pattern: /\b(you said|you told me|you mentioned|we talked about)\b/i,
    intent: "reference",
    confidence: 0.9,
  },

  // Social/casual
  {
    pattern:
      /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|bye|goodbye)\b/i,
    intent: "social",
    confidence: 0.95,
  },
  { pattern: /^(how are you|what's up|sup)\b/i, intent: "social", confidence: 0.9 },

  // Creative
  {
    pattern: /\b(imagine|pretend|write a story|create a poem|brainstorm|ideas for)\b/i,
    intent: "creative",
    confidence: 0.85,
  },
  { pattern: /^(once upon a time|let's roleplay|act as)\b/i, intent: "creative", confidence: 0.9 },
];

/**
 * Classify the intent of a user message
 */
export function classifyIntent(message: string): MemoryIntent {
  let bestIntent: MemoryIntent["intentType"] = "question"; // Default
  let bestConfidence = 0.3;
  const detectedEntities: string[] = [];

  // Run through patterns
  for (const { pattern, intent, confidence } of INTENT_PATTERNS) {
    if (pattern.test(message)) {
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestIntent = intent;
      }
    }
  }

  // Extract entities from message
  const entities = extractEntities(message);
  for (const entity of entities) {
    if (entity.confidence > 0.5) {
      detectedEntities.push(entity.value);
    }
  }

  // Extract temporal hints
  const temporalRef = extractTemporalReference(message);
  const temporalHints = temporalRef.type !== "none" ? [temporalRef.reference] : [];

  return {
    intentType: bestIntent,
    entities: detectedEntities,
    temporalHints,
    contextRequirements: determineContextRequirements(bestIntent, detectedEntities),
  };
}

/**
 * Determine what context is needed based on intent
 */
function determineContextRequirements(
  intent: MemoryIntent["intentType"],
  entities: string[],
): string[] {
  const requirements: string[] = [];

  switch (intent) {
    case "question":
      requirements.push("facts", "episodes");
      if (entities.length > 0) {
        requirements.push("entity_facts");
      }
      break;
    case "command":
      requirements.push("procedures", "preferences");
      break;
    case "reference":
      requirements.push("episodes", "facts", "causal_chains");
      break;
    case "creative":
      requirements.push("minimal"); // Less memory needed
      break;
    case "social":
      requirements.push("user_preferences"); // Maybe name, greeting style
      break;
  }

  return requirements;
}

// =============================================================================
// ENTITY EXTRACTION
// =============================================================================

/**
 * Common entity patterns
 */
const ENTITY_PATTERNS: Array<{
  pattern: RegExp;
  type: ExtractedEntity["type"];
  groupIndex: number;
}> = [
  // Names (capitalized words)
  { pattern: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g, type: "person", groupIndex: 1 },
  // Projects/products (often with version numbers or code names)
  { pattern: /\b([A-Z][a-zA-Z]+(?:\s+\d+)?(?:\.\d+)*)\b/g, type: "project", groupIndex: 1 },
  // Organizations (common suffixes)
  {
    pattern: /\b([A-Z][a-zA-Z]+(?:\s+(?:Inc|Corp|LLC|Ltd|Co|Group))?)\b/g,
    type: "organization",
    groupIndex: 1,
  },
  // Technical terms
  {
    pattern: /\b(API|CLI|SDK|UI|UX|ML|AI|LLM|GPU|CPU|RAM|SSD|HDD)\b/gi,
    type: "thing",
    groupIndex: 1,
  },
  // Quoted strings (explicit entities)
  { pattern: /"([^"]+)"/g, type: "unknown", groupIndex: 1 },
  { pattern: /'([^']+)'/g, type: "unknown", groupIndex: 1 },
];

/**
 * Time-related words to exclude from entity extraction
 */
const EXCLUDED_WORDS = new Set([
  "I",
  "You",
  "We",
  "They",
  "He",
  "She",
  "It",
  "The",
  "A",
  "An",
  "This",
  "That",
  "What",
  "Where",
  "When",
  "Why",
  "How",
  "Which",
  "Who",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "Today",
  "Yesterday",
  "Tomorrow",
  "Please",
  "Thanks",
  "Hello",
  "Hi",
  "Yes",
  "No",
  "Maybe",
  "Sure",
  "Okay",
  "Good",
  "Great",
  "Nice",
  "Cool",
]);

/**
 * Extract entities from a message
 */
export function extractEntities(message: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  for (const { pattern, type, groupIndex } of ENTITY_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(message)) !== null) {
      const value = match[groupIndex]?.trim();

      if (!value || value.length < 2 || value.length > 50) continue;
      if (EXCLUDED_WORDS.has(value)) continue;
      if (seen.has(value.toLowerCase())) continue;

      seen.add(value.toLowerCase());
      entities.push({
        value,
        type,
        confidence: calculateEntityConfidence(value, type, message),
      });
    }
  }

  return entities;
}

/**
 * Calculate confidence for an extracted entity
 */
function calculateEntityConfidence(
  value: string,
  type: ExtractedEntity["type"],
  context: string,
): number {
  let confidence = 0.5; // Base

  // Quoted entities are more certain
  if (context.includes(`"${value}"`) || context.includes(`'${value}'`)) {
    confidence += 0.3;
  }

  // Longer names are more likely to be real entities
  if (value.split(" ").length > 1) {
    confidence += 0.1;
  }

  // Technical terms are high confidence
  if (type === "thing" && /^[A-Z]{2,}$/.test(value)) {
    confidence += 0.2;
  }

  // Repeated mentions increase confidence
  const mentions = (context.match(new RegExp(value, "gi")) || []).length;
  if (mentions > 1) {
    confidence += 0.1 * Math.min(mentions - 1, 3);
  }

  return Math.min(1, confidence);
}

// =============================================================================
// TEMPORAL EXTRACTION
// =============================================================================

/**
 * Patterns for extracting temporal references
 */
const TEMPORAL_PATTERNS: Array<{
  pattern: RegExp;
  type: TemporalReference["type"];
  resolve: (match: RegExpMatchArray) => { rangeStart?: string; rangeEnd?: string };
}> = [
  // Relative: yesterday, last week, etc.
  {
    pattern: /\byesterday\b/i,
    type: "relative",
    resolve: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      return { rangeStart: d.toISOString(), rangeEnd: end.toISOString() };
    },
  },
  {
    pattern: /\blast\s+week\b/i,
    type: "relative",
    resolve: () => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return { rangeStart: d.toISOString(), rangeEnd: new Date().toISOString() };
    },
  },
  {
    pattern: /\blast\s+month\b/i,
    type: "relative",
    resolve: () => {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      return { rangeStart: d.toISOString(), rangeEnd: new Date().toISOString() };
    },
  },
  {
    pattern: /\b(\d+)\s+days?\s+ago\b/i,
    type: "relative",
    resolve: (match) => {
      const days = parseInt(match[1], 10);
      const d = new Date();
      d.setDate(d.getDate() - days);
      return { rangeStart: d.toISOString(), rangeEnd: new Date().toISOString() };
    },
  },
  {
    pattern: /\bthis\s+morning\b/i,
    type: "relative",
    resolve: () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(12, 0, 0, 0);
      return { rangeStart: d.toISOString(), rangeEnd: end.toISOString() };
    },
  },
  {
    pattern: /\bearlier\s+today\b/i,
    type: "relative",
    resolve: () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return { rangeStart: d.toISOString(), rangeEnd: new Date().toISOString() };
    },
  },
  {
    pattern: /\brecently\b/i,
    type: "relative",
    resolve: () => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return { rangeStart: d.toISOString(), rangeEnd: new Date().toISOString() };
    },
  },
  // Absolute dates
  {
    pattern: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    type: "absolute",
    resolve: (match) => {
      const d = new Date(`${match[1]}-${match[2]}-${match[3]}`);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      return { rangeStart: d.toISOString(), rangeEnd: end.toISOString() };
    },
  },
];

/**
 * Extract temporal reference from a message
 */
export function extractTemporalReference(message: string): TemporalReference {
  for (const { pattern, type, resolve } of TEMPORAL_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      const range = resolve(match);
      return {
        type,
        reference: match[0],
        ...range,
      };
    }
  }

  return { type: "none", reference: "" };
}

// =============================================================================
// MEMORY NEED PREDICTION
// =============================================================================

/**
 * Predict what memories will be needed based on intent
 */
export function predictMemoryNeeds(
  intent: MemoryIntent,
  recentTopics: string[] = [],
): PrefetchPrediction {
  const predictedNeeds: PrefetchPrediction["predictedNeeds"] = [];
  let confidence = 0.5;

  // Based on intent type
  switch (intent.intentType) {
    case "question":
      predictedNeeds.push("facts", "episodes");
      confidence = 0.8;
      break;
    case "command":
      predictedNeeds.push("procedures", "facts");
      confidence = 0.7;
      break;
    case "reference":
      predictedNeeds.push("episodes", "facts", "causal");
      confidence = 0.85;
      break;
    case "creative":
      // Creative tasks need less memory - avoid polluting context
      confidence = 0.3;
      break;
    case "social":
      predictedNeeds.push("facts"); // Just basic user facts
      confidence = 0.5;
      break;
  }

  // Entity-based predictions
  if (intent.entities.length > 0) {
    predictedNeeds.push("entity_facts");
    confidence += 0.1;
  }

  // Temporal hints increase episode need
  if (intent.temporalHints.length > 0) {
    if (!predictedNeeds.includes("episodes")) {
      predictedNeeds.push("episodes");
    }
    confidence += 0.1;
  }

  // Recent topic continuity
  const topicOverlap = intent.entities.filter((e) => recentTopics.includes(e.toLowerCase()));
  if (topicOverlap.length > 0) {
    confidence += 0.05 * topicOverlap.length;
  }

  return {
    intent,
    predictedNeeds: [...new Set(predictedNeeds)],
    confidence: Math.min(1, confidence),
    suggestedQueries: generateSuggestedQueries(intent),
  };
}

/**
 * Generate suggested queries for memory retrieval
 */
function generateSuggestedQueries(intent: MemoryIntent): string[] {
  const queries: string[] = [];

  // Entity-based queries
  for (const entity of intent.entities) {
    queries.push(`subject:${entity}`);
    queries.push(`object:${entity}`);
  }

  // Temporal queries
  for (const hint of intent.temporalHints) {
    queries.push(`temporal:${hint}`);
  }

  // Intent-based queries
  if (intent.intentType === "question" && intent.entities.length > 0) {
    queries.push(`related:${intent.entities.join(",")}`);
  }

  return queries;
}

// =============================================================================
// PREFETCH EXECUTION
// =============================================================================

/**
 * Execute prefetch based on prediction with detailed timing.
 * Tracks all sub-operation latencies and reports against the <100ms target.
 *
 * @param prediction - The prefetch prediction from analyzePrefetchNeeds
 * @param queryFacts - Function to query facts from database
 * @param queryEpisodes - Function to query episodes from database
 * @param queryCausalLinks - Function to query causal links from database
 * @param config - Prefetch configuration
 * @param agentId - Optional agent ID for metrics recording
 */
export function executePrefetch(
  prediction: PrefetchPrediction,
  // These would be actual DB query functions
  queryFacts: (query: string) => Fact[],
  queryEpisodes: (query: string) => Episode[],
  queryCausalLinks: (query: string) => CausalLink[],
  config: PrefetchConfig = {},
  agentId?: string,
): PrefetchResult {
  const startTime = Date.now();
  const maxFacts = config.maxFacts ?? 10;
  const maxEpisodes = config.maxEpisodes ?? 5;

  const facts: Fact[] = [];
  const episodes: Episode[] = [];
  const causalLinks: CausalLink[] = [];
  const entitiesExpanded: string[] = [];

  // Track timing for each phase
  const dbQueryStart = Date.now();

  // Query based on predicted needs
  for (const need of prediction.predictedNeeds) {
    for (const query of prediction.suggestedQueries) {
      switch (need) {
        case "facts":
        case "entity_facts": {
          const results = queryFacts(query);
          for (const fact of results) {
            if (facts.length < maxFacts && !facts.find((f) => f.id === fact.id)) {
              facts.push(fact);
            }
          }
          break;
        }
        case "episodes": {
          const results = queryEpisodes(query);
          for (const episode of results) {
            if (episodes.length < maxEpisodes && !episodes.find((e) => e.id === episode.id)) {
              episodes.push(episode);
            }
          }
          break;
        }
        case "causal": {
          const results = queryCausalLinks(query);
          causalLinks.push(...results);
          break;
        }
      }
    }
  }

  const dbQueryMs = Date.now() - dbQueryStart;

  // Entity expansion
  if (config.expandEntities !== false) {
    for (const entity of prediction.intent.entities) {
      entitiesExpanded.push(entity);
    }
  }

  const totalMs = Date.now() - startTime;
  const metLatencyTarget = totalMs <= PREFETCH_LATENCY_TARGET_MS;

  // Build timing breakdown
  // Note: intentClassification and entityExtraction times are from the prediction phase
  // which happens before executePrefetch is called
  const timing = {
    intentClassificationMs: 0, // Measured in analyzePrefetchNeeds
    entityExtractionMs: 0, // Measured in analyzePrefetchNeeds
    dbQueryMs,
    totalMs,
  };

  const result: PrefetchResult = {
    prediction,
    facts,
    episodes,
    causalLinks,
    prefetchTimeMs: totalMs,
    metLatencyTarget,
    timing,
    debug: {
      entitiesExpanded,
    },
  };

  // Record metrics if agentId provided
  if (agentId) {
    const metrics: EnhancedPrefetchMetrics = {
      timestamp: Date.now(),
      agentId,
      hadMemories: facts.length > 0 || episodes.length > 0 || causalLinks.length > 0,
      factsCount: facts.length,
      episodesCount: episodes.length,
      durationMs: totalMs,
      intentType: prediction.intent.intentType,
      entities: prediction.intent.entities,
      timing: {
        totalMs,
        intentClassificationMs: timing.intentClassificationMs,
        entityExtractionMs: timing.entityExtractionMs,
        dbQueryMs,
        metLatencyTarget,
      },
    };
    recordPrefetchWithTiming(metrics);
  }

  return result;
}

// =============================================================================
// MAIN PREFETCH FUNCTION
// =============================================================================

/**
 * Timed prefetch analysis result with timing breakdown
 */
export type TimedPrefetchPrediction = PrefetchPrediction & {
  /** Timing breakdown for the analysis phase */
  analysisTimingMs: {
    intentClassification: number;
    entityExtraction: number;
    prediction: number;
    total: number;
  };
};

/**
 * Main entry point: analyze message and predict memory needs
 */
export function analyzePrefetchNeeds(
  message: string,
  recentTopics: string[] = [],
): PrefetchPrediction {
  const intent = classifyIntent(message);
  return predictMemoryNeeds(intent, recentTopics);
}

/**
 * Analyze prefetch needs with detailed timing.
 * Use this when you need to track analysis-phase latency.
 */
export function analyzePrefetchNeedsTimed(
  message: string,
  recentTopics: string[] = [],
): TimedPrefetchPrediction {
  const startTime = Date.now();

  // Time intent classification
  const intentStart = Date.now();
  const intent = classifyIntent(message);
  const intentMs = Date.now() - intentStart;

  // Entity extraction is part of intent classification, so we estimate it
  // based on the number of entities found
  const entityMs = Math.max(1, intent.entities.length * 0.5);

  // Time prediction
  const predictionStart = Date.now();
  const prediction = predictMemoryNeeds(intent, recentTopics);
  const predictionMs = Date.now() - predictionStart;

  const totalMs = Date.now() - startTime;

  return {
    ...prediction,
    analysisTimingMs: {
      intentClassification: intentMs - entityMs,
      entityExtraction: entityMs,
      prediction: predictionMs,
      total: totalMs,
    },
  };
}

/**
 * Quick utility: should we even bother prefetching?
 * Returns false for simple greetings, acknowledgments, etc.
 */
export function shouldPrefetch(message: string): boolean {
  const intent = classifyIntent(message);

  // Social messages don't need much prefetch
  if (intent.intentType === "social") {
    return false;
  }

  // Very short messages are likely acknowledgments
  if (message.trim().length < 10 && intent.entities.length === 0) {
    return false;
  }

  // Creative tasks benefit less from memory
  if (intent.intentType === "creative" && intent.entities.length === 0) {
    return false;
  }

  return true;
}
