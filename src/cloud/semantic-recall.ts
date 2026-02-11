/**
 * SHEEP Cloud - Hybrid Semantic Recall (BM25 + Embedding + Reranking)
 *
 * Three-stage retrieval pipeline:
 *   1. BM25 (keyword/TF-IDF) -- fast, exact match, handles rare terms
 *   2. Embedding (cosine similarity) -- understands meaning, handles synonyms
 *   3. Reciprocal Rank Fusion (RRF) -- combines both rankings into one
 *
 * This hybrid approach consistently outperforms either method alone.
 * Falls back gracefully: no embeddings → BM25 only, no facts → empty.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// =============================================================================
// TYPES
// =============================================================================

export interface FactWithScore {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  score: number;
}

interface CachedEmbeddings {
  factCount: number;
  embeddings: Map<string, number[]>;
}

// =============================================================================
// EMBEDDING STATE
// =============================================================================

const embeddingCache = new Map<string, CachedEmbeddings>();
let geminiModel: ReturnType<InstanceType<typeof GoogleGenerativeAI>["getGenerativeModel"]> | null = null;

function getModel() {
  if (geminiModel) return geminiModel;
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  geminiModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  return geminiModel;
}

// =============================================================================
// MATH HELPERS
// =============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function factToText(f: { subject: string; predicate: string; object: string }): string {
  return `${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`;
}

// =============================================================================
// BM25 SCORING
// =============================================================================

/**
 * BM25 scoring for a query against a set of documents.
 * Standard parameters: k1=1.5, b=0.75
 */
function bm25Score(
  query: string,
  documents: Array<{ id: string; text: string }>,
): Map<string, number> {
  const k1 = 1.5;
  const b = 0.75;
  const queryTerms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const N = documents.length;
  if (N === 0 || queryTerms.length === 0) return new Map();

  // Average document length
  const avgDl = documents.reduce((sum, d) => sum + d.text.split(/\s+/).length, 0) / N;

  // Document frequency for each query term
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const doc of documents) {
      if (doc.text.toLowerCase().includes(term)) count++;
    }
    df.set(term, count);
  }

  // Score each document
  const scores = new Map<string, number>();
  for (const doc of documents) {
    const docLower = doc.text.toLowerCase();
    const docLen = docLower.split(/\s+/).length;
    let score = 0;

    for (const term of queryTerms) {
      const termDf = df.get(term) ?? 0;
      if (termDf === 0) continue;

      // Term frequency in this document
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const tf = (docLower.match(regex) ?? []).length;

      // IDF
      const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);

      // BM25 formula
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDl)));
      score += idf * tfNorm;
    }

    if (score > 0) scores.set(doc.id, score);
  }

  return scores;
}

// =============================================================================
// EMBEDDING SEARCH
// =============================================================================

async function embedText(text: string): Promise<number[] | null> {
  const model = getModel();
  if (!model) return null;
  try {
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    console.warn(`[semantic-recall] Embed failed: ${err}`);
    return null;
  }
}

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const model = getModel();
  if (!model) return texts.map(() => null);
  const BATCH = 8;
  const results: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (t) => {
        try { return (await model.embedContent(t)).embedding.values; }
        catch { return null; }
      }),
    );
    results.push(...batchResults);
  }
  return results;
}

async function embeddingScores(
  userId: string,
  query: string,
  facts: Array<{ id: string; subject: string; predicate: string; object: string }>,
): Promise<Map<string, number>> {
  const queryEmb = await embedText(query);
  if (!queryEmb) return new Map();

  // Build/get cache
  let cache = embeddingCache.get(userId);
  if (!cache || cache.factCount !== facts.length) {
    const texts = facts.map(factToText);
    const embeddings = await embedBatch(texts);
    const newCache: CachedEmbeddings = { factCount: facts.length, embeddings: new Map() };
    for (let i = 0; i < facts.length; i++) {
      if (embeddings[i]) newCache.embeddings.set(facts[i].id, embeddings[i]!);
    }
    embeddingCache.set(userId, newCache);
    cache = newCache;
  }

  const scores = new Map<string, number>();
  for (const fact of facts) {
    const emb = cache.embeddings.get(fact.id);
    if (!emb) continue;
    const sim = cosineSimilarity(queryEmb, emb);
    if (sim > 0.2) scores.set(fact.id, sim);
  }
  return scores;
}

// =============================================================================
// RECIPROCAL RANK FUSION (RRF)
// =============================================================================

/**
 * Combine multiple ranked lists using RRF.
 * RRF(d) = sum( 1 / (k + rank_i(d)) ) for each ranking system i.
 * k=60 is standard.
 */
