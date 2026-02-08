/**
 * SHEEP AI - Online Semantic Synthesis
 *
 * SimpleMem's Online Semantic Synthesis: Merge related facts during write,
 * not during consolidation. This prevents duplicate facts from accumulating
 * and keeps the knowledge base clean and deduplicated.
 *
 * @module sheep/extraction/online-synthesis
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { SheepDatabase } from "../memory/database.js";
import type { Fact } from "../memory/schema.js";
import type { LLMProvider } from "./llm-extractor.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { cosineSimilarity } from "../memory/semantic-search.js";
import { generateFactEmbedding } from "../retrieval/embeddings.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for fact synthesis
 */
export type SynthesisOptions = {
  /** Similarity threshold for merging (0-1, default: 0.85) */
  similarityThreshold?: number;
  /** Maximum number of similar facts to consider (default: 10) */
  maxSimilarFacts?: number;
  /** Whether to use LLM for merging (default: true) */
  useLLM?: boolean;
};

/**
 * Result of fact synthesis
 */
export type SynthesisResult = {
  /** Facts to insert (may be merged) */
  facts: Fact[];
  /** Whether merging occurred */
  merged: boolean;
  /** IDs of facts that were merged/deactivated */
  mergedFactIds: string[];
};

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
    // BLOB contains Float32Array data
    // Each float32 is 4 bytes
    const floatCount = blob.length / 4;
    if (floatCount === 0 || !Number.isInteger(floatCount)) {
      return null;
    }
    const floatArray = new Float32Array(blob.buffer, blob.byteOffset, floatCount);
    const embedding = Array.from(floatArray);

    // Validate embedding dimensions (should be 1536 for text-embedding-3-small, which is 6144 bytes)
    // Minimum reasonable size: 384 dimensions (1536 bytes) for ada-002
    // Maximum reasonable size: 8192 dimensions (32768 bytes) for very large models
    if (embedding.length < 384 || embedding.length > 8192) {
      log.debug("Skipping fact with invalid embedding dimensions", {
        length: embedding.length,
        blobLength: blob.length,
        expectedBytes: embedding.length * 4,
      });
      return null;
    }

    return embedding;
  } catch (err) {
    log.warn("Failed to convert BLOB to embedding", { error: String(err) });
    return null;
  }
}

/**
 * Get embedding for a fact (from DB or generate)
 */
async function getFactEmbedding(
  fact: Fact,
  db: SheepDatabase,
  provider: EmbeddingProvider,
): Promise<number[] | null> {
  // Try to get from database first
  const row = db.db.prepare("SELECT embedding FROM sheep_facts WHERE id = ?").get(fact.id) as
    | { embedding: Buffer | null }
    | undefined;

  if (row?.embedding) {
    const embedding = blobToEmbedding(row.embedding);
    if (embedding && embedding.length > 0) {
      return embedding;
    }
  }

  // Generate if not found
  try {
    const text = `${fact.subject} ${fact.predicate} ${fact.object}`;
    const embedding = await provider.embedQuery(text);
    return embedding;
  } catch (err) {
    log.warn("Failed to generate embedding for fact", {
      factId: fact.id,
      error: String(err),
    });
    return null;
  }
}

// =============================================================================
// SIMILAR FACT FINDING
// =============================================================================

/**
 * Find semantically similar facts using embeddings
 */
