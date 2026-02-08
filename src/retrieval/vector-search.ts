/**
 * SHEEP AI - Enhanced Vector Similarity Search
 *
 * Provides multiple similarity algorithms and performance optimizations for
 * vector-based semantic search. Supports cosine similarity, dot product,
 * euclidean distance, and other metrics.
 *
 * @module sheep/retrieval/vector-search
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { SheepDatabase } from "../memory/database.js";
import type { Fact } from "../memory/schema.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { cosineSimilarity } from "../memory/semantic-search.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Similarity metric types
 */
export type SimilarityMetric =
  | "cosine" // Cosine similarity (default, best for normalized embeddings)
  | "dot_product" // Dot product (fast, good for normalized vectors)
  | "euclidean" // Euclidean distance (converted to similarity)
  | "manhattan" // Manhattan/L1 distance (converted to similarity)
  | "pearson"; // Pearson correlation coefficient

/**
 * Vector search result
 */
export type VectorSearchResult = {
  fact: Fact;
  score: number; // Similarity score (0-1, higher is better)
  metric: SimilarityMetric;
};

/**
 * Options for vector search
 */
export type VectorSearchOptions = {
  /** Maximum number of results (default: 10) */
  topK?: number;
  /** Minimum similarity threshold (default: 0.3) */
  minSimilarity?: number;
  /** Similarity metric to use (default: "cosine") */
  metric?: SimilarityMetric;
  /** Only return active facts (default: true) */
  activeOnly?: boolean;
  /** Batch size for processing (default: 100) */
  batchSize?: number;
  /** Use approximate search for large datasets (default: false) */
  approximate?: boolean;
  /** Early termination threshold (stop if score drops below this) */
  earlyTerminationThreshold?: number;
};

// =============================================================================
// SIMILARITY ALGORITHMS
// =============================================================================

/**
 * Calculate dot product similarity
 * Fast for normalized vectors, equivalent to cosine similarity
 */
function dotProductSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }

  // For normalized vectors, dot product = cosine similarity
  // Normalize to 0-1 range assuming vectors are normalized
  return (dotProduct + 1) / 2; // Map from [-1, 1] to [0, 1]
}

/**
 * Calculate euclidean distance and convert to similarity
 * Similarity = 1 / (1 + distance)
 */
function euclideanSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let sumSquaredDiff = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sumSquaredDiff += diff * diff;
  }

  const distance = Math.sqrt(sumSquaredDiff);
  // Convert distance to similarity: 1 / (1 + distance)
  // Normalize by vector dimension for better scaling
  const normalizedDistance = distance / Math.sqrt(a.length);
  return 1 / (1 + normalizedDistance);
}

/**
 * Calculate manhattan (L1) distance and convert to similarity
 */
function manhattanSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let sumAbsDiff = 0;
  for (let i = 0; i < a.length; i++) {
    sumAbsDiff += Math.abs(a[i] - b[i]);
  }

  // Convert distance to similarity
  const normalizedDistance = sumAbsDiff / a.length;
  return 1 / (1 + normalizedDistance);
}

/**
 * Calculate Pearson correlation coefficient
 * Measures linear correlation between vectors
 */
function pearsonSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  // Calculate means
  const meanA = a.reduce((sum, val) => sum + val, 0) / a.length;
  const meanB = b.reduce((sum, val) => sum + val, 0) / b.length;

  // Calculate numerator and denominators
  let numerator = 0;
  let sumSqDiffA = 0;
  let sumSqDiffB = 0;

  for (let i = 0; i < a.length; i++) {
    const diffA = a[i] - meanA;
    const diffB = b[i] - meanB;
    numerator += diffA * diffB;
    sumSqDiffA += diffA * diffA;
    sumSqDiffB += diffB * diffB;
  }

  const denominator = Math.sqrt(sumSqDiffA * sumSqDiffB);
  if (denominator === 0) return 0;

  const correlation = numerator / denominator;
  // Convert from [-1, 1] to [0, 1]
  return (correlation + 1) / 2;
}

/**
 * Calculate similarity using specified metric
 */
