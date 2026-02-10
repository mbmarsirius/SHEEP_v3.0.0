/**
 * SHEEP AI - Embedding Generation for Multi-View Indexing
 *
 * Generates semantic embeddings for facts to enable vector similarity search.
 * Uses the existing embedding provider infrastructure from Moltbot.
 *
 * @module sheep/retrieval/embeddings
 */

import type { OpenClawConfig } from "../stubs/config.js";
import type { EmbeddingProvider } from "../stubs/embeddings.js";
import type { SheepDatabase } from "../memory/database.js";
import { createSubsystemLogger } from "../stubs/logging.js";
import { createEmbeddingProvider } from "../stubs/embeddings.js";
import { recoverEmbeddingEngine, recordError, recordSuccess } from "../health/auto-recovery.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for embedding generation
 */
export type EmbeddingGenerationOptions = {
  /** Batch size for embedding generation (default: 32) */
  batchSize?: number;
  /** Maximum number of facts to process (default: unlimited) */
  maxFacts?: number;
  /** Callback for progress updates */
  onProgress?: (processed: number, total: number) => void;
};

// =============================================================================
// EMBEDDING PROVIDER CREATION
// =============================================================================

/**
 * Create an embedding provider for SHEEP facts
 * Uses the existing Moltbot embedding infrastructure
 */
