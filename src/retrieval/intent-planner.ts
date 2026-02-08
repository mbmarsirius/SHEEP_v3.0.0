/**
 * SHEEP AI - Intent-Aware Retrieval Planning
 *
 * SimpleMem's Intent-Aware Retrieval Planning: P(q, H) → {q_sem, q_lex, q_sym, d}
 *
 * Analyzes user queries to create an optimal retrieval plan that combines:
 * - Semantic queries (q_sem): For vector similarity search
 * - Lexical queries (q_lex): For BM25 keyword search
 * - Symbolic queries (q_sym): For metadata/structured filtering
 * - Retrieval depth (d): Shallow (single round) or deep (multi-round)
 *
 * This enables more intelligent and efficient memory retrieval by understanding
 * what the user is really asking for.
 *
 * @module sheep/retrieval/intent-planner
 */

import type { LLMProvider } from "../extraction/llm-extractor.js";
import { createSubsystemLogger } from "../stubs/logging.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Metadata filters for structured search
 */
export type MetadataFilters = {
  /** Person names mentioned in query */
  persons?: string[];
  /** Date range for temporal filtering */
  dateRange?: {
    start: string; // ISO date string
    end: string; // ISO date string
  };
  /** Location names */
  locations?: string[];
  /** Subject entities */
  subjects?: string[];
  /** Predicate types */
  predicates?: string[];
};

/**
 * Retrieval plan created from query analysis
 */
export type RetrievalPlan = {
  /** Semantic queries for vector similarity search */
  semanticQueries: string[];
  /** Keyword queries for BM25 search */
  keywordQueries: string[];
  /** Metadata filters for structured search */
  metadataFilters: MetadataFilters;
  /** Retrieval depth: "shallow" (single round) or "deep" (multi-round) */
  retrievalDepth: "shallow" | "deep";
  /** Query intent classification */
  intent: {
    type: "question" | "command" | "reference" | "exploratory" | "factual";
    confidence: number;
  };
  /** Extracted entities from query */
  entities: string[];
};

/**
 * Options for retrieval planning
 */
export type PlanningOptions = {
  /** Whether to use LLM for planning (default: true) */
  useLLM?: boolean;
  /** Fallback to simple planning if LLM fails (default: true) */
  fallbackToSimple?: boolean;
};

// =============================================================================
// SIMPLE PLANNING (FALLBACK)
// =============================================================================

/**
 * Simple planning without LLM - uses pattern matching
 */
function simplePlan(query: string): RetrievalPlan {
  const queryLower = query.toLowerCase();

  // Extract keywords (remove stopwords)
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "can",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "what",
    "when",
    "where",
    "why",
    "how",
    "who",
    "which",
  ]);

  const keywords = queryLower
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopwords.has(word));

  // Detect intent
  let intentType: RetrievalPlan["intent"]["type"] = "factual";
  let confidence = 0.6;

  if (queryLower.match(/^(what|who|where|when|why|how|which|can you tell|do you know)\b/i)) {
    intentType = "question";
    confidence = 0.8;
  } else if (queryLower.match(/^(remember|recall|that time|previously|earlier|before)\b/i)) {
    intentType = "reference";
    confidence = 0.85;
  } else if (queryLower.match(/^(do|make|create|build|write|generate|run|execute)\b/i)) {
    intentType = "command";
    confidence = 0.75;
  } else if (queryLower.match(/\b(tell me about|explain|describe|what is|what are)\b/i)) {
    intentType = "exploratory";
    confidence = 0.7;
  }

  // Extract entities (simple: capitalized words and quoted strings)
  // Exclude question words and common verbs
  const questionWords = new Set([
    "What",
    "When",
    "Where",
    "Why",
    "How",
    "Who",
    "Which",
    "Remember",
    "Tell",
    "Create",
    "Find",
  ]);
  const entities: string[] = [];
  const capitalizedWords = query.match(/\b[A-Z][a-z]+\b/g);
  if (capitalizedWords) {
    entities.push(...capitalizedWords.filter((word) => !questionWords.has(word)));
  }
  const quotedStrings = query.match(/"([^"]+)"/g);
  if (quotedStrings) {
    entities.push(...quotedStrings.map((s) => s.slice(1, -1)));
  }

  // Extract date patterns
  const datePatterns = [
    /\b(\d{4})\b/g, // Years
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/gi,
    /\b(last\s+week|yesterday|today|tomorrow|last\s+month|last\s+year)\b/gi,
  ];

  const dateRange: MetadataFilters["dateRange"] | undefined = undefined; // Simple planner doesn't parse dates

  // Determine retrieval depth
  const retrievalDepth: "shallow" | "deep" =
    queryLower.match(/\b(and|also|then|after|before|since|because|as a result)\b/i) ||
    queryLower.includes("?") ||
    keywords.length > 5
      ? "deep"
      : "shallow";

  return {
    semanticQueries: [query], // Use original query for semantic search
    keywordQueries: keywords.length > 0 ? keywords : [queryLower],
    metadataFilters: {
      subjects: entities.length > 0 ? entities : undefined,
      ...(dateRange ? { dateRange } : {}),
    },
    retrievalDepth,
    intent: {
      type: intentType,
      confidence,
    },
    entities: [...new Set(entities)],
  };
}

// =============================================================================
// LLM-BASED PLANNING
// =============================================================================

/**
 * Plan retrieval using LLM for intelligent query analysis
 *
 * Uses LLM to analyze the query and create an optimal retrieval plan.
 * This implements SimpleMem's P(q, H) → {q_sem, q_lex, q_sym, d} mapping.
 *
 * @param query - User query string
 * @param llm - LLM provider for query analysis
 * @param options - Planning options
 * @returns Retrieval plan with semantic, lexical, and symbolic queries
 */
