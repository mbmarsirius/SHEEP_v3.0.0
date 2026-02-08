/**
 * SHEEP AI - Hybrid Retrieval with RRF Fusion
 *
 * EverMemOS-style Hybrid Retrieval: Combines semantic (vector), lexical (BM25),
 * and symbolic (metadata) search with Reciprocal Rank Fusion (RRF).
 *
 * This implements a comprehensive retrieval system that leverages:
 * - Semantic search: Vector similarity for concept matching
 * - Lexical search: BM25 for exact keyword matching
 * - Symbolic search: Metadata filters for structured queries
 *
 * Results are fused using RRF, which is more robust than simple weighted averaging.
 *
 * @module sheep/retrieval/hybrid-retrieval
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { LLMProvider } from "../extraction/llm-extractor.js";
import type { SheepDatabase } from "../memory/database.js";
import type { Fact } from "../memory/schema.js";
import type { RetrievalPlan, MetadataFilters } from "./intent-planner.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { bm25Search, type BM25SearchResult } from "./bm25-search.js";
import { planRetrieval } from "./intent-planner.js";
import { metadataSearch as enhancedMetadataSearch } from "./metadata-search.js";
import { vectorSearch as enhancedVectorSearch } from "./vector-search.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Unified retrieval result
 */
export type RetrievalResult = {
  fact: Fact;
  score: number; // Combined RRF score (0-1, higher is better)
  sources: {
    semantic?: number; // Semantic search rank
    lexical?: number; // BM25 search rank
    symbolic?: number; // Metadata search rank
  };
};

/**
 * Options for hybrid retrieval
 */
export type HybridRetrievalOptions = {
  /** Maximum number of results to return (default: 10) */
  topK?: number;
  /** Weights for different search types (default: semantic=0.4, lexical=0.3, symbolic=0.3) */
  weights?: {
    semantic?: number;
    lexical?: number;
    symbolic?: number;
  };
  /** Minimum score threshold (default: 0.1) */
  minScore?: number;
  /** Whether to use intent planning (default: true) */
  usePlanning?: boolean;
  /** Only return active facts (default: true) */
  activeOnly?: boolean;
};

/**
 * Result set with weight for RRF fusion
 */
type ResultSet = {
  results: RetrievalResult[];
  weight: number;
};

// =============================================================================
// VECTOR SEARCH WRAPPER
// =============================================================================

/**
 * Wrapper for vector search that converts to RetrievalResult format
 */
async function vectorSearch(
  queries: string[],
  db: SheepDatabase,
  provider: EmbeddingProvider,
  topK: number,
  activeOnly: boolean,
): Promise<RetrievalResult[]> {
  if (queries.length === 0) {
    return [];
  }

  // Use enhanced vector search
  const vectorResults = await enhancedVectorSearch(queries, db, provider, {
    topK,
    activeOnly,
    metric: "cosine", // Use cosine for hybrid retrieval
    minSimilarity: 0.1,
  });

  // Convert to RetrievalResult format
  return vectorResults.map((result, index) => ({
    fact: result.fact,
    score: result.score,
    sources: {
      semantic: index + 1,
    },
  }));
}

// =============================================================================
// METADATA SEARCH WRAPPER
// =============================================================================

/**
 * Wrapper for metadata search that converts to RetrievalResult format
 */
function metadataSearch(
  filters: MetadataFilters,
  db: SheepDatabase,
  topK: number,
  activeOnly: boolean,
): RetrievalResult[] {
  if (!filters || Object.keys(filters).length === 0) {
    return [];
  }

  // Use enhanced metadata search
  const metadataResults = enhancedMetadataSearch(filters, db, {
    topK,
    activeOnly,
    sortBy: "confidence",
  });

  // Convert to RetrievalResult format
  return metadataResults.map((result, index) => ({
    fact: result.fact,
    score: result.score,
    sources: {
      symbolic: index + 1,
    },
  }));
}

// =============================================================================
// RRF FUSION
// =============================================================================

/**
 * Reciprocal Rank Fusion
 *
 * RRF(d) = Σ weight_i / (k + rank_i(d))
 *
 * Where:
 * - d is a document/result
 * - weight_i is the weight for result set i
 * - rank_i(d) is the rank of document d in result set i
 * - k is a constant (typically 60)
 *
 * @param resultSets - Array of result sets with weights
 * @param topK - Maximum number of results to return
 * @param k - RRF constant (default: 60)
 * @returns Fused results sorted by RRF score
 */
function reciprocalRankFusion(
  resultSets: ResultSet[],
  topK: number,
  k: number = 60,
): RetrievalResult[] {
  const scores = new Map<string, RetrievalResult>();

  // Calculate RRF scores for each result set
  for (const { results, weight } of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank];
      const factId = result.fact.id;
      const rrfScore = weight / (k + rank + 1);

      const existing = scores.get(factId);
      if (existing) {
        // Combine scores and merge sources
        existing.score += rrfScore;
        existing.sources = {
          ...existing.sources,
          ...result.sources,
        };
      } else {
        // Create new entry
        scores.set(factId, {
          fact: result.fact,
          score: rrfScore,
          sources: { ...result.sources },
        });
      }
    }
  }

  // Sort by score (highest first) and return top K
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// =============================================================================
// HYBRID RETRIEVAL
// =============================================================================

