/**
 * SHEEP AI - Moltbot Integration Bridge
 *
 * Connects SHEEP to Moltbot's actual systems.
 * Uses Moltbot's real LLM and embedding providers.
 *
 * @module sheep/integration/moltbot-bridge
 */

import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { LLMProvider, SheepModelConfig } from "../extraction/llm-extractor.js";
import type { Episode, Fact, CausalLink } from "../memory/schema.js";
import { retryAsync } from "../../infra/retry.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "../../memory/embeddings.js";
import {
  extractFactsWithLLM,
  extractCausalLinksWithLLM,
  summarizeEpisodeWithLLM,
  createSheepLLMProvider,
  createMockLLMProvider,
  DEFAULT_SHEEP_MODELS,
} from "../extraction/llm-extractor.js";
import { SheepDatabase } from "../memory/database.js";
import { generateId, now } from "../memory/schema.js";
import { SemanticMemoryIndex, BM25Index, performHybridSearch } from "../memory/semantic-search.js";
import {
  recordPrefetch,
  recordLearning,
  type PrefetchTimingBreakdown,
} from "../metrics/metrics.js";
import { analyzePrefetchNeeds, shouldPrefetch } from "../prefetch/prefetch-engine.js";

// Simple console logger
const log = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(`[sheep] ${msg}`, data ? JSON.stringify(data) : ""),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(`[sheep] ${msg}`, data ? JSON.stringify(data) : ""),
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(`[sheep] ${msg}`, data ? JSON.stringify(data) : ""),
};

// =============================================================================
// TYPES
// =============================================================================

/**
 * SHEEP integration configuration
 */
export type SheepIntegrationConfig = {
  /** Agent ID for this SHEEP instance */
  agentId: string;
  /** Moltbot config */
  config: OpenClawConfig;
  /** Model to use for extraction (legacy, use modelConfig instead) */
  extractionModel?: string;
  /** Enable semantic search */
  enableSemanticSearch?: boolean;
  /** Enable LLM sleep */
  enableLLMSleep?: boolean;
  /** Model configuration for different SHEEP tasks */
  modelConfig?: Partial<SheepModelConfig>;
};

/**
 * Result from prefetching memories
 */
export type PrefetchedMemories = {
  facts: Fact[];
  episodes: Episode[];
  causalLinks: CausalLink[];
  skipped: boolean;
  skipReason?: string;
  durationMs: number;
};

/**
 * Formatted context for prompts
 */
export type MemoryContext = {
  systemPromptAddition: string;
  memoryCount: number;
  memoryTypes: string[];
};

// =============================================================================
// SHEEP INTEGRATION CLASS
// =============================================================================

/**
 * Main SHEEP integration class - uses real Moltbot providers
 */
export class SheepIntegration {
  private config: SheepIntegrationConfig;
  private db: SheepDatabase;
  private semanticIndex: SemanticMemoryIndex;
  /** BM25 keyword index for hybrid search */
  private bm25Index: BM25Index;
  /** LLM provider for extraction tasks (uses Sonnet for quality) */
  private extractionLLM: LLMProvider | null = null;
  /** LLM provider for fast operations like prefetch (uses Haiku for speed) */
  private fastLLM: LLMProvider | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  /** Model configuration */
  private modelConfig: SheepModelConfig;

  constructor(config: SheepIntegrationConfig) {
    this.config = config;
    this.db = new SheepDatabase(config.agentId);
    this.semanticIndex = new SemanticMemoryIndex();
    this.bm25Index = new BM25Index();
    // Merge user config with defaults
    this.modelConfig = {
      ...DEFAULT_SHEEP_MODELS,
      ...config.modelConfig,
    };
    // Support legacy extractionModel parameter
    if (config.extractionModel) {
      this.modelConfig.extractionModel = config.extractionModel;
    }
  }