export async function planRetrieval(
  query: string,
  llm: LLMProvider,
  options: PlanningOptions = {},
): Promise<RetrievalPlan> {
  const useLLM = options.useLLM !== false;
  const fallbackToSimple = options.fallbackToSimple !== false;

  if (!useLLM) {
    log.debug("Using simple planning (LLM disabled)");
    return simplePlan(query);
  }

  const prompt = `You are a memory retrieval planning system. Analyze the user's query and create an optimal retrieval plan.

Query: "${query}"

Your task is to extract:
1. semantic_queries: List of semantic search queries (rephrased for better vector search, 1-3 queries)
2. keyword_queries: List of exact keyword searches for BM25 (important terms, names, dates, 2-5 keywords)
3. metadata_filters: Structured filters (extract persons, dates, locations, subjects, predicates)
4. retrieval_depth: "shallow" (single round, simple query) or "deep" (multi-round, complex query)
5. intent: Query intent type and confidence
6. entities: Extracted entity names (people, places, things)

Guidelines:
- semantic_queries: Rephrase for semantic understanding (e.g., "user preferences" → "what does the user like")
- keyword_queries: Extract exact terms, proper nouns, dates, technical terms
- metadata_filters: Extract structured information (persons, date ranges, locations)
- retrieval_depth: Use "deep" for multi-part questions, causal chains, or complex queries
- intent: Classify as "question", "command", "reference", "exploratory", or "factual"
- entities: Extract all named entities (people, places, organizations, etc.)

Return ONLY a JSON object with this exact structure:
{
  "semantic_queries": ["query1", "query2"],
  "keyword_queries": ["keyword1", "keyword2"],
  "metadata_filters": {
    "persons": ["Alice", "Bob"],
    "date_range": { "start": "2024-01-01", "end": "2024-12-31" },
    "locations": ["New York"],
    "subjects": ["user", "project"],
    "predicates": ["prefers", "uses"]
  },
  "retrieval_depth": "shallow" | "deep",
  "intent": {
    "type": "question" | "command" | "reference" | "exploratory" | "factual",
    "confidence": 0.0-1.0
  },
  "entities": ["entity1", "entity2"]
}

Do not include any explanation or markdown formatting. Only return the JSON object.`;

  try {
    const response = await llm.complete(prompt, {
      jsonMode: true,
      maxTokens: 800,
      temperature: 0.3,
    });

    // Parse JSON response
    let plan: any;
    try {
      // Remove markdown code blocks if present
      const cleaned = response
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      plan = JSON.parse(cleaned);
    } catch (parseErr) {
      log.warn("Failed to parse LLM planning response", {
        response: response.slice(0, 200),
        error: String(parseErr),
      });
      if (fallbackToSimple) {
        log.info("Falling back to simple planning");
        return simplePlan(query);
      }
      throw new Error(`Failed to parse LLM response: ${parseErr}`);
    }

    // Validate and normalize plan
    const validatedPlan: RetrievalPlan = {
      semanticQueries: Array.isArray(plan.semantic_queries)
        ? plan.semantic_queries.filter((q: any) => typeof q === "string" && q.length > 0)
        : [query],
      keywordQueries: Array.isArray(plan.keyword_queries)
        ? plan.keyword_queries.filter((k: any) => typeof k === "string" && k.length > 0)
        : [],
      metadataFilters: {
        persons: Array.isArray(plan.metadata_filters?.persons)
          ? plan.metadata_filters.persons
          : undefined,
        dateRange: plan.metadata_filters?.date_range
          ? {
              start: plan.metadata_filters.date_range.start || "",
              end: plan.metadata_filters.date_range.end || "",
            }
          : undefined,
        locations: Array.isArray(plan.metadata_filters?.locations)
          ? plan.metadata_filters.locations
          : undefined,
        subjects: Array.isArray(plan.metadata_filters?.subjects)
          ? plan.metadata_filters.subjects
          : undefined,
        predicates: Array.isArray(plan.metadata_filters?.predicates)
          ? plan.metadata_filters.predicates
          : undefined,
      },
      retrievalDepth: plan.retrieval_depth === "deep" ? "deep" : "shallow",
      intent: {
        type:
          plan.intent?.type &&
          ["question", "command", "reference", "exploratory", "factual"].includes(plan.intent.type)
            ? plan.intent.type
            : "factual",
        confidence: Math.max(0, Math.min(1, plan.intent?.confidence ?? 0.7)),
      },
      entities: Array.isArray(plan.entities)
        ? [...new Set(plan.entities.filter((e: unknown) => typeof e === "string") as string[])]
        : [],
    };

    // Ensure at least one semantic query
    if (validatedPlan.semanticQueries.length === 0) {
      validatedPlan.semanticQueries = [query];
    }

    // Ensure at least one keyword query
    if (validatedPlan.keywordQueries.length === 0) {
      validatedPlan.keywordQueries = query
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 5);
    }

    log.debug("Retrieval plan created", {
      query: query.slice(0, 50),
      semanticQueries: validatedPlan.semanticQueries.length,
      keywordQueries: validatedPlan.keywordQueries.length,
      retrievalDepth: validatedPlan.retrievalDepth,
      intent: validatedPlan.intent.type,
    });

    return validatedPlan;
  } catch (err) {
    log.error("LLM retrieval planning failed", {
      query: query.slice(0, 50),
      error: String(err),
    });

    if (fallbackToSimple) {
      log.info("Falling back to simple planning");
      return simplePlan(query);
    }

    throw err;
  }
}

/**
 * Plan retrieval without LLM (simple pattern-based)
 *
 * Convenience function for when LLM is not available or not needed.
 */
export function planRetrievalSimple(query: string): RetrievalPlan {
  return simplePlan(query);
}
