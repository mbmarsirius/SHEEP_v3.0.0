/**
 * SHEEP AI - Embedding Provider (Standalone)
 *
 * Primary: Gemini embedding-001 via Google AI SDK (71.5% accuracy, $0.15/1M tokens)
 * Fallback: Random vectors for testing when no API key is set
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

export type EmbeddingProvider = {
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
  dimensions: number;
  name: string;
};

export type EmbeddingProviderOptions = {
  provider?: string;
  model?: string;
  apiKey?: string;
};

export type EmbeddingProviderResult = {
  provider: EmbeddingProvider;
  source: string;
};

/**
 * Create a real embedding provider.
 * Uses Gemini embedding-001 when GOOGLE_AI_API_KEY is set.
 * Falls back to mock random vectors for testing.
 */
export async function createEmbeddingProvider(
  _options?: EmbeddingProviderOptions,
): Promise<EmbeddingProviderResult> {
  const apiKey = _options?.apiKey ?? process.env.GOOGLE_AI_API_KEY;

  if (apiKey) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: _options?.model ?? "gemini-embedding-001" });

      // Verify the provider works with a test embed
      const testResult = await model.embedContent("test");
      const dimensions = testResult.embedding.values.length;

      console.log(`[SHEEP] Embedding provider ready: gemini-embedding-001 (${dimensions}d)`);

      return {
        provider: {
          async embed(text: string): Promise<number[]> {
            const result = await model.embedContent(text);
            return result.embedding.values;
          },
          async embedBatch(texts: string[]): Promise<number[][]> {
            // Process in parallel with concurrency limit
            const BATCH_SIZE = 8;
            const results: number[][] = [];
            for (let i = 0; i < texts.length; i += BATCH_SIZE) {
              const batch = texts.slice(i, i + BATCH_SIZE);
              const batchResults = await Promise.all(
                batch.map(async (text) => {
                  const result = await model.embedContent(text);
                  return result.embedding.values;
                }),
              );
              results.push(...batchResults);
            }
            return results;
          },
          dimensions,
          name: "gemini-embedding-001",
        },
        source: "google-ai",
      };
    } catch (err) {
      console.warn(`[SHEEP] Failed to initialize Gemini embeddings: ${err}. Using mock.`);
    }
  } else {
    console.warn("[SHEEP] GOOGLE_AI_API_KEY not set. Using mock embeddings (semantic search will be random).");
  }

  // Fallback: mock provider with random vectors (for testing)
  return {
    provider: {
      async embed(_text: string) {
        return new Array(768).fill(0).map(() => Math.random() * 2 - 1);
      },
      dimensions: 768,
      name: "mock",
    },
    source: "mock",
  };
}