/**
 * EverMemOS-style Hybrid Retrieval
 *
 * Combines semantic (vector), lexical (BM25), and symbolic (metadata) search
 * with Reciprocal Rank Fusion (RRF).
 *
 * Process:
 * 1. Plan retrieval using intent-aware planning (optional)
 * 2. Execute all search types in parallel
 * 3. Fuse results using RRF
 * 4. Return top K results
 *
 * @param query - User query string
 * @param db - Database instance
 * @param embeddingProvider - Embedding provider for vector search
 * @param llm - LLM provider for intent planning (optional)
 * @param options - Retrieval options
 * @returns Array of retrieval results sorted by RRF score
 */
export async function hybridRetrieve(
  query: string,
  db: SheepDatabase,
  embeddingProvider: EmbeddingProvider,
  llm?: LLMProvider,
  options: HybridRetrievalOptions = {},
): Promise<RetrievalResult[]> {
  const topK = options.topK ?? 10;
  const minScore = options.minScore ?? 0.1;
  const usePlanning = options.usePlanning !== false;
  const activeOnly = options.activeOnly !== false;

  // Default weights: semantic=0.4, lexical=0.3, symbolic=0.3
  const weights = {
    semantic: options.weights?.semantic ?? 0.4,
    lexical: options.weights?.lexical ?? 0.3,
    symbolic: options.weights?.symbolic ?? 0.3,
  };

  // Normalize weights to sum to 1.0
  const totalWeight = weights.semantic + weights.lexical + weights.symbolic;
  if (totalWeight > 0) {
    weights.semantic /= totalWeight;
    weights.lexical /= totalWeight;
    weights.symbolic /= totalWeight;
  }

  log.debug("Starting hybrid retrieval", {
    query: query.slice(0, 50),
    topK,
    weights,
    usePlanning,
  });

  // Step 1: Plan retrieval (if enabled and LLM available)
  let plan: RetrievalPlan | null = null;
  if (usePlanning && llm) {
    try {
      plan = await planRetrieval(query, llm, { fallbackToSimple: true });
      log.debug("Retrieval plan created", {
        semanticQueries: plan.semanticQueries.length,
        keywordQueries: plan.keywordQueries.length,
        retrievalDepth: plan.retrievalDepth,
      });
    } catch (err) {
      log.warn("Retrieval planning failed, using simple plan", {
        error: String(err),
      });
    }
  }

  // Use plan if available, otherwise use simple queries
  const semanticQueries = plan?.semanticQueries ?? [query];
  const keywordQueries = plan?.keywordQueries ?? [query];
  const metadataFilters = plan?.metadataFilters ?? {};

  // Step 2: Execute all search types in parallel
  const [semanticResults, lexicalResults, symbolicResults] = await Promise.all([
    // Semantic (vector) search
    vectorSearch(semanticQueries, db, embeddingProvider, topK * 2, activeOnly),

    // Lexical (BM25) search
    (async () => {
      const allResults: Map<string, BM25SearchResult> = new Map();
      for (const keywordQuery of keywordQueries) {
        const results = bm25Search(db, keywordQuery, {
          limit: topK * 2,
          activeOnly,
        });
        for (const result of results) {
          const existing = allResults.get(result.fact.id);
          if (!existing || result.score > existing.score) {
            allResults.set(result.fact.id, result);
          }
        }
      }
      return Array.from(allResults.values()).map((r, index) => ({
        fact: r.fact,
        score: r.score,
        sources: {
          lexical: index + 1,
        },
      }));
    })(),

    // Symbolic (metadata) search
    Promise.resolve(metadataSearch(metadataFilters, db, topK * 2, activeOnly)),
  ]);

  log.debug("Search results collected", {
    semantic: semanticResults.length,
    lexical: lexicalResults.length,
    symbolic: symbolicResults.length,
  });

  // Step 3: RRF Fusion
  const resultSets: ResultSet[] = [
    { results: semanticResults, weight: weights.semantic },
    { results: lexicalResults, weight: weights.lexical },
    { results: symbolicResults, weight: weights.symbolic },
  ];

  const fusedResults = reciprocalRankFusion(resultSets, topK * 2);

  // Normalize RRF scores to 0-1 range for better interpretability
  // RRF scores are typically very small (0.001-0.01), so we normalize by the max score
  if (fusedResults.length > 0) {
    const maxScore = fusedResults[0].score;
    if (maxScore > 0) {
      for (const result of fusedResults) {
        result.score = result.score / maxScore; // Normalize to 0-1
      }
    }
  }

  log.debug("RRF fusion completed", {
    fusedCount: fusedResults.length,
    topScore: fusedResults[0]?.score,
  });

  // Filter by minimum score (now normalized to 0-1)
  const filteredResults = fusedResults.filter((r) => r.score >= minScore);

  log.info("Hybrid retrieval completed", {
    query: query.slice(0, 50),
    fusedBeforeFilter: fusedResults.length,
    filteredAfterMinScore: filteredResults.length,
    minScore,
    semantic: semanticResults.length,
    lexical: lexicalResults.length,
    symbolic: symbolicResults.length,
  });

  return filteredResults.slice(0, topK);
}
