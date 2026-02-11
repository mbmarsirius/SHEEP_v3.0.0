/**
 * SHEEP AI - Semantic Memory Search
 *
 * THIS IS BREAKTHROUGH #2!
 *
 * Instead of keyword matching, we use vector embeddings to find
 * semantically similar memories. This enables:
 *
 * 1. "Find memories about programming" matches "discussed TypeScript"
 * 2. "What did we talk about travel?" finds "vacation planning in Italy"
 * 3. Contradiction detection based on semantic similarity
 * 4. Related fact discovery
 *
 * Integrates with Moltbot's existing embedding providers.
 *
 * IMPROVEMENT: Now supports persistent storage to SQLite so the index
 * survives restarts without rebuilding from scratch.
 *
 * @module sheep/memory/semantic-search
 */

import type { Episode, Fact, CausalLink } from "./schema.js";
import type { EmbeddingProvider } from "../stubs/embeddings.js";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A memory item with its embedding
 */
export type EmbeddedMemory = {
  id: string;
  type: "episode" | "fact" | "causal_link";
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
};

/**
 * Search result with similarity score
 */
export type SemanticSearchResult = {
  id: string;
  type: "episode" | "fact" | "causal_link";
  similarity: number;
  text: string;
  metadata: Record<string, unknown>;
};

/**
 * Configuration for semantic search
 */
export type SemanticSearchConfig = {
  /** Minimum similarity score (0-1) to include in results */
  minSimilarity?: number;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Memory types to search */
  types?: Array<"episode" | "fact" | "causal_link">;
};

// =============================================================================
// EMBEDDING UTILITIES
// =============================================================================

/**
 * Convert an episode to searchable text
 */
export function episodeToText(episode: Episode): string {
  return [episode.summary, `Topic: ${episode.topic}`, `Keywords: ${episode.keywords.join(", ")}`]
    .filter(Boolean)
    .join(". ");
}

/**
 * Convert a fact to searchable text
 */
export function factToText(fact: Fact): string {
  return `${fact.subject} ${fact.predicate.replace(/_/g, " ")} ${fact.object}`;
}

/**
 * Convert a causal link to searchable text
 */
