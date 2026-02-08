/**
 * Stub: Embedding provider (replaces memory/embeddings.js)
 */
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

export async function createEmbeddingProvider(
  _options?: EmbeddingProviderOptions,
): Promise<EmbeddingProviderResult> {
  return {
    provider: {
      async embed(_text: string) {
        return new Array(384).fill(0).map(() => Math.random() * 2 - 1);
      },
      dimensions: 384,
      name: "mock",
    },
    source: "mock",
  };
}
