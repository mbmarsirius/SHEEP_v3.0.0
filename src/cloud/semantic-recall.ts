/**
 * SHEEP Cloud - Semantic Recall (Embedding-Based Search)
 *
 * Uses Gemini embeddings to find facts by meaning, not just keywords.
 * "What does the user like?" matches "user prefers TypeScript" even though
 * no words overlap.
 *
 * Embedding cache: facts are embedded on first access and cached in memory.
 * Cache invalidates when new facts are added (checked via count).
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// =============================================================================
// TYPES
// =============================================================================

interface FactWithScore {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  score: number; // cosine similarity 0-1
}

interface CachedEmbeddings {
  factCount: number;
  embeddings: Map<string, number[]>; // factId -> embedding vector
}

// =============================================================================
// STATE
// =============================================================================

const embeddingCache = new Map<string, CachedEmbeddings>(); // userId -> cache
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
// HELPERS
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
        try {
          const r = await model.embedContent(t);
          return r.embedding.values;
        } catch { return null; }
      }),
    );
    results.push(...batchResults);
  }
  return results;
}

// =============================================================================
// SEMANTIC SEARCH
// =============================================================================

/**
 * Search facts using semantic similarity (embedding-based).
 * Falls back to keyword search if embeddings are unavailable.
 */
export async function semanticRecall(
  userId: string,
  query: string,
  facts: Array<{ id: string; subject: string; predicate: string; object: string; confidence: number }>,
  maxResults: number = 10,
): Promise<FactWithScore[]> {
  // If no facts, return empty
  if (facts.length === 0) return [];

  // Try semantic search first
  const queryEmbedding = await embedText(query);
  if (!queryEmbedding) {
    // Fallback to keyword search
    return keywordFallback(query, facts, maxResults);
  }

  // Get or build fact embeddings cache
  let cache = embeddingCache.get(userId);
  if (!cache || cache.factCount !== facts.length) {
    // Rebuild cache
    const texts = facts.map(factToText);
    const embeddings = await embedBatch(texts);
    const newCache: CachedEmbeddings = { factCount: facts.length, embeddings: new Map() };
    for (let i = 0; i < facts.length; i++) {
      if (embeddings[i]) {
        newCache.embeddings.set(facts[i].id, embeddings[i]!);
      }
    }
    embeddingCache.set(userId, newCache);
    cache = newCache;
  }

  // Score each fact by cosine similarity
  const scored: FactWithScore[] = [];
  for (const fact of facts) {
    const factEmb = cache.embeddings.get(fact.id);
    if (!factEmb) continue;
    const score = cosineSimilarity(queryEmbedding, factEmb);
    scored.push({ ...fact, score });
  }

  // Sort by score descending, filter low scores
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((f) => f.score > 0.3).slice(0, maxResults);
}

/**
 * Keyword fallback when embeddings are unavailable.
 */
function keywordFallback(
  query: string,
  facts: Array<{ id: string; subject: string; predicate: string; object: string; confidence: number }>,
  maxResults: number,
): FactWithScore[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return facts
    .map((f) => {
      const text = factToText(f).toLowerCase();
      const matches = words.filter((w) => text.includes(w)).length;
      const score = words.length > 0 ? matches / words.length : 0;
      return { ...f, score };
    })
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