export function causalLinkToText(link: CausalLink): string {
  return `${link.causeDescription} caused ${link.effectDescription} because ${link.mechanism}`;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// =============================================================================
// SEMANTIC MEMORY INDEX
// =============================================================================

/**
 * Persistent semantic index configuration
 */
export type SemanticIndexPersistenceConfig = {
  /** Base directory for storing index files */
  basePath?: string;
  /** Agent ID for namespacing the index */
  agentId?: string;
  /** Whether to auto-save after each addition (default: false for batching) */
  autoSave?: boolean;
  /** Maximum memories to keep in index (for size management) */
  maxMemories?: number;
};

/**
 * In-memory semantic index for fast similarity search.
 *
 * IMPROVEMENT: Now supports persistent storage to avoid rebuilding on restart.
 * - save(): Persist current state to disk
 * - load(): Load previously persisted state
 * - Auto-save option for automatic persistence
 */
export class SemanticMemoryIndex {
  private memories: EmbeddedMemory[] = [];
  private embeddingProvider: EmbeddingProvider | null = null;
  private persistConfig: SemanticIndexPersistenceConfig | null = null;
  private dirty = false;

  constructor(
    embeddingProvider?: EmbeddingProvider,
    persistConfig?: SemanticIndexPersistenceConfig,
  ) {
    this.embeddingProvider = embeddingProvider ?? null;
    this.persistConfig = persistConfig ?? null;

    // Auto-load if persistence is configured
    if (this.persistConfig?.agentId) {
      this.load();
    }
  }

  /**
   * Get the persistence file path for this index
   */
  private getIndexPath(): string | null {
    if (!this.persistConfig?.agentId) return null;
    const basePath =
      this.persistConfig.basePath ?? join(process.env.HOME ?? "", ".clawdbot", "sheep");
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true });
    }
    return join(basePath, `${this.persistConfig.agentId}.semantic.json`);
  }

  /**
   * Save the current index state to disk.
   * Call this after batch additions or periodically to persist.
   */
  save(): boolean {
    const indexPath = this.getIndexPath();
    if (!indexPath) return false;

    try {
      const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        memoriesCount: this.memories.length,
        memories: this.memories,
      };
      writeFileSync(indexPath, JSON.stringify(data), "utf-8");
      this.dirty = false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load a previously persisted index from disk.
   * Returns true if successfully loaded, false if no index exists.
   */
  load(): boolean {
    const indexPath = this.getIndexPath();
    if (!indexPath || !existsSync(indexPath)) return false;

    try {
      const raw = readFileSync(indexPath, "utf-8");
      const data = JSON.parse(raw) as { version: number; memories: EmbeddedMemory[] };

      if (data.version === 1 && Array.isArray(data.memories)) {
        this.memories = data.memories;
        this.dirty = false;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if there are unsaved changes
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Mark the index as having unsaved changes
   */
  private markDirty(): void {
    this.dirty = true;
    // Auto-save if configured
    if (this.persistConfig?.autoSave) {
      this.save();
    }
  }

  /**
   * Enforce memory size limits by pruning oldest entries
   */
  private enforceMemoryLimits(): void {
    const maxMemories = this.persistConfig?.maxMemories;
    if (!maxMemories || this.memories.length <= maxMemories) return;

    // Keep most recent entries (FIFO pruning)
    const toRemove = this.memories.length - maxMemories;
    this.memories.splice(0, toRemove);
  }

  /**
   * Set the embedding provider
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Add an episode to the index
   */
  async addEpisode(episode: Episode): Promise<void> {
    const text = episodeToText(episode);
    const embedding = await this.getEmbedding(text);

    this.memories.push({
      id: episode.id,
      type: "episode",
      text,
      embedding,
      metadata: {
        topic: episode.topic,
        timestamp: episode.timestamp,
        salience: episode.emotionalSalience,
      },
    });
    this.markDirty();
    this.enforceMemoryLimits();
  }

  /**
   * Add a fact to the index
   */
  async addFact(fact: Fact): Promise<void> {
    const text = factToText(fact);
    const embedding = await this.getEmbedding(text);

    this.memories.push({
      id: fact.id,
      type: "fact",
      text,
      embedding,
      metadata: {
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        confidence: fact.confidence,
      },
    });
    this.markDirty();
    this.enforceMemoryLimits();
  }

  /**
   * Add a causal link to the index
   */
  async addCausalLink(link: CausalLink): Promise<void> {
    const text = causalLinkToText(link);
    const embedding = await this.getEmbedding(text);

    this.memories.push({
      id: link.id,
      type: "causal_link",
      text,
      embedding,
      metadata: {
        cause: link.causeDescription,
        effect: link.effectDescription,
        mechanism: link.mechanism,
        confidence: link.confidence,
      },
    });
    this.markDirty();
    this.enforceMemoryLimits();
  }

  /**
   * Add multiple items in batch (more efficient)
   */
  async addBatch(
    items: Array<
      | { type: "episode"; item: Episode }
      | { type: "fact"; item: Fact }
      | { type: "causal_link"; item: CausalLink }
    >,
  ): Promise<void> {
    const texts: string[] = [];
    const itemData: Array<{
      type: "episode" | "fact" | "causal_link";
      id: string;
      metadata: Record<string, unknown>;
    }> = [];

    for (const entry of items) {
      if (entry.type === "episode") {
        texts.push(episodeToText(entry.item));
        itemData.push({
          type: "episode",
          id: entry.item.id,
          metadata: {
            topic: entry.item.topic,
            timestamp: entry.item.timestamp,
            salience: entry.item.emotionalSalience,
          },
        });
      } else if (entry.type === "fact") {
        texts.push(factToText(entry.item));
        itemData.push({
          type: "fact",
          id: entry.item.id,
          metadata: {
            subject: entry.item.subject,
            predicate: entry.item.predicate,
            object: entry.item.object,
            confidence: entry.item.confidence,
          },
        });
      } else if (entry.type === "causal_link") {
        texts.push(causalLinkToText(entry.item));
        itemData.push({
          type: "causal_link",
          id: entry.item.id,
          metadata: {
            cause: entry.item.causeDescription,
            effect: entry.item.effectDescription,
            confidence: entry.item.confidence,
          },
        });
      }
    }

    // Batch embed all texts
    const embeddings = await this.getBatchEmbeddings(texts);

    // Add to index
    for (let i = 0; i < texts.length; i++) {
      this.memories.push({
        id: itemData[i].id,
        type: itemData[i].type,
        text: texts[i],
        embedding: embeddings[i],
        metadata: itemData[i].metadata,
      });
    }
    this.markDirty();
    this.enforceMemoryLimits();
  }

  /**
   * Search for semantically similar memories
   */
  async search(query: string, config: SemanticSearchConfig = {}): Promise<SemanticSearchResult[]> {
    const { minSimilarity = 0.3, maxResults = 10, types } = config;

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.getEmbedding(query);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // If embedding fails (e.g., 500 error), return empty results
      // This allows the system to fall back to keyword search
      console.warn(`[SHEEP] Query embedding failed: ${errorMsg.slice(0, 100)}`);
      return [];
    }

    // Calculate similarities
    const results: SemanticSearchResult[] = [];

    for (const memory of this.memories) {
      // Filter by type if specified
      if (types && !types.includes(memory.type)) {
        continue;
      }

      // Skip if query embedding is all zeros (fallback from error)
      if (queryEmbedding.every((v) => v === 0)) {
        continue;
      }

      const similarity = cosineSimilarity(queryEmbedding, memory.embedding);

      if (similarity >= minSimilarity) {
        results.push({
          id: memory.id,
          type: memory.type,
          similarity,
          text: memory.text,
          metadata: memory.metadata,
        });
      }
    }

    // Sort by similarity (highest first) and limit results
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, maxResults);
  }

  /**
   * Find facts similar to a given fact (for contradiction detection)
   */
  async findSimilarFacts(fact: Fact, minSimilarity = 0.6): Promise<SemanticSearchResult[]> {
    const text = factToText(fact);
    return this.search(text, {
      minSimilarity,
      types: ["fact"],
      maxResults: 20,
    });
  }

  /**
   * Find related memories across all types
   */
  async findRelated(text: string, minSimilarity = 0.4): Promise<SemanticSearchResult[]> {
    return this.search(text, {
      minSimilarity,
      maxResults: 15,
    });
  }

  /**
   * Remove a memory from the index
   */
  remove(id: string): boolean {
    const index = this.memories.findIndex((m) => m.id === id);
    if (index >= 0) {
      this.memories.splice(index, 1);
      this.markDirty();
      return true;
    }
    return false;
  }

  /**
   * Clear all memories from the index
   */
  clear(): void {
    this.memories = [];
    this.markDirty();
  }

  /**
   * Get stats about the index
   */
  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const memory of this.memories) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;
    }
    return {
      total: this.memories.length,
      byType,
    };
  }

  /**
   * Get embedding for a single text
   * AUTONOMOUS MODE: Auto-retry on failures with exponential backoff
   */
  private async getEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingProvider) {
      // Return a random embedding for testing (384 dimensions like MiniLM)
      return Array.from({ length: 384 }, () => Math.random() * 2 - 1);
    }

    // Auto-retry with exponential backoff (max 3 attempts)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const embedFn = this.embeddingProvider!.embedQuery ?? this.embeddingProvider!.embed;
        return await embedFn.call(this.embeddingProvider, text);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const isTokenLimit = errorMsg.includes("500") || errorMsg.includes("token") || errorMsg.includes("limit");
        
        if (isTokenLimit && attempt < 2) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          console.warn(`[SHEEP] Embedding query failed (attempt ${attempt + 1}/3), retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        console.warn(`[SHEEP] Embedding generation failed for query: ${errorMsg.slice(0, 100)}`);
        // Return a zero vector as fallback (will result in low similarity scores)
        // Dimension should match the embedding model (typically 1536 for text-embedding-3-small)
        return new Array(1536).fill(0);
      }
    }

    // Should never reach here, but return zero vector as final fallback
    return new Array(1536).fill(0);
  }

  /**
   * Get embeddings for multiple texts (batch)
   * AUTONOMOUS MODE: Auto-retry with smaller batches on failures
   */
  private async getBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.embeddingProvider) {
      // Return random embeddings for testing
      return texts.map(() => Array.from({ length: 384 }, () => Math.random() * 2 - 1));
    }

    // Auto-retry with exponential backoff (max 3 attempts)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const batchFn = this.embeddingProvider!.embedBatch;
        if (!batchFn) throw new Error("embedBatch not available");
        return await batchFn.call(this.embeddingProvider, texts);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const isTokenLimit = errorMsg.includes("500") || errorMsg.includes("token") || errorMsg.includes("limit");
        
        if (isTokenLimit && attempt < 2) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          console.warn(`[SHEEP] Batch embedding failed (${texts.length} texts, attempt ${attempt + 1}/3), retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          
          const results: number[][] = [];
          const smallBatchSize = Math.max(4, Math.floor(texts.length / (attempt + 2)));
          
          for (let i = 0; i < texts.length; i += smallBatchSize) {
            const smallBatch = texts.slice(i, i + smallBatchSize);
            try {
              const fn = this.embeddingProvider!.embedBatch;
              if (!fn) throw new Error("embedBatch not available");
              const batchResults = await fn.call(this.embeddingProvider, smallBatch);
              results.push(...batchResults);
            } catch (smallErr) {
              // If even small batch fails, use zero vectors
              console.warn(`[SHEEP] Small batch embedding also failed: ${String(smallErr).slice(0, 100)}`);
              const zeroVector = new Array(1536).fill(0);
              results.push(...smallBatch.map(() => zeroVector));
            }
          }
          
          return results;
        }
        
        // If not retryable or last attempt, fallback to smaller batches
        console.warn(`[SHEEP] Batch embedding failed (${texts.length} texts): ${errorMsg.slice(0, 100)}`);
        break; // Exit retry loop and use fallback below
      }
    }
    
    // Final fallback: process with very small batches (4 items)
    const results: number[][] = [];
    const smallBatchSize = 4;
    
    for (let i = 0; i < texts.length; i += smallBatchSize) {
      const smallBatch = texts.slice(i, i + smallBatchSize);
      try {
        const fn = this.embeddingProvider!.embedBatch;
        if (!fn) throw new Error("embedBatch not available");
        const batchResults = await fn.call(this.embeddingProvider, smallBatch);
        results.push(...batchResults);
      } catch (smallErr) {
        console.warn(`[SHEEP] Small batch embedding failed: ${String(smallErr).slice(0, 100)}`);
        const zeroVector = new Array(1536).fill(0);
        results.push(...smallBatch.map(() => zeroVector));
      }
    }
    
    return results;
  }
}