  /**
   * Initialize the integration with real providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Prevent concurrent initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    log.info("Initializing SHEEP integration", {
      agentId: this.config.agentId,
      models: {
        extraction: this.modelConfig.extractionModel,
        fast: this.modelConfig.fastModel,
      },
    });

    // Initialize extraction LLM provider (Sonnet for quality)
    try {
      this.extractionLLM = await createSheepLLMProvider("extraction", this.modelConfig);
      log.info("SHEEP extraction LLM ready", { provider: this.extractionLLM.name });
    } catch (err) {
      log.warn("Failed to initialize SHEEP extraction LLM, using mock", { error: String(err) });
      this.extractionLLM = createMockLLMProvider();
    }

    // Initialize fast LLM provider (Haiku for speed-critical operations)
    try {
      this.fastLLM = await createSheepLLMProvider("fast", this.modelConfig);
      log.info("SHEEP fast LLM ready", { provider: this.fastLLM.name });
    } catch (err) {
      log.warn("Failed to initialize SHEEP fast LLM, using mock", { error: String(err) });
      this.fastLLM = createMockLLMProvider();
    }

    // Initialize embedding provider (for semantic search)
    if (this.config.enableSemanticSearch !== false) {
      try {
        const result = await createEmbeddingProvider({
          config: this.config.config,
          provider: "auto",
          model: "text-embedding-3-small",
          fallback: "gemini",
        });
        this.embeddingProvider = result.provider;
        this.semanticIndex.setEmbeddingProvider(this.embeddingProvider);
        log.info("SHEEP embedding provider ready", {
          provider: result.provider.id,
          model: result.provider.model,
        });
      } catch (err) {
        log.warn(
          "Failed to initialize embedding provider, semantic search will use random embeddings",
          { error: String(err) },
        );
      }
    }

    // Load existing memories into index
    await this.loadMemoriesIntoIndex();

    this.initialized = true;
    this.initPromise = null;
    log.info("SHEEP integration ready");
  }

  /**
   * Load existing memories from DB into semantic and BM25 indexes
   */
  private async loadMemoriesIntoIndex(): Promise<void> {
    const episodes = this.db.queryEpisodes({});
    const facts = this.db.findFacts({ activeOnly: true });
    const causalLinks = this.db.findCausalLinks({});

    log.info("Loading memories into search indexes", {
      episodes: episodes.length,
      facts: facts.length,
      causalLinks: causalLinks.length,
    });

    // Batch add to semantic index (vector search)
    const items: Array<
      | { type: "episode"; item: Episode }
      | { type: "fact"; item: Fact }
      | { type: "causal_link"; item: CausalLink }
    > = [
      ...episodes.map((ep) => ({ type: "episode" as const, item: ep })),
      ...facts.map((f) => ({ type: "fact" as const, item: f })),
      ...causalLinks.map((cl) => ({ type: "causal_link" as const, item: cl })),
    ];

    if (items.length > 0) {
      await this.semanticIndex.addBatch(items);
    }

    // Also populate BM25 index for hybrid search
    for (const ep of episodes) {
      this.bm25Index.addEpisode(ep);
    }
    for (const f of facts) {
      this.bm25Index.addFact(f);
    }
    for (const cl of causalLinks) {
      this.bm25Index.addCausalLink(cl);
    }
  }

  /**
   * Prefetch relevant memories for a user message
   */
  async prefetchMemories(userMessage: string): Promise<PrefetchedMemories> {
    const totalStart = Date.now();
    const timing: Partial<PrefetchTimingBreakdown> = {};

    if (!shouldPrefetch(userMessage)) {
      const durationMs = Date.now() - totalStart;
      // Record skipped prefetch
      recordPrefetch({
        timestamp: Date.now(),
        agentId: this.config.agentId,
        hadMemories: false,
        factsCount: 0,
        episodesCount: 0,
        durationMs,
        intentType: "skipped",
        timing: {
          totalMs: durationMs,
          intentClassificationMs: 0,
          entityExtractionMs: 0,
          dbQueryMs: 0,
          metLatencyTarget: durationMs < 100,
        },
      });

      return {
        facts: [],
        episodes: [],
        causalLinks: [],
        skipped: true,
        skipReason: "Message type does not need memory",
        durationMs,
      };
    }

    await this.initialize();

    // Time intent classification and entity extraction
    const intentStart = Date.now();
    const prediction = analyzePrefetchNeeds(userMessage);
    timing.intentClassificationMs = Date.now() - intentStart;
    // Entity extraction is included in analyzePrefetchNeeds
    timing.entityExtractionMs = 0;

    // Time database queries
    const dbStart = Date.now();
    let facts: Fact[] = [];
    let episodes: Episode[] = [];
    const causalLinks: CausalLink[] = [];

    // Get facts for mentioned entities
    for (const entity of prediction.intent.entities) {
      facts.push(...this.db.findFacts({ subject: entity }));
      facts.push(...this.db.findFacts({ object: entity }));
    }

    // Get recent episodes
    episodes = this.db.queryEpisodes({ limit: 5 });
    timing.dbQueryMs = Date.now() - dbStart;

    // Deduplicate
    facts = [...new Map(facts.map((f) => [f.id, f])).values()];
    episodes = [...new Map(episodes.map((e) => [e.id, e])).values()];

    timing.totalMs = Date.now() - totalStart;
    timing.metLatencyTarget = timing.totalMs < 100;

    // Record prefetch metrics with timing
    recordPrefetch({
      timestamp: Date.now(),
      agentId: this.config.agentId,
      hadMemories: facts.length > 0 || episodes.length > 0,
      factsCount: facts.length,
      episodesCount: episodes.length,
      durationMs: timing.totalMs,
      intentType: prediction.intent.intentType,
      entities: prediction.intent.entities,
      timing: timing as PrefetchTimingBreakdown,
    });

    return {
      facts,
      episodes,
      causalLinks,
      skipped: false,
      durationMs: timing.totalMs,
    };
  }