async function findSimilarFacts(
  newFact: Omit<
    Fact,
    "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions"
  >,
  db: SheepDatabase,
  provider: EmbeddingProvider,
  threshold: number,
  maxResults: number,
): Promise<Array<{ fact: Fact; similarity: number }>> {
  // Generate embedding for new fact
  const newFactText = `${newFact.subject} ${newFact.predicate} ${newFact.object}`;
  let newEmbedding: number[];
  try {
    newEmbedding = await provider.embedQuery(newFactText);
  } catch (err) {
    log.warn("Failed to generate embedding for new fact", { error: String(err) });
    return [];
  }

  // Get all active facts with embeddings
  // Only get facts that have valid embeddings (6144 bytes = 1536 floats for text-embedding-3-small)
  const factsWithEmbeddings = db.db
    .prepare(
      `SELECT id, subject, predicate, object, embedding 
       FROM sheep_facts 
       WHERE is_active = 1 
         AND embedding IS NOT NULL
         AND LENGTH(embedding) >= 1536
       LIMIT ?`,
    )
    .all(maxResults * 5) as Array<{
    id: string;
    subject: string;
    predicate: string;
    object: string;
    embedding: Buffer | null;
  }>;

  const similar: Array<{ fact: Fact; similarity: number }> = [];

  for (const row of factsWithEmbeddings) {
    const embedding = blobToEmbedding(row.embedding);
    if (!embedding || embedding.length === 0) {
      continue;
    }

    // Skip if dimensions don't match
    if (embedding.length !== newEmbedding.length) {
      log.debug("Skipping fact with mismatched embedding dimensions", {
        factId: row.id,
        expected: newEmbedding.length,
        actual: embedding.length,
      });
      continue;
    }

    // Calculate cosine similarity
    const similarity = cosineSimilarity(newEmbedding, embedding);

    if (similarity >= threshold) {
      // Get full fact object
      const fact = db.getFact(row.id);
      if (fact) {
        similar.push({ fact, similarity });
      }
    }
  }

  // Sort by similarity (highest first) and limit
  similar.sort((a, b) => b.similarity - a.similarity);
  return similar.slice(0, maxResults);
}

// =============================================================================
// FACT MERGING WITH LLM
// =============================================================================

/**
 * Merge facts using LLM
 */
async function mergeFactsWithLLM(
  newFact: Omit<
    Fact,
    "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions"
  >,
  similarFacts: Fact[],
  llm: LLMProvider,
): Promise<
  Omit<Fact, "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions">
> {
  const prompt = `You are a knowledge base manager. Your task is to merge related facts into a single, comprehensive fact that captures all information without redundancy.

New fact to merge:
- Subject: ${newFact.subject}
- Predicate: ${newFact.predicate}
- Object: ${newFact.object}
- Confidence: ${newFact.confidence}
- Evidence: ${JSON.stringify(newFact.evidence)}

Existing similar facts:
${similarFacts
  .map(
    (f, i) =>
      `${i + 1}. Subject: ${f.subject}, Predicate: ${f.predicate}, Object: ${f.object}, Confidence: ${f.confidence}`,
  )
  .join("\n")}

Merge these facts into a single fact that:
1. Preserves all unique information
2. Uses the most specific and accurate subject/predicate/object
3. Combines evidence from all facts
4. Uses the highest confidence score
5. Maintains semantic meaning

Return ONLY a JSON object with this exact structure:
{
  "subject": "merged subject",
  "predicate": "merged predicate",
  "object": "merged object",
  "confidence": 0.0-1.0,
  "evidence": ["episode_id1", "episode_id2", ...],
  "firstSeen": "ISO timestamp",
  "lastConfirmed": "ISO timestamp",
  "userAffirmed": true/false
}

Do not include any explanation or markdown formatting. Only return the JSON object.`;

  try {
    const response = await llm.complete(prompt, {
      jsonMode: true,
      maxTokens: 500,
      temperature: 0.3,
    });

    // Parse JSON response
    let merged: any;
    try {
      // Remove markdown code blocks if present
      const cleaned = response
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      merged = JSON.parse(cleaned);
    } catch (parseErr) {
      log.warn("Failed to parse LLM merge response", {
        response: response.slice(0, 200),
        error: String(parseErr),
      });
      // Fallback: use new fact with combined evidence
      return {
        ...newFact,
        evidence: [...newFact.evidence, ...similarFacts.flatMap((f) => f.evidence)],
        confidence: Math.max(newFact.confidence, ...similarFacts.map((f) => f.confidence)),
        lastConfirmed: new Date().toISOString(),
      };
    }

    // Validate and return merged fact
    return {
      subject: merged.subject || newFact.subject,
      predicate: merged.predicate || newFact.predicate,
      object: merged.object || newFact.object,
      confidence: Math.max(0, Math.min(1, merged.confidence ?? newFact.confidence)),
      evidence: Array.isArray(merged.evidence)
        ? [...new Set([...newFact.evidence, ...merged.evidence])]
        : newFact.evidence,
      firstSeen: merged.firstSeen || newFact.firstSeen,
      lastConfirmed: merged.lastConfirmed || new Date().toISOString(),
      userAffirmed: merged.userAffirmed ?? newFact.userAffirmed,
    };
  } catch (err) {
    log.error("LLM fact merging failed", { error: String(err) });
    // Fallback: use new fact with combined evidence
    return {
      ...newFact,
      evidence: [...newFact.evidence, ...similarFacts.flatMap((f) => f.evidence)],
      confidence: Math.max(newFact.confidence, ...similarFacts.map((f) => f.confidence)),
      lastConfirmed: new Date().toISOString(),
    };
  }
}