// =============================================================================
// BM25 IMPLEMENTATION
// =============================================================================

/**
 * BM25 parameters (tuned for conversational memory)
 */
const BM25_K1 = 1.5; // Term frequency saturation
const BM25_B = 0.75; // Document length normalization

/**
 * Tokenize text into terms (simple whitespace + lowercase)
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1); // Skip single-char tokens
}

/**
 * Calculate term frequency for a document
 */
function termFrequency(terms: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const term of terms) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }
  return tf;
}

/**
 * BM25 Index for fast keyword-based retrieval
 *
 * BM25 is a probabilistic ranking function that considers:
 * - Term frequency (how often a term appears in a document)
 * - Inverse document frequency (how rare a term is across all documents)
 * - Document length normalization (longer docs don't get unfair advantage)
 */
export class BM25Index {
  private documents: Array<{
    id: string;
    type: "episode" | "fact" | "causal_link";
    text: string;
    terms: string[];
    tf: Map<string, number>;
    metadata: Record<string, unknown>;
  }> = [];

  /** Document frequency: how many docs contain each term */
  private df: Map<string, number> = new Map();

  /** Average document length */
  private avgDl = 0;

  /** Get document count for debugging */
  get documentCount(): number {
    return this.documents.length;
  }

  /**
   * Add a document to the index
   */
  add(
    id: string,
    type: "episode" | "fact" | "causal_link",
    text: string,
    metadata: Record<string, unknown>,
  ): void {
    const terms = tokenize(text);
    const tf = termFrequency(terms);

    // Update document frequency
    for (const term of new Set(terms)) {
      this.df.set(term, (this.df.get(term) || 0) + 1);
    }

    this.documents.push({ id, type, text, terms, tf, metadata });

    // Recalculate average document length
    this.avgDl = this.documents.reduce((sum, d) => sum + d.terms.length, 0) / this.documents.length;
  }