function calculateSimilarity(a: number[], b: number[], metric: SimilarityMetric): number {
  switch (metric) {
    case "cosine":
      return cosineSimilarity(a, b);
    case "dot_product":
      return dotProductSimilarity(a, b);
    case "euclidean":
      return euclideanSimilarity(a, b);
    case "manhattan":
      return manhattanSimilarity(a, b);
    case "pearson":
      return pearsonSimilarity(a, b);
    default:
      return cosineSimilarity(a, b);
  }
}

// =============================================================================
// EMBEDDING UTILITIES
// =============================================================================

/**
 * Convert BLOB embedding to number array
 */
function blobToEmbedding(blob: Buffer | null): number[] | null {
  if (!blob || blob.length === 0) {
    return null;
  }
  try {
    const floatCount = blob.length / 4;
    if (floatCount === 0 || !Number.isInteger(floatCount)) {
      return null;
    }
    const floatArray = new Float32Array(blob.buffer, blob.byteOffset, floatCount);
    const embedding = Array.from(floatArray);

    // Validate dimensions
    if (embedding.length < 384 || embedding.length > 8192) {
      return null;
    }

    return embedding;
  } catch (err) {
    log.warn("Failed to convert BLOB to embedding", { error: String(err) });
    return null;
  }
}

/**
 * Normalize vector to unit length (L2 normalization)
 */
function normalizeVector(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return vec;
  return vec.map((val) => val / magnitude);
}

// =============================================================================
// VECTOR SEARCH
// =============================================================================

/**
 * Enhanced vector similarity search using embeddings
 *
 * Supports multiple similarity metrics and performance optimizations:
 * - Batch processing for efficiency
 * - Early termination for approximate search
 * - Multiple similarity algorithms
 * - Configurable thresholds
 *
 * @param queries - Query strings to search for
 * @param db - Database instance
 * @param provider - Embedding provider
 * @param options - Search options
 * @returns Array of search results sorted by similarity
 */