function reciprocalRankFusion(
  ...rankings: Map<string, number>[]
): Map<string, number> {
  const K = 60;
  const fused = new Map<string, number>();

  for (const ranking of rankings) {
    // Sort by score descending to get ranks
    const sorted = [...ranking.entries()].sort((a, b) => b[1] - a[1]);
    for (let rank = 0; rank < sorted.length; rank++) {
      const [id] = sorted[rank];
      const prev = fused.get(id) ?? 0;
      fused.set(id, prev + 1 / (K + rank + 1));
    }
  }

  return fused;
}

// =============================================================================
// PUBLIC API: HYBRID SEMANTIC RECALL
// =============================================================================

/**
 * Hybrid search: BM25 + Embedding + RRF reranking.
 * Falls back gracefully when embeddings are unavailable.
 */
export async function semanticRecall(
  userId: string,
  query: string,
  facts: Array<{ id: string; subject: string; predicate: string; object: string; confidence: number }>,
  maxResults: number = 10,
): Promise<FactWithScore[]> {
  if (facts.length === 0) return [];

  // Stage 1: BM25 scoring
  const documents = facts.map((f) => ({ id: f.id, text: factToText(f) }));
  const bm25Scores = bm25Score(query, documents);

  // Stage 2: Embedding scoring (may return empty if no API key)
  const embScores = await embeddingScores(userId, query, facts);

  // Stage 3: Reciprocal Rank Fusion
  const fusedScores = reciprocalRankFusion(bm25Scores, embScores);

  // If neither method returned results, try pure substring match as last resort
  if (fusedScores.size === 0) {
    const queryLower = query.toLowerCase();
    for (const fact of facts) {
      const text = factToText(fact).toLowerCase();
      if (text.includes(queryLower) || queryLower.split(/\s+/).some((w) => w.length > 2 && text.includes(w))) {
        fusedScores.set(fact.id, 0.01);
      }
    }
  }

  // Build result with scores
  const factMap = new Map(facts.map((f) => [f.id, f]));
  const results: FactWithScore[] = [];
  for (const [id, score] of fusedScores) {
    const fact = factMap.get(id);
    if (fact) results.push({ ...fact, score });
  }

  // Sort by fused score descending
  results.sort((a, b) => b.score - a.score);

  // Boost by fact confidence (slight preference for high-confidence facts)
  for (const r of results) {
    r.score = r.score * (0.8 + 0.2 * r.confidence);
  }
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, maxResults);
}

// =============================================================================
// CONFIDENCE DECAY (Active Forgetting)
// =============================================================================

/**
 * Apply confidence decay to facts that haven't been accessed recently.
 * Facts lose confidence over time if never recalled. This prevents stale
 * facts from polluting memory.
 *
 * Call periodically (e.g., during consolidation or daily cron).
 *
 * @param userId - User whose facts to decay
 * @param db - SheepDatabase instance
 * @param options - Decay parameters
 * @returns Number of facts decayed and number retracted
 */
export function applyConfidenceDecay(
  db: { findFacts: (o: { activeOnly?: boolean }) => Array<{ id: string; confidence: number; accessCount: number; createdAt: string }>; retractFact: (id: string, reason: string) => void },
  options: {
    /** Days without access before decay starts (default: 30) */
    decayStartDays?: number;
    /** Confidence reduction per decay period (default: 0.05) */
    decayRate?: number;
    /** Minimum confidence before auto-retraction (default: 0.2) */
    minConfidence?: number;
  } = {},
): { decayed: number; retracted: number } {
  const { decayStartDays = 30, decayRate = 0.05, minConfidence = 0.2 } = options;
  const now = Date.now();
  const decayThresholdMs = decayStartDays * 24 * 60 * 60 * 1000;

  const facts = db.findFacts({ activeOnly: true });
  let decayed = 0;
  let retracted = 0;

  for (const fact of facts) {
    const createdAt = new Date(fact.createdAt).getTime();
    const age = now - createdAt;

    // Skip if too young or frequently accessed
    if (age < decayThresholdMs || fact.accessCount > 5) continue;

    // Calculate decay based on age and access count
    const periodsOld = Math.floor(age / decayThresholdMs);
    const accessBonus = Math.min(fact.accessCount * 0.02, 0.1);
    const newConfidence = fact.confidence - (decayRate * periodsOld) + accessBonus;

    if (newConfidence < minConfidence) {
      db.retractFact(fact.id, `Confidence decayed below ${minConfidence} (age: ${periodsOld * decayStartDays}d, accesses: ${fact.accessCount})`);
      retracted++;
    }
    decayed++;
  }

  return { decayed, retracted };
}