// =============================================================================
// MAIN SYNTHESIS FUNCTION
// =============================================================================

/**
 * Synthesize a new fact with existing facts
 *
 * Finds semantically similar facts and merges them to prevent duplicates.
 * This is SimpleMem's "Online Semantic Synthesis" - merging happens during
 * write, not during consolidation.
 *
 * @param newFact - The new fact to synthesize
 * @param db - Database instance
 * @param embeddingProvider - Embedding provider for similarity search
 * @param llm - LLM provider for fact merging (optional)
 * @param options - Synthesis options
 * @returns Synthesis result with facts to insert
 */
export async function synthesizeFacts(
  newFact: Omit<
    Fact,
    "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions"
  >,
  db: SheepDatabase,
  embeddingProvider: EmbeddingProvider,
  llm?: LLMProvider,
  options: SynthesisOptions = {},
): Promise<SynthesisResult> {
  const threshold = options.similarityThreshold ?? 0.85;
  const maxSimilar = options.maxSimilarFacts ?? 10;
  const useLLM = options.useLLM !== false && llm !== undefined;

  log.debug("Starting fact synthesis", {
    fact: `${newFact.subject} ${newFact.predicate} ${newFact.object}`,
    threshold,
  });

  // Find similar facts
  const similar = await findSimilarFacts(newFact, db, embeddingProvider, threshold, maxSimilar);

  if (similar.length === 0) {
    log.debug("No similar facts found, inserting as-is");
    return {
      facts: [newFact as Fact],
      merged: false,
      mergedFactIds: [],
    };
  }

  log.info("Found similar facts for merging", {
    newFact: `${newFact.subject} ${newFact.predicate} ${newFact.object}`,
    similarCount: similar.length,
    maxSimilarity: similar[0]?.similarity,
  });

  // Merge facts
  const similarFacts = similar.map((s) => s.fact);
  let mergedFact: Omit<
    Fact,
    "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions"
  >;

  if (useLLM && llm) {
    mergedFact = await mergeFactsWithLLM(newFact, similarFacts, llm);
  } else {
    // Simple merge without LLM: combine evidence and use highest confidence
    mergedFact = {
      ...newFact,
      evidence: [...new Set([...newFact.evidence, ...similarFacts.flatMap((f) => f.evidence)])],
      confidence: Math.max(newFact.confidence, ...similarFacts.map((f) => f.confidence)),
      lastConfirmed: new Date().toISOString(),
      userAffirmed: newFact.userAffirmed || similarFacts.some((f) => f.userAffirmed),
    };
  }

  // Mark similar facts as inactive (merged)
  const mergedFactIds: string[] = [];
  for (const fact of similarFacts) {
    db.db
      .prepare("UPDATE sheep_facts SET is_active = 0, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), fact.id);
    mergedFactIds.push(fact.id);
  }

  log.info("Facts merged successfully", {
    mergedFact: `${mergedFact.subject} ${mergedFact.predicate} ${mergedFact.object}`,
    mergedCount: mergedFactIds.length,
  });

  return {
    facts: [mergedFact as Fact],
    merged: true,
    mergedFactIds,
  };
}
