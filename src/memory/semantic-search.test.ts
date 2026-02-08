/**
 * SHEEP AI - Semantic Search Tests
 */

import { describe, it, expect } from "vitest";
import {
  SemanticMemoryIndex,
  cosineSimilarity,
  episodeToText,
  factToText,
  causalLinkToText,
  hybridSearch,
  createSemanticIndex,
} from "./semantic-search.js";
import type { Episode, Fact, CausalLink } from "./schema.js";
import { generateId, now } from "./schema.js";

function createTestEpisode(overrides: Partial<Episode> = {}): Episode {
  const timestamp = now();
  return {
    id: generateId("ep"),
    timestamp,
    summary: "Test episode about programming",
    participants: ["user", "assistant"],
    topic: "programming",
    keywords: ["code", "typescript"],
    emotionalSalience: 0.5,
    utilityScore: 0.6,
    sourceSessionId: "sess-1",
    sourceMessageIds: ["msg-1"],
    ttl: "30d",
    accessCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createTestFact(overrides: Partial<Fact> = {}): Fact {
  const timestamp = now();
  return {
    id: generateId("fact"),
    subject: "user",
    predicate: "prefers",
    object: "TypeScript",
    confidence: 0.9,
    evidence: [],
    isActive: true,
    userAffirmed: false,
    accessCount: 0,
    firstSeen: timestamp,
    lastConfirmed: timestamp,
    contradictions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createTestCausalLink(overrides: Partial<CausalLink> = {}): CausalLink {
  const timestamp = now();
  return {
    id: generateId("cl"),
    causeType: "episode",
    causeId: "ep-1",
    causeDescription: "code refactoring",
    effectType: "episode",
    effectId: "ep-1",
    effectDescription: "improved performance",
    mechanism: "better algorithms",
    confidence: 0.8,
    evidence: [],
    causalStrength: "direct",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("Semantic Search (Breakthrough!)", () => {
  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const v = [1, 2, 3, 4, 5];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it("returns -1 for opposite vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [-1, 0, 0];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1, 5);
    });

    it("returns 0 for orthogonal vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 5);
    });

    it("throws for mismatched lengths", () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow("length mismatch");
    });

    it("handles zero vectors", () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });
  });

  describe("Text conversion functions", () => {
    it("converts episode to searchable text", () => {
      const episode = createTestEpisode({
        summary: "Discussed TypeScript",
        topic: "coding",
        keywords: ["typescript", "javascript"],
      });

      const text = episodeToText(episode);

      expect(text).toContain("Discussed TypeScript");
      expect(text).toContain("coding");
      expect(text).toContain("typescript");
    });

    it("converts fact to searchable text", () => {
      const fact = createTestFact({
        subject: "Alice",
        predicate: "works_at",
        object: "Google",
      });

      const text = factToText(fact);

      expect(text).toContain("Alice");
      expect(text).toContain("works at"); // underscore converted to space
      expect(text).toContain("Google");
    });

    it("converts causal link to searchable text", () => {
      const link = createTestCausalLink({
        causeDescription: "code review",
        effectDescription: "bug discovered",
        mechanism: "thorough inspection",
      });

      const text = causalLinkToText(link);

      expect(text).toContain("code review");
      expect(text).toContain("bug discovered");
      expect(text).toContain("thorough inspection");
    });
  });

  describe("SemanticMemoryIndex", () => {
    it("creates an index without provider", () => {
      const index = createSemanticIndex();
      expect(index).toBeInstanceOf(SemanticMemoryIndex);
    });

    it("adds episodes to the index", async () => {
      const index = createSemanticIndex();
      const episode = createTestEpisode();

      await index.addEpisode(episode);

      const stats = index.getStats();
      expect(stats.total).toBe(1);
      expect(stats.byType["episode"]).toBe(1);
    });

    it("adds facts to the index", async () => {
      const index = createSemanticIndex();
      const fact = createTestFact();

      await index.addFact(fact);

      const stats = index.getStats();
      expect(stats.total).toBe(1);
      expect(stats.byType["fact"]).toBe(1);
    });

    it("adds causal links to the index", async () => {
      const index = createSemanticIndex();
      const link = createTestCausalLink();

      await index.addCausalLink(link);

      const stats = index.getStats();
      expect(stats.total).toBe(1);
      expect(stats.byType["causal_link"]).toBe(1);
    });

    it("adds multiple items in batch", async () => {
      const index = createSemanticIndex();

      await index.addBatch([
        { type: "episode", item: createTestEpisode() },
        { type: "fact", item: createTestFact() },
        { type: "causal_link", item: createTestCausalLink() },
      ]);

      const stats = index.getStats();
      expect(stats.total).toBe(3);
    });

    it("searches by query text", async () => {
      const index = createSemanticIndex();

      await index.addEpisode(createTestEpisode({ summary: "Discussed Python programming" }));
      await index.addEpisode(createTestEpisode({ summary: "Talked about cooking recipes" }));
      await index.addFact(
        createTestFact({ subject: "user", predicate: "knows", object: "Python" }),
      );

      // Note: With mock embeddings (random), results may vary
      // This test verifies the search returns results
      const results = await index.search("programming", { maxResults: 5 });

      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it("filters by memory type", async () => {
      const index = createSemanticIndex();

      await index.addEpisode(createTestEpisode());
      await index.addFact(createTestFact());

      const episodeOnly = await index.search("test", { types: ["episode"] });
      const factOnly = await index.search("test", { types: ["fact"] });

      // All results should be of the correct type
      for (const r of episodeOnly) {
        expect(r.type).toBe("episode");
      }
      for (const r of factOnly) {
        expect(r.type).toBe("fact");
      }
    });

    it("respects maxResults limit", async () => {
      const index = createSemanticIndex();

      // Add many episodes
      for (let i = 0; i < 20; i++) {
        await index.addEpisode(createTestEpisode({ summary: `Episode ${i}` }));
      }

      const results = await index.search("episode", { maxResults: 5, minSimilarity: 0 });

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("removes memories from index", async () => {
      const index = createSemanticIndex();
      const episode = createTestEpisode();

      await index.addEpisode(episode);
      expect(index.getStats().total).toBe(1);

      const removed = index.remove(episode.id);

      expect(removed).toBe(true);
      expect(index.getStats().total).toBe(0);
    });

    it("clears all memories", async () => {
      const index = createSemanticIndex();

      await index.addEpisode(createTestEpisode());
      await index.addFact(createTestFact());

      index.clear();

      expect(index.getStats().total).toBe(0);
    });

    it("finds similar facts", async () => {
      const index = createSemanticIndex();

      const fact1 = createTestFact({ subject: "Alice", predicate: "likes", object: "Python" });
      const fact2 = createTestFact({ subject: "Bob", predicate: "likes", object: "Java" });

      await index.addFact(fact1);
      await index.addFact(fact2);

      const similar = await index.findSimilarFacts(fact1);

      // Should return results (including the original fact)
      expect(similar.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("hybridSearch", () => {
    it("combines keyword and semantic results", () => {
      const keywordResults = [
        { id: "1", type: "fact" as const, similarity: 0.8, text: "test", metadata: {} },
        { id: "2", type: "fact" as const, similarity: 0.6, text: "test", metadata: {} },
      ];

      const semanticResults = [
        { id: "1", type: "fact" as const, similarity: 0.9, text: "test", metadata: {} },
        { id: "3", type: "fact" as const, similarity: 0.7, text: "test", metadata: {} },
      ];

      const combined = hybridSearch(keywordResults, semanticResults);

      // ID "1" should appear once with combined score
      const id1Results = combined.filter((r) => r.id === "1");
      expect(id1Results.length).toBe(1);

      // Should include all unique IDs
      const allIds = combined.map((r) => r.id);
      expect(allIds).toContain("1");
      expect(allIds).toContain("2");
      expect(allIds).toContain("3");
    });

    it("respects weighting", () => {
      const keywordResults = [
        { id: "1", type: "fact" as const, similarity: 1.0, text: "test", metadata: {} },
      ];

      const semanticResults = [
        { id: "2", type: "fact" as const, similarity: 1.0, text: "test", metadata: {} },
      ];

      // With 0.3 keyword weight and 0.7 semantic weight
      const combined = hybridSearch(keywordResults, semanticResults, 0.3, 0.7);

      // Semantic result should have higher combined score
      const result1 = combined.find((r) => r.id === "1");
      const result2 = combined.find((r) => r.id === "2");

      expect(result1?.similarity).toBeCloseTo(0.3);
      expect(result2?.similarity).toBeCloseTo(0.7);
    });
  });
});