  /**
   * Format prefetched memories for injection into a prompt
   */
  formatMemoryContext(memories: PrefetchedMemories): MemoryContext {
    if (memories.skipped || (memories.facts.length === 0 && memories.episodes.length === 0)) {
      return {
        systemPromptAddition: "",
        memoryCount: 0,
        memoryTypes: [],
      };
    }

    const lines: string[] = ["## Relevant Memories"];
    const types: string[] = [];

    if (memories.facts.length > 0) {
      types.push("facts");
      lines.push("\n### Known Facts:");
      for (const fact of memories.facts.slice(0, 10)) {
        lines.push(`- ${fact.subject} ${fact.predicate.replace(/_/g, " ")} ${fact.object}`);
      }
    }

    if (memories.episodes.length > 0) {
      types.push("episodes");
      lines.push("\n### Recent Conversations:");
      for (const ep of memories.episodes.slice(0, 5)) {
        lines.push(`- ${ep.summary} (${ep.topic})`);
      }
    }

    return {
      systemPromptAddition: lines.join("\n"),
      memoryCount: memories.facts.length + memories.episodes.length,
      memoryTypes: types,
    };
  }

  /**
   * Search memories using hybrid search (BM25 + vector similarity).
   *
   * Combines keyword matching (BM25) with semantic embeddings for robust retrieval.
   * This addresses masterplan TODO 0.1.3: "vector + structured query" and
   * TODO 0.7.4: hybrid search integration.
   *
   * Hybrid search weighting: α = 0.5 (equal BM25 + vector weight)
   */
  async searchMemories(
    query: string,
    options: {
      types?: Array<"episode" | "fact" | "causal_link">;
      limit?: number;
      minSimilarity?: number;
      /** Use hybrid search combining BM25 + vector (default: true when embeddings available) */
      useHybrid?: boolean;
      /** BM25/keyword weight (0-1, default: 0.5) - α parameter */
      alpha?: number;
    } = {},
  ): Promise<{
    facts: Fact[];
    episodes: Episode[];
    causalLinks: CausalLink[];
  }> {
    await this.initialize();

    const { types, limit = 10, minSimilarity = 0.3, useHybrid = true, alpha = 0.5 } = options;

    // Check if semantic search is available
    if (!this.embeddingProvider) {
      log.warn("Semantic search unavailable, falling back to keyword search");
      return this.keywordFallbackSearch(query, types, limit);
    }

    let searchResults;

    if (useHybrid) {
      // Use hybrid search combining BM25 keyword matching and vector similarity
      // α parameter controls the balance: α=BM25 weight, (1-α)=vector weight
      searchResults = await performHybridSearch(query, this.bm25Index, this.semanticIndex, {
        bm25Weight: alpha,
        vectorWeight: 1 - alpha,
        minScore: minSimilarity,
        maxResults: limit * 2, // Get more to allow for deduplication
        types,
      });

      log.info("Hybrid search completed", {
        query: query.slice(0, 50),
        resultsCount: searchResults.length,
        alpha,
      });
    } else {
      // Fall back to pure semantic search
      searchResults = await this.semanticIndex.search(query, {
        maxResults: limit,
        minSimilarity,
        types,
      });

      log.info("Semantic search completed", {
        query: query.slice(0, 50),
        resultsCount: searchResults.length,
      });
    }

    // Group results by type and fetch full records
    const facts: Fact[] = [];
    const episodes: Episode[] = [];
    const causalLinks: CausalLink[] = [];
    const seenFactIds = new Set<string>();

    for (const result of searchResults) {
      if (result.type === "fact") {
        const fact = this.db.getFact(result.id);
        if (fact) {
          facts.push(fact);
          seenFactIds.add(fact.id);
        }
      } else if (result.type === "episode") {
        const episode = this.db.getEpisode(result.id);
        if (episode) episodes.push(episode);
      } else if (result.type === "causal_link") {
        // Causal links are already in search results metadata
        const links = this.db.findCausalLinks({});
        const link = links.find((l) => l.id === result.id);
        if (link) causalLinks.push(link);
      }
    }

    // Also do direct DB keyword search to catch newly added facts
    // that might not be properly indexed yet (ensures sheep_remember
    // facts are immediately findable by sheep_recall).
    const shouldSearchFacts = !types || types.includes("fact");

    if (shouldSearchFacts) {
      const queryLower = query.toLowerCase().trim();
      const allFacts = this.db.findFacts({ activeOnly: true });
      const exactMatches: Fact[] = [];

      // Find exact/substring matches from DB that weren't in search results
      for (const f of allFacts) {
        if (seenFactIds.has(f.id)) continue; // Already in results

        const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();

        // Simple substring match - if query appears anywhere in fact text
        if (text.includes(queryLower)) {
          exactMatches.push(f);
          seenFactIds.add(f.id);
          continue;
        }

        // Also check if any significant query term appears
        const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);
        for (const term of queryTerms) {
          if (text.includes(term)) {
            exactMatches.push(f);
            seenFactIds.add(f.id);
            break;
          }
        }
      }

      // Append keyword matches after hybrid search results
      // (hybrid results are already ranked by relevance)
      if (exactMatches.length > 0) {
        log.info("DB keyword search found additional matches", {
          count: exactMatches.length,
          query: queryLower,
        });
        facts.push(...exactMatches);
      }
    }