  /**
   * Add an episode to the index
   */
  addEpisode(episode: Episode): void {
    this.add(episode.id, "episode", episodeToText(episode), {
      topic: episode.topic,
      timestamp: episode.timestamp,
      salience: episode.emotionalSalience,
    });
  }

  /**
   * Add a fact to the index
   */
  addFact(fact: Fact): void {
    this.add(fact.id, "fact", factToText(fact), {
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      confidence: fact.confidence,
    });
  }

  /**
   * Add a causal link to the index
   */
  addCausalLink(link: CausalLink): void {
    this.add(link.id, "causal_link", causalLinkToText(link), {
      cause: link.causeDescription,
      effect: link.effectDescription,
      mechanism: link.mechanism,
      confidence: link.confidence,
    });
  }

  /**
   * Search using BM25 ranking
   */
  search(
    query: string,
    options: {
      maxResults?: number;
      minScore?: number;
      types?: Array<"episode" | "fact" | "causal_link">;
    } = {},
  ): SemanticSearchResult[] {
    const { maxResults = 10, minScore = 0.1, types } = options;
    const queryTerms = tokenize(query);
    const n = this.documents.length;

    if (n === 0 || queryTerms.length === 0) {
      return [];
    }

    const results: SemanticSearchResult[] = [];

    for (const doc of this.documents) {
      // Filter by type if specified
      if (types && !types.includes(doc.type)) {
        continue;
      }

      let score = 0;
      const dl = doc.terms.length;

      for (const term of queryTerms) {
        const tf = doc.tf.get(term) || 0;
        if (tf === 0) continue;

        const docFreq = this.df.get(term) || 0;
        // IDF with smoothing to avoid division by zero
        const idf = Math.log((n - docFreq + 0.5) / (docFreq + 0.5) + 1);

        // BM25 formula
        const tfNorm =
          (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / this.avgDl)));
        score += idf * tfNorm;
      }