export async function createSheepEmbeddingProvider(
  config: OpenClawConfig,
): Promise<EmbeddingProvider> {
  try {
    const result = await createEmbeddingProvider({
      config,
      provider: "auto", // Try local first, then OpenAI/Gemini
      model: "text-embedding-3-small", // OpenAI's small, fast model
      fallback: "gemini", // Fallback to Gemini if OpenAI unavailable
    });

    log.info("SHEEP embedding provider created", {
      provider: result.provider.id,
      model: result.provider.model,
    });

    return result.provider;
  } catch (err) {
    log.error("Failed to create embedding provider", { error: String(err) });
    throw new Error(
      `Failed to create embedding provider: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// =============================================================================
// EMBEDDING GENERATION
// =============================================================================

/**
 * Convert embedding array to BLOB for storage
 */
function embeddingToBlob(embedding: number[]): Buffer {
  // Convert to Float32Array and then to Buffer
  const floatArray = new Float32Array(embedding);
  return Buffer.from(floatArray.buffer);
}

/**
 * Generate and store embeddings for facts that don't have them
 */
export async function generateFactEmbeddings(
  db: SheepDatabase,
  provider: EmbeddingProvider,
  options: EmbeddingGenerationOptions = {},
): Promise<{ processed: number; generated: number; errors: number }> {
  // Reduced batch size to avoid token limit errors (500 error)
  // 32 was too large - try 16, fallback to 8 if still fails
  const batchSize = options.batchSize ?? 16;
  const maxFacts = options.maxFacts ?? Infinity;

  // Get facts without embeddings
  // For BLOB columns, we can only check IS NULL, not = ''
  const limit = maxFacts === Infinity ? -1 : maxFacts; // -1 means no limit in SQLite
  const sql =
    limit === -1
      ? `SELECT id, subject, predicate, object 
       FROM sheep_facts 
       WHERE is_active = 1 
         AND embedding IS NULL`
      : `SELECT id, subject, predicate, object 
       FROM sheep_facts 
       WHERE is_active = 1 
         AND embedding IS NULL
       LIMIT ?`;

  const factsWithoutEmbeddings = (
    limit === -1 ? db.db.prepare(sql).all() : db.db.prepare(sql).all(limit)
  ) as Array<{
    id: string;
    subject: string;
    predicate: string;
    object: string;
  }>;

  const totalFacts = factsWithoutEmbeddings.length;

  if (totalFacts === 0) {
    log.info("No facts need embedding generation");
    return { processed: 0, generated: 0, errors: 0 };
  }

  log.info("Generating embeddings for facts", {
    total: totalFacts,
    batchSize,
  });

  let processed = 0;
  let generated = 0;
  let errors = 0;

  // Prepare update statement
  const updateStmt = db.db.prepare(`
    UPDATE sheep_facts 
    SET embedding = ?, updated_at = ?
    WHERE id = ?
  `);

  // Process in batches
  // AUTONOMOUS MODE: Use auto-recovery for embedding generation
  // Note: agentId might not be directly accessible from db, so we'll use a generic identifier
  const agentId = "sheep-embeddings"; // Generic identifier for embedding generation health tracking
  
  for (let i = 0; i < totalFacts; i += batchSize) {
    const batch = factsWithoutEmbeddings.slice(i, i + batchSize);

    // Prepare texts for embedding
    const texts = batch.map((fact) => `${fact.subject} ${fact.predicate} ${fact.object}`);

    try {
      // Generate embeddings in batch with auto-recovery
      let embeddings: number[][];
      
      const success = await recoverEmbeddingEngine(
        agentId,
        async () => {
          embeddings = await provider.embedBatch(texts);
        },
        3, // max retries
      );

      if (!success) {
        // If auto-recovery failed, try smaller batches manually
        const errorMsg = "Auto-recovery failed, trying smaller batches";
        log.warn("Batch embedding failed, trying smaller batches", {
          originalBatchSize: batch.length,
          error: errorMsg,
        });
        
        // Process in smaller batches (8 items at a time)
        embeddings = [];
        const smallBatchSize = 8;
        for (let k = 0; k < texts.length; k += smallBatchSize) {
          const smallBatch = texts.slice(k, k + smallBatchSize);
          try {
            const smallEmbeddings = await provider.embedBatch(smallBatch);
            embeddings.push(...smallEmbeddings);
            if (agentId) recordSuccess(agentId);
          } catch (smallErr) {
            // If even small batch fails, skip this batch
            const errorMsg = smallErr instanceof Error ? smallErr.message : String(smallErr);
            log.warn("Small batch embedding also failed, skipping", {
              smallBatchSize: smallBatch.length,
              error: errorMsg.slice(0, 100),
            });
            if (agentId) recordError(agentId, `Small batch embedding failed: ${errorMsg.slice(0, 100)}`);
            // Add empty embeddings to maintain array length
            embeddings.push(...smallBatch.map(() => []));
            errors += smallBatch.length;
          }
        }
      } else {
        // Success - record it
        if (agentId) recordSuccess(agentId);
      }

      // Store embeddings in a transaction for this batch
      db.db.exec("BEGIN TRANSACTION");
      const now = new Date().toISOString();

      try {
        for (let j = 0; j < batch.length; j++) {
          try {
            const embedding = embeddings[j];
            if (embedding && embedding.length > 0) {
              const blob = embeddingToBlob(embedding);
              updateStmt.run(blob, now, batch[j].id);
              generated++;
            } else {
              log.warn("Empty embedding returned", { factId: batch[j].id });
              errors++;
            }
          } catch (err) {
            log.warn("Failed to store embedding", {
              factId: batch[j].id,
              error: String(err),
            });
            errors++;
          }
        }
        db.db.exec("COMMIT");
      } catch (err) {
        db.db.exec("ROLLBACK");
        throw err;
      }

      processed += batch.length;

      // Report progress
      if (options.onProgress) {
        options.onProgress(processed, totalFacts);
      }

      if (processed % 100 === 0 || processed === totalFacts) {
        log.info("Embedding generation progress", {
          processed,
          total: totalFacts,
          generated,
          errors,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error("Batch embedding generation failed", {
        batchStart: i,
        batchSize: batch.length,
        error: errorMsg.slice(0, 200),
      });
      errors += batch.length;
      processed += batch.length;
      
      // Don't throw - continue with next batch
      // This allows embedding generation to continue even if some batches fail
    }
  }

  log.info("Embedding generation complete", {
    processed,
    generated,
    errors,
  });

  return { processed, generated, errors };
}

/**
 * Generate embeddings for a single fact
 */
export async function generateFactEmbedding(
  provider: EmbeddingProvider,
  fact: { subject: string; predicate: string; object: string },
): Promise<Buffer> {
  const text = `${fact.subject} ${fact.predicate} ${fact.object}`;
  const embedding = await provider.embedQuery(text);
  return embeddingToBlob(embedding);
}