export async function vectorSearch(
  queries: string[],
  db: SheepDatabase,
  provider: EmbeddingProvider,
  options: VectorSearchOptions = {},
): Promise<VectorSearchResult[]> {
  const topK = options.topK ?? 10;
  const minSimilarity = options.minSimilarity ?? 0.3;
  const metric = options.metric ?? "cosine";
  const activeOnly = options.activeOnly !== false;
  const batchSize = options.batchSize ?? 100;
  const earlyTermination = options.earlyTerminationThreshold ?? 0;

  if (queries.length === 0) {
    return [];
  }

  const allResults: Map<string, VectorSearchResult> = new Map();

  // Process queries
  for (const query of queries) {
    try {
      // Generate query embedding
      const queryEmbedding = await provider.embedQuery(query);

      // Normalize query embedding for cosine/dot product metrics
      const normalizedQuery =
        metric === "cosine" || metric === "dot_product"
          ? normalizeVector(queryEmbedding)
          : queryEmbedding;

      // Get facts with embeddings
      const sql = activeOnly
        ? `SELECT id, embedding 
           FROM sheep_facts 
           WHERE is_active = 1
             AND embedding IS NOT NULL
             AND LENGTH(embedding) >= 1536
           LIMIT ?`
        : `SELECT id, embedding 
           FROM sheep_facts 
           WHERE embedding IS NOT NULL
             AND LENGTH(embedding) >= 1536
           LIMIT ?`;

      const factsWithEmbeddings = db.db
        .prepare(sql)
        .all(topK * (options.approximate ? 2 : 5)) as Array<{
        id: string;
        embedding: Buffer | null;
      }>;

      // Calculate similarities in batches
      const similarities: Array<{ factId: string; similarity: number }> = [];
      let processedCount = 0;
      let consecutiveLowScores = 0;

      for (let i = 0; i < factsWithEmbeddings.length; i += batchSize) {
        const batch = factsWithEmbeddings.slice(i, i + batchSize);

        for (const row of batch) {
          const embedding = blobToEmbedding(row.embedding);
          if (!embedding || embedding.length !== queryEmbedding.length) {
            continue;
          }

          try {
            // Normalize fact embedding if needed
            const normalizedFact =
              metric === "cosine" || metric === "dot_product"
                ? normalizeVector(embedding)
                : embedding;

            const similarity = calculateSimilarity(normalizedQuery, normalizedFact, metric);

            if (similarity >= minSimilarity) {
              similarities.push({
                factId: row.id,
                similarity,
              });
              consecutiveLowScores = 0;
            } else {
              consecutiveLowScores++;
            }

            processedCount++;

            // Early termination for approximate search
            if (
              options.approximate &&
              earlyTermination > 0 &&
              consecutiveLowScores > 50 &&
              similarities.length >= topK
            ) {
              log.debug("Early termination triggered", {
                processed: processedCount,
                results: similarities.length,
              });
              break;
            }
          } catch (err) {
            // Skip if similarity calculation fails
            continue;
          }
        }

        // Early termination check after batch
        if (
          options.approximate &&
          earlyTermination > 0 &&
          consecutiveLowScores > 50 &&
          similarities.length >= topK
        ) {
          break;
        }
      }

      // Sort by similarity and get top K
      similarities.sort((a, b) => b.similarity - a.similarity);
      const topSimilarities = similarities.slice(0, topK);

      // Fetch facts and create results
      for (let i = 0; i < topSimilarities.length; i++) {
        const { factId, similarity } = topSimilarities[i];
        const fact = db.getFact(factId);

        if (fact) {
          const existing = allResults.get(factId);
          if (!existing || similarity > existing.score) {
            allResults.set(factId, {
              fact,
              score: similarity,
              metric,
            });
          }
        }
      }
    } catch (err) {
      log.warn("Vector search failed for query", {
        query: query.slice(0, 50),
        error: String(err),
      });
    }
  }

  // Return top K results sorted by score
  return Array.from(allResults.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Batch vector search for multiple queries
 * More efficient than calling vectorSearch multiple times
 */
export async function batchVectorSearch(
  queries: string[],
  db: SheepDatabase,
  provider: EmbeddingProvider,
  options: VectorSearchOptions = {},
): Promise<Map<string, VectorSearchResult[]>> {
  const results = new Map<string, VectorSearchResult[]>();

  // Generate all query embeddings in parallel
  const queryEmbeddings = await Promise.all(queries.map((query) => provider.embedQuery(query)));

  // Process each query
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const queryEmbedding = queryEmbeddings[i];

    // Create a temporary provider that returns the pre-computed embedding
    const tempProvider: EmbeddingProvider = {
      id: provider.id,
      model: provider.model,
      embedQuery: async () => queryEmbedding,
      embedBatch: provider.embedBatch,
    };

    const searchResults = await vectorSearch([query], db, tempProvider, options);
    results.set(query, searchResults);
  }

  return results;
}

/**
 * Find similar facts to a given fact
 * Useful for contradiction detection and fact clustering
 */
export async function findSimilarFacts(
  fact: Fact,
  db: SheepDatabase,
  provider: EmbeddingProvider,
  options: VectorSearchOptions & { excludeFactId?: string } = {},
): Promise<VectorSearchResult[]> {
  const factText = `${fact.subject} ${fact.predicate} ${fact.object}`;

  // Get fact's embedding from database
  const row = db.db.prepare("SELECT embedding FROM sheep_facts WHERE id = ?").get(fact.id) as
    | { embedding: Buffer | null }
    | undefined;

  if (!row?.embedding) {
    // Generate embedding if not found
    const embedding = await provider.embedQuery(factText);
    // Use the generated embedding for search
    const tempProvider: EmbeddingProvider = {
      id: provider.id,
      model: provider.model,
      embedQuery: async () => embedding,
      embedBatch: provider.embedBatch,
    };
    return vectorSearch([factText], db, tempProvider, options);
  }

  // Use existing embedding
  const factEmbedding = blobToEmbedding(row.embedding);
  if (!factEmbedding) {
    return [];
  }

  const tempProvider: EmbeddingProvider = {
    id: provider.id,
    model: provider.model,
    embedQuery: async () => factEmbedding,
    embedBatch: provider.embedBatch,
  };

  const results = await vectorSearch([factText], db, tempProvider, options);

  // Exclude the original fact if specified
  if (options.excludeFactId) {
    return results.filter((r) => r.fact.id !== options.excludeFactId);
  }

  return results.filter((r) => r.fact.id !== fact.id);
}