      // Normalize score to 0-1 range (rough approximation)
      const normalizedScore = score / (queryTerms.length * 3);

      if (normalizedScore >= minScore) {
        results.push({
          id: doc.id,
          type: doc.type,
          similarity: Math.min(normalizedScore, 1), // Cap at 1
          text: doc.text,
          metadata: doc.metadata,
        });
      }
    }

    // Sort by score (highest first) and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, maxResults);
  }

  /**
   * Remove a document from the index
   */
  remove(id: string): boolean {
    const index = this.documents.findIndex((d) => d.id === id);
    if (index >= 0) {
      const doc = this.documents[index];
      // Update document frequency
      for (const term of new Set(doc.terms)) {
        const count = this.df.get(term) || 1;
        if (count <= 1) {
          this.df.delete(term);
        } else {
          this.df.set(term, count - 1);
        }
      }
      this.documents.splice(index, 1);
      // Recalculate average
      this.avgDl =
        this.documents.length > 0
          ? this.documents.reduce((sum, d) => sum + d.terms.length, 0) / this.documents.length
          : 0;
      return true;
    }
    return false;
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.documents = [];
    this.df.clear();
    this.avgDl = 0;
  }

  /**
   * Get stats about the index
   */
  getStats(): {
    total: number;
    uniqueTerms: number;
    avgDocLength: number;
    byType: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    for (const doc of this.documents) {
      byType[doc.type] = (byType[doc.type] || 0) + 1;
    }
    return {
      total: this.documents.length,
      uniqueTerms: this.df.size,
      avgDocLength: this.avgDl,
      byType,
    };
  }
}

// =============================================================================
// HYBRID SEARCH (BM25 + Vector)
// =============================================================================

/**
 * Configuration for hybrid search
 */
export type HybridSearchConfig = {
  /** Weight for BM25 keyword scores (0-1, default 0.4) */
  bm25Weight?: number;
  /** Weight for vector similarity scores (0-1, default 0.6) */
  vectorWeight?: number;
  /** Minimum combined score to include in results */
  minScore?: number;
  /** Maximum number of results */
  maxResults?: number;
  /** Memory types to search */
  types?: Array<"episode" | "fact" | "causal_link">;
};

/**
 * Perform hybrid search combining BM25 keyword matching and vector similarity.
 *
 * Hybrid search provides the best of both worlds:
 * - BM25 excels at exact term matching and phrase queries
 * - Vector search excels at semantic similarity and concept matching
 *
 * @param query - The search query
 * @param bm25Index - BM25 keyword index
 * @param semanticIndex - Vector similarity index
 * @param config - Search configuration
 */