    // Enforce limit after merging
    const limitedFacts = facts.slice(0, limit);

    return { facts: limitedFacts, episodes, causalLinks };
  }

  /**
   * Search causal links by effect description using semantic similarity.
   * Used by sheep_why tool for "why did X happen?" queries.
   *
   * @param effectQuery - The effect to find causes for
   * @param limit - Maximum number of matching links to return
   * @returns Causal links sorted by relevance to the query
   */
  async searchCausalLinksByEffect(effectQuery: string, limit: number = 10): Promise<CausalLink[]> {
    await this.initialize();

    // Get all causal links from DB
    const allLinks = this.db.findCausalLinks({});

    if (allLinks.length === 0) {
      return [];
    }

    // If embeddings available, use semantic search
    if (this.embeddingProvider) {
      const searchResults = await this.semanticIndex.search(effectQuery, {
        maxResults: limit * 2, // Get more to filter
        minSimilarity: 0.15, // Lower threshold for better recall
        types: ["causal_link"],
      });

      // Map results back to full causal link objects
      const resultIds = new Set(searchResults.map((r) => r.id));
      return allLinks.filter((link) => resultIds.has(link.id)).slice(0, limit);
    }

    // Fallback: use enhanced text similarity (not just Jaccard)
    const queryLower = effectQuery
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .trim();
    const queryWords = new Set(queryLower.split(/\s+/).filter((w) => w.length > 2));

    const scored = allLinks.map((link) => {
      const effectLower = link.effectDescription
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .trim();
      const causeLower = link.causeDescription
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .trim();

      // Check for substring containment (strong match)
      if (effectLower.includes(queryLower) || queryLower.includes(effectLower)) {
        return { link, similarity: 0.9 };
      }
      // Also check cause (user might be asking about what caused X)
      if (causeLower.includes(queryLower) || queryLower.includes(causeLower)) {
        return { link, similarity: 0.85 };
      }

      // Word overlap with effect
      const effectWords = new Set(effectLower.split(/\s+/).filter((w) => w.length > 2));
      const intersection = [...queryWords].filter((w) => effectWords.has(w)).length;

      // Also check partial word matches (e.g., "switched" matches "switch")
      let partialMatches = 0;
      for (const qw of queryWords) {
        for (const ew of effectWords) {
          if (qw.includes(ew) || ew.includes(qw)) {
            partialMatches++;
            break;
          }
        }
      }

      // Calculate combined score
      const jaccardScore = queryWords.size > 0 ? intersection / queryWords.size : 0;
      const partialScore = queryWords.size > 0 ? partialMatches / queryWords.size : 0;
      const similarity = Math.max(jaccardScore, partialScore * 0.8);

      return { link, similarity };
    });

    // Sort by similarity and return top results with lower threshold
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored
      .filter((s) => s.similarity > 0.05)
      .slice(0, limit)
      .map((s) => s.link);
  }

  /**
   * Get a semantic similarity function for use with causal chain building.
   * Returns a function that compares two text strings using embeddings when available.
   */
  async getSemanticSimilarityFn(): Promise<((text1: string, text2: string) => number) | undefined> {
    await this.initialize();

    if (!this.embeddingProvider) {
      return undefined; // Will fall back to text similarity in buildCausalChain
    }

    // Cache embeddings for efficiency
    const embeddingCache = new Map<string, number[]>();

    const getEmbedding = async (text: string): Promise<number[]> => {
      const cached = embeddingCache.get(text);
      if (cached) return cached;

      const embedding = await this.embeddingProvider!.embedQuery(text);
      embeddingCache.set(text, embedding);
      return embedding;
    };

    // Return a synchronous similarity function that uses pre-computed embeddings
    // Note: This is a workaround since buildCausalChain expects sync function
    // For now, return undefined and let buildCausalChain use its default similarity
    return undefined;
  }

  /**
   * Fallback keyword search when embeddings unavailable
   */
  private keywordFallbackSearch(
    query: string,
    types: Array<"episode" | "fact" | "causal_link"> | undefined,
    limit: number,
  ): { facts: Fact[]; episodes: Episode[]; causalLinks: CausalLink[] } {
    const queryLower = query.toLowerCase();
    const facts: Fact[] = [];
    const episodes: Episode[] = [];

    if (!types || types.includes("fact")) {
      const allFacts = this.db.findFacts({ activeOnly: true });
      facts.push(
        ...allFacts
          .filter((f) => {
            const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
            return text.includes(queryLower);
          })
          .slice(0, limit),
      );
    }

    if (!types || types.includes("episode")) {
      const allEpisodes = this.db.queryEpisodes({ limit: 100 });
      episodes.push(
        ...allEpisodes
          .filter((e) => {
            const text = `${e.summary} ${e.topic} ${e.keywords.join(" ")}`.toLowerCase();
            return text.includes(queryLower);
          })
          .slice(0, limit),
      );
    }

    return { facts, episodes, causalLinks: [] };
  }

  /**
   * Get the extraction LLM provider (Sonnet - quality over speed)
   * Used for fact extraction, causal link extraction, and episode summarization.
   */
  private async getExtractionLLM(): Promise<LLMProvider> {
    await this.initialize();
    return this.extractionLLM!;
  }

  /**
   * Get the fast LLM provider (Haiku - speed over quality)
   * Used for latency-critical operations like intent classification.
   */
  private async getFastLLM(): Promise<LLMProvider> {
    await this.initialize();
    return this.fastLLM!;
  }

  /**
   * Get the model configuration
   */
  getModelConfig(): SheepModelConfig {
    return { ...this.modelConfig };
  }

  /**
   * Store a fact explicitly (from sheep_remember tool).
   * This ensures the fact is added to both the database AND the search indexes.
   */
  async storeFact(factData: {
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
    userAffirmed?: boolean;
  }): Promise<{ id: string; success: boolean }> {
    await this.initialize();

    const timestamp = now();

    // Insert into database
    const fact = this.db.insertFact({
      subject: factData.subject,
      predicate: factData.predicate.toLowerCase().replace(/\s+/g, "_"),
      object: factData.object,
      confidence: Math.max(0, Math.min(1, factData.confidence)),
      evidence: [],
      firstSeen: timestamp,
      lastConfirmed: timestamp,
      userAffirmed: factData.userAffirmed ?? true,
    });

    log.info("Fact inserted into DB", { factId: fact.id, subject: fact.subject });

    // Add to BM25 index for keyword search
    const bm25DocsBefore = this.bm25Index.documentCount;
    this.bm25Index.addFact(fact);
    const bm25DocsAfter = this.bm25Index.documentCount;
    log.info("Fact added to BM25 index", {
      factId: fact.id,
      bm25DocsBefore,
      bm25DocsAfter,
      added: bm25DocsAfter > bm25DocsBefore,
    });

    // Add to semantic index if available
    if (this.embeddingProvider) {
      try {
        await this.semanticIndex.addFact(fact);
        log.info("Fact added to semantic index", { factId: fact.id });
      } catch (err) {
        // Log but don't fail - keyword search will still work
        log.warn("Failed to add fact to semantic index", { factId: fact.id, error: err });
      }
    }

    log.info("Stored fact via sheep_remember", {
      factId: fact.id,
      subject: fact.subject,
      predicate: fact.predicate,
    });

    return { id: fact.id, success: true };
  }

  /**
   * Process a conversation and extract memories using real LLM.
   * Uses Sonnet (extraction model) for quality extraction.
   * Includes retry logic with exponential backoff for rate limit errors.
   */
  async learnFromConversation(
    conversationText: string,
    sessionId: string,
  ): Promise<{
    factsLearned: number;
    episodesCreated: number;
    causalLinksFound: number;
  }> {
    const startTime = Date.now();
    // Use extraction LLM (Sonnet) for quality fact/causal extraction
    const llm = await this.getExtractionLLM();

    // Helper to check if error is a rate limit error
    const isRateLimitError = (err: unknown): boolean => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        message.includes("429") ||
        message.includes("rate_limit") ||
        message.includes("rate limit") ||
        message.includes("would exceed your account's rate limit")
      );
    };

    // Helper to extract retry-after delay from error message
    const getRetryAfterMs = (err: unknown): number | undefined => {
      const message = err instanceof Error ? err.message : String(err);
      // Look for "retry after X seconds" or similar patterns
      const retryMatch = message.match(/retry.*?(\d+)\s*(?:second|minute|hour)/i);
      if (retryMatch) {
        const value = Number.parseInt(retryMatch[1], 10);
        const unit = message.toLowerCase().includes("minute")
          ? 60_000
          : message.toLowerCase().includes("hour")
            ? 3_600_000
            : 1_000;
        return value * unit;
      }
      return undefined;
    };

    try {
      // Create episode using LLM summarization with retry logic
      const summary = await retryAsync(() => summarizeEpisodeWithLLM(llm, conversationText), {
        attempts: 3,
        minDelayMs: 2000, // Start with 2 seconds
        maxDelayMs: 60_000, // Cap at 60 seconds
        jitter: 0.1,
        shouldRetry: isRateLimitError,
        retryAfterMs: getRetryAfterMs,
        onRetry: (info) => {
          log.warn("SHEEP learning retry (rate limit)", {
            attempt: info.attempt,
            delayMs: info.delayMs,
            label: "episode summary",
          });
        },
      }).catch(() => null); // Fallback to null if all retries fail

      const episodeId = generateId("ep");
      const timestamp = now();

      const episode: Episode = {
        id: episodeId,
        timestamp,
        summary: summary?.summary || "Conversation",
        participants: ["user", "assistant"],
        topic: summary?.topic || "general",
        keywords: summary?.keywords || [],
        emotionalSalience: summary?.salience || 0.5,
        utilityScore: 0.5,
        sourceSessionId: sessionId,
        sourceMessageIds: [],
        ttl: "30d",
        accessCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      this.db.insertEpisode(episode);

      // Extract facts using real LLM with retry logic
      const extractedFacts = await retryAsync(
        () => extractFactsWithLLM(llm, conversationText, episodeId),
        {
          attempts: 3,
          minDelayMs: 2000,
          maxDelayMs: 60_000,
          jitter: 0.1,
          shouldRetry: isRateLimitError,
          retryAfterMs: getRetryAfterMs,
          onRetry: (info) => {
            log.warn("SHEEP learning retry (rate limit)", {
              attempt: info.attempt,
              delayMs: info.delayMs,
              label: "fact extraction",
            });
          },
        },
      ).catch(() => []); // Fallback to empty array if all retries fail

      for (const fact of extractedFacts) {
        this.db.insertFact(fact);
      }

      // Extract causal links using real LLM with retry logic
      const extractedLinks = await retryAsync(
        () => extractCausalLinksWithLLM(llm, conversationText, episodeId),
        {
          attempts: 3,
          minDelayMs: 2000,
          maxDelayMs: 60_000,
          jitter: 0.1,
          shouldRetry: isRateLimitError,
          retryAfterMs: getRetryAfterMs,
          onRetry: (info) => {
            log.warn("SHEEP learning retry (rate limit)", {
              attempt: info.attempt,
              delayMs: info.delayMs,
              label: "causal link extraction",
            });
          },
        },
      ).catch(() => []); // Fallback to empty array if all retries fail

      for (const link of extractedLinks) {
        this.db.insertCausalLink(link);
      }

      // Add to semantic index
      await this.semanticIndex.addEpisode(episode);

      const durationMs = Date.now() - startTime;

      // Record learning metrics
      recordLearning({
        timestamp: Date.now(),
        agentId: this.config.agentId,
        factsLearned: extractedFacts.length,
        episodesCreated: 1,
        causalLinksFound: extractedLinks.length,
        proceduresExtracted: 0, // Procedures extracted during consolidation, not here
        durationMs,
      });

      log.info("Learned from conversation", {
        facts: extractedFacts.length,
        episodes: 1,
        causalLinks: extractedLinks.length,
        durationMs,
      });

      return {
        factsLearned: extractedFacts.length,
        episodesCreated: 1,
        causalLinksFound: extractedLinks.length,
      };
    } catch (err) {
      // If we hit rate limits after all retries, log and return empty results
      if (isRateLimitError(err)) {
        log.error("SHEEP learning failed due to rate limit after retries", {
          agentId: this.config.agentId,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          factsLearned: 0,
          episodesCreated: 0,
          causalLinksFound: 0,
        };
      }
      throw err;
    }
  }

  /**
   * Get stats about the SHEEP memory
   */
  getStats() {
    return this.db.getStats();
  }

  /**
   * Close the integration
   */
  close(): void {
    this.db.close();
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a SHEEP integration instance
 */
export function createSheepIntegration(config: SheepIntegrationConfig): SheepIntegration {
  return new SheepIntegration(config);
}

// Cache of integrations per agent
const integrationCache = new Map<string, SheepIntegration>();

/**
 * Clear the integration cache (useful when config changes)
 */
export function clearSheepIntegrationCache(agentId?: string): void {
  if (agentId) {
    integrationCache.delete(agentId);
  } else {
    integrationCache.clear();
  }
}

/**
 * Get or create SHEEP integration for an agent
 */
export function getSheepIntegration(agentId: string, config: OpenClawConfig): SheepIntegration {
  let integration = integrationCache.get(agentId);

  if (!integration) {
    integration = createSheepIntegration({
      agentId,
      config,
      enableSemanticSearch: true,
      enableLLMSleep: false,
    });
    integrationCache.set(agentId, integration);
  }

  return integration;
}

/**
 * Prefetch memories for a message (convenience function)
 * Returns empty context if SHEEP is disabled.
 */
export async function prefetchMemoriesForMessage(
  agentId: string,
  config: OpenClawConfig,
  userMessage: string,
): Promise<MemoryContext> {
  // Check if SHEEP is enabled
  if (!config.sheep?.enabled) {
    return {
      systemPromptAddition: "",
      memoryCount: 0,
      memoryTypes: [],
    };
  }

  const integration = getSheepIntegration(agentId, config);
  const memories = await integration.prefetchMemories(userMessage);
  return integration.formatMemoryContext(memories);
}

// =============================================================================
// POST-CONVERSATION LEARNING
// =============================================================================

/**
 * Track last activity timestamp per agent for idle detection
 */
const lastActivityTimestamps = new Map<string, number>();

/**
 * Minimum time between learning runs to avoid excessive processing (5 minutes)
 */
// Increased to 15 minutes to avoid hitting API rate limits
// Each learning call makes 3 LLM requests (summary + facts + causal links)
const MIN_LEARNING_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Last learning run timestamp per agent
 */
const lastLearningTimestamps = new Map<string, number>();

/**
 * Learn from a completed agent turn (fire-and-forget).
 * This is called after each agent turn to extract facts and patterns.
 * Skips learning if SHEEP is disabled.
 *
 * @param agentId - The agent ID
 * @param config - Moltbot config
 * @param sessionId - The session ID
 * @param messages - The conversation messages from this turn
 */
export async function learnFromAgentTurn(
  agentId: string,
  config: OpenClawConfig,
  sessionId: string,
  messages: unknown[],
): Promise<void> {
  // Check if SHEEP is enabled
  if (!config.sheep?.enabled) {
    return;
  }

  // Update activity timestamp
  lastActivityTimestamps.set(agentId, Date.now());

  // Rate limit learning to avoid excessive processing
  const lastLearning = lastLearningTimestamps.get(agentId) ?? 0;
  if (Date.now() - lastLearning < MIN_LEARNING_INTERVAL_MS) {
    log.info("SHEEP learning skipped (rate limited)", { agentId });
    return;
  }

  // Only learn if we have meaningful content
  if (!messages || messages.length < 2) {
    return;
  }

  try {
    lastLearningTimestamps.set(agentId, Date.now());
    const integration = getSheepIntegration(agentId, config);

    // Convert messages to text for learning
    const conversationText = formatMessagesForLearning(messages);
    if (!conversationText || conversationText.length < 50) {
      return; // Not enough content to learn from
    }

    // Fire-and-forget learning with better error handling
    integration
      .learnFromConversation(conversationText, sessionId)
      .then((result) => {
        if (result.factsLearned > 0 || result.causalLinksFound > 0) {
          log.info("SHEEP learned from conversation", {
            agentId,
            sessionId,
            ...result,
          });
        }
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // Don't spam logs for rate limit errors - they're expected and handled with retries
        if (
          errorMsg.includes("429") ||
          errorMsg.includes("rate_limit") ||
          errorMsg.includes("rate limit")
        ) {
          log.info("SHEEP learning skipped due to rate limit", { agentId });
        } else {
          log.warn("SHEEP learning failed", { agentId, error: errorMsg });
        }
      });
  } catch (err) {
    log.warn("SHEEP learning setup failed", { agentId, error: String(err) });
  }
}

/**
 * Format agent messages into text for learning
 */
function formatMessagesForLearning(messages: unknown[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as { role?: string; content?: unknown };

    if (m.role === "user" && typeof m.content === "string") {
      lines.push(`User: ${m.content}`);
    } else if (m.role === "assistant") {
      // Handle different content formats
      if (typeof m.content === "string") {
        lines.push(`Assistant: ${m.content}`);
      } else if (Array.isArray(m.content)) {
        // Extract text content from content blocks
        for (const block of m.content) {
          if (block && typeof block === "object" && "type" in block) {
            const b = block as { type: string; text?: string };
            if (b.type === "text" && typeof b.text === "string") {
              lines.push(`Assistant: ${b.text}`);
            }
          }
        }
      }
    }
  }

  return lines.join("\n\n");
}

/**
 * Check if an agent has been idle long enough to trigger consolidation
 * Returns true if idle for more than the threshold (default 2 hours)
 */
export function isAgentIdle(
  agentId: string,
  idleThresholdMs: number = 2 * 60 * 60 * 1000,
): boolean {
  const lastActivity = lastActivityTimestamps.get(agentId);
  if (!lastActivity) return true; // No activity recorded means idle
  return Date.now() - lastActivity > idleThresholdMs;
}

/**
 * Get all agents that are currently idle
 */
export function getIdleAgents(idleThresholdMs?: number): string[] {
  const idle: string[] = [];
  for (const agentId of integrationCache.keys()) {
    if (isAgentIdle(agentId, idleThresholdMs)) {
      idle.push(agentId);
    }
  }
  return idle;
}

/**
 * Update activity timestamp for an agent (call on any interaction)
 */
export function touchAgentActivity(agentId: string): void {
  lastActivityTimestamps.set(agentId, Date.now());
}