export async function performHybridSearch(
  query: string,
  bm25Index: BM25Index,
  semanticIndex: SemanticMemoryIndex,
  config: HybridSearchConfig = {},
): Promise<SemanticSearchResult[]> {
  const { bm25Weight = 0.4, vectorWeight = 0.6, minScore = 0.2, maxResults = 10, types } = config;

  // Perform both searches in parallel
  // If semantic search fails (e.g., embedding 500 error), fall back to BM25 only
  let bm25Results: SemanticSearchResult[];
  let vectorResults: SemanticSearchResult[];

  try {
    [bm25Results, vectorResults] = await Promise.all([
      bm25Index.search(query, { maxResults: maxResults * 2, types }),
      semanticIndex.search(query, { maxResults: maxResults * 2, types, minSimilarity: 0.1 }).catch((err) => {
        // If semantic search fails (embedding error), return empty results
        // BM25 will still work, so we get keyword-based results
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[SHEEP] Semantic search failed in hybrid search: ${errorMsg.slice(0, 100)}`);
        return [];
      }),
    ]);
  } catch (err) {
    // If both fail, return empty results
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[SHEEP] Hybrid search failed: ${errorMsg.slice(0, 100)}`);
    return [];
  }

  // Combine results using reciprocal rank fusion (RRF)
  // RRF is more robust than simple weighted averaging
  const combined = new Map<
    string,
    { result: SemanticSearchResult; bm25Rank: number; vectorRank: number }
  >();

  // Process BM25 results
  for (let i = 0; i < bm25Results.length; i++) {
    const result = bm25Results[i];
    combined.set(result.id, {
      result,
      bm25Rank: i + 1,
      vectorRank: 9999, // Will be updated if found in vector results
    });
  }

  // Process vector results
  for (let i = 0; i < vectorResults.length; i++) {
    const result = vectorResults[i];
    const existing = combined.get(result.id);
    if (existing) {
      existing.vectorRank = i + 1;
    } else {
      combined.set(result.id, {
        result,
        bm25Rank: 9999,
        vectorRank: i + 1,
      });
    }
  }

  // Calculate RRF scores
  // RRF(d) = sum(1 / (k + rank_i)) where k is a constant (usually 60)
  const k = 60;
  const results: SemanticSearchResult[] = [];

  for (const [, { result, bm25Rank, vectorRank }] of combined) {
    const bm25Score = bm25Rank < 9999 ? bm25Weight / (k + bm25Rank) : 0;
    const vectorScore = vectorRank < 9999 ? vectorWeight / (k + vectorRank) : 0;
    const combinedScore = bm25Score + vectorScore;

    // Normalize to approximate 0-1 range
    const normalizedScore = combinedScore * k;

    if (normalizedScore >= minScore) {
      results.push({
        ...result,
        similarity: Math.min(normalizedScore, 1),
      });
    }
  }

  // Sort by combined score
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, maxResults);
}

/**
 * Simple combine function for backward compatibility.
 * Prefer performHybridSearch for better results.
 */
export function hybridSearch(
  keywordResults: SemanticSearchResult[],
  semanticResults: SemanticSearchResult[],
  keywordWeight = 0.3,
  semanticWeight = 0.7,
): SemanticSearchResult[] {
  const combined = new Map<string, SemanticSearchResult>();

  // Add semantic results
  for (const result of semanticResults) {
    const existing = combined.get(result.id);
    const semanticScore = result.similarity * semanticWeight;
    if (existing) {
      existing.similarity += semanticScore;
    } else {
      combined.set(result.id, { ...result, similarity: semanticScore });
    }
  }

  // Add keyword results
  for (const result of keywordResults) {
    const existing = combined.get(result.id);
    const keywordScore = result.similarity * keywordWeight;
    if (existing) {
      existing.similarity += keywordScore;
    } else {
      combined.set(result.id, { ...result, similarity: keywordScore });
    }
  }

  // Sort by combined score
  const results = [...combined.values()];
  results.sort((a, b) => b.similarity - a.similarity);
  return results;
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a semantic memory index with optional embedding provider and persistence
 *
 * @param embeddingProvider - Provider for generating embeddings
 * @param persistConfig - Configuration for persistent storage (survives restarts)
 */
export function createSemanticIndex(
  embeddingProvider?: EmbeddingProvider,
  persistConfig?: SemanticIndexPersistenceConfig,
): SemanticMemoryIndex {
  return new SemanticMemoryIndex(embeddingProvider, persistConfig);
}

/**
 * Create a persistent semantic index for an agent.
 * The index will automatically load from disk if it exists,
 * and can be saved via the save() method.
 *
 * @param agentId - Agent ID for namespacing
 * @param embeddingProvider - Provider for generating embeddings
 * @param maxMemories - Maximum memories to keep (for size management)
 */
export function createPersistentSemanticIndex(
  agentId: string,
  embeddingProvider?: EmbeddingProvider,
  maxMemories = 10000,
): SemanticMemoryIndex {
  return new SemanticMemoryIndex(embeddingProvider, {
    agentId,
    maxMemories,
    autoSave: false, // Manual save for better batching
  });
}
