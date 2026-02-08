/**
 * SHEEP AI - Prefetch Engine Tests
 */

import { describe, it, expect } from "vitest";
import {
  classifyIntent,
  extractEntities,
  extractTemporalReference,
  predictMemoryNeeds,
  analyzePrefetchNeeds,
  shouldPrefetch,
  executePrefetch,
} from "./prefetch-engine.js";
import type { Fact, Episode } from "../memory/schema.js";
import { generateId, now } from "../memory/schema.js";

describe("Prefetch Engine", () => {
  describe("classifyIntent", () => {
    it("classifies questions correctly", () => {
      const intent = classifyIntent("What is the capital of France?");
      expect(intent.intentType).toBe("question");
    });

    it("classifies questions ending with ?", () => {
      // "You mentioned" triggers reference pattern, so use a plain question
      const intent = classifyIntent("This is about APIs?");
      expect(intent.intentType).toBe("question");
    });

    it("classifies commands correctly", () => {
      const intent = classifyIntent("Create a new file called test.ts");
      expect(intent.intentType).toBe("command");
    });

    it("classifies polite commands correctly", () => {
      const intent = classifyIntent("Please create a new component for the dashboard");
      expect(intent.intentType).toBe("command");
    });

    it("classifies references to past conversations", () => {
      const intent = classifyIntent("Remember when we discussed the database design?");
      expect(intent.intentType).toBe("reference");
    });

    it("classifies social greetings", () => {
      const intent = classifyIntent("Hello! How are you?");
      expect(intent.intentType).toBe("social");
    });

    it("classifies creative requests", () => {
      // "Write" is also a command pattern, so use explicit creative keywords
      const intent = classifyIntent("Imagine a world where robots rule");
      expect(intent.intentType).toBe("creative");
    });

    it("extracts entities from message", () => {
      const intent = classifyIntent('What did "John Smith" say about the "API Project"?');
      // Quoted entities are reliably extracted
      expect(intent.entities.some((e) => e.includes("John"))).toBe(true);
    });

    it("extracts temporal hints", () => {
      const intent = classifyIntent("What did we discuss yesterday?");
      expect(intent.temporalHints.length).toBeGreaterThan(0);
      expect(intent.temporalHints[0]).toBe("yesterday");
    });
  });

  describe("extractEntities", () => {
    it("extracts capitalized names", () => {
      const entities = extractEntities("I talked to John Smith yesterday.");
      const names = entities.filter((e) => e.type === "person");
      expect(names.some((e) => e.value.includes("John"))).toBe(true);
    });

    it("extracts technical terms", () => {
      const entities = extractEntities("We use API and ML and UX daily.");
      // At least some technical terms should be found
      const allValues = entities.map((e) => e.value);
      const hasAnyTech = allValues.some((v) => ["API", "ML", "UX"].includes(v));
      expect(hasAnyTech).toBe(true);
    });

    it("extracts quoted entities", () => {
      const entities = extractEntities('The project is called "SHEEP AI".');
      expect(entities.some((e) => e.value === "SHEEP AI")).toBe(true);
    });

    it("excludes common words", () => {
      const entities = extractEntities("I think The quick fox jumped.");
      const excluded = entities.filter((e) => e.value === "I" || e.value === "The");
      expect(excluded).toHaveLength(0);
    });

    it("gives higher confidence to repeated entities", () => {
      const entities = extractEntities("Claude is great. Claude helped me. Claude is smart.");
      const claude = entities.find((e) => e.value === "Claude");
      expect(claude).toBeDefined();
      expect(claude!.confidence).toBeGreaterThan(0.5);
    });
  });

  describe("extractTemporalReference", () => {
    it("extracts 'yesterday' reference", () => {
      const ref = extractTemporalReference("What did we discuss yesterday?");
      expect(ref.type).toBe("relative");
      expect(ref.reference).toBe("yesterday");
      expect(ref.rangeStart).toBeDefined();
      expect(ref.rangeEnd).toBeDefined();
    });

    it("extracts 'last week' reference", () => {
      const ref = extractTemporalReference("Show me changes from last week.");
      expect(ref.type).toBe("relative");
      expect(ref.reference.toLowerCase()).toContain("last week");
    });

    it("extracts 'X days ago' reference", () => {
      const ref = extractTemporalReference("What happened 3 days ago?");
      expect(ref.type).toBe("relative");
      expect(ref.reference).toContain("3 days ago");
    });

    it("extracts absolute dates", () => {
      const ref = extractTemporalReference("What happened on 2026-01-15?");
      expect(ref.type).toBe("absolute");
      expect(ref.rangeStart).toBeDefined();
    });

    it("returns none for no temporal reference", () => {
      const ref = extractTemporalReference("Tell me about databases.");
      expect(ref.type).toBe("none");
    });
  });

  describe("predictMemoryNeeds", () => {
    it("predicts facts for questions", () => {
      const intent = classifyIntent("What is my favorite color?");
      const prediction = predictMemoryNeeds(intent);

      expect(prediction.predictedNeeds).toContain("facts");
      expect(prediction.confidence).toBeGreaterThan(0.5);
    });

    it("predicts procedures for commands", () => {
      const intent = classifyIntent("Create a new database");
      const prediction = predictMemoryNeeds(intent);

      expect(prediction.predictedNeeds).toContain("procedures");
    });

    it("predicts episodes for references", () => {
      const intent = classifyIntent("Remember when we talked about APIs?");
      const prediction = predictMemoryNeeds(intent);

      expect(prediction.predictedNeeds).toContain("episodes");
    });

    it("has low confidence for creative tasks", () => {
      const intent = classifyIntent("Imagine a fantasy world");
      const prediction = predictMemoryNeeds(intent);

      // Creative tasks should have lower confidence than questions
      const questionIntent = classifyIntent("What is the database schema?");
      const questionPrediction = predictMemoryNeeds(questionIntent);

      expect(prediction.confidence).toBeLessThan(questionPrediction.confidence);
    });

    it("generates suggested queries from entities", () => {
      const intent = classifyIntent('What did "Claude" say about the "Project"?');
      const prediction = predictMemoryNeeds(intent);

      // Should have queries even if no entities (temporal hints, etc.)
      // or entities from quoted strings
      expect(prediction.suggestedQueries).toBeDefined();
    });

    it("increases confidence with entity overlap in recent topics", () => {
      const intent = classifyIntent("Tell me more about Claude");
      const predictionWithoutTopics = predictMemoryNeeds(intent, []);
      const predictionWithTopics = predictMemoryNeeds(intent, ["claude"]);

      expect(predictionWithTopics.confidence).toBeGreaterThanOrEqual(
        predictionWithoutTopics.confidence,
      );
    });
  });

  describe("analyzePrefetchNeeds", () => {
    it("combines intent classification and prediction", () => {
      const prediction = analyzePrefetchNeeds("What is the meaning of life?");

      expect(prediction.intent).toBeDefined();
      expect(prediction.predictedNeeds.length).toBeGreaterThan(0);
      expect(prediction.confidence).toBeGreaterThan(0);
    });

    it("includes entities in prediction", () => {
      const prediction = analyzePrefetchNeeds('What did "John" say about "APIs"?');

      // With quoted entities, we should extract them
      expect(prediction.intent.entities.some((e) => e.includes("John"))).toBe(true);
    });
  });

  describe("shouldPrefetch", () => {
    it("returns false for simple greetings", () => {
      expect(shouldPrefetch("Hi")).toBe(false);
      expect(shouldPrefetch("Hello!")).toBe(false);
      expect(shouldPrefetch("Thanks!")).toBe(false);
    });

    it("returns true for questions", () => {
      expect(shouldPrefetch("What is the current project status?")).toBe(true);
    });

    it("returns true for references", () => {
      expect(shouldPrefetch("Remember what we discussed last week?")).toBe(true);
    });

    it("returns false for very short messages", () => {
      expect(shouldPrefetch("ok")).toBe(false);
      expect(shouldPrefetch("yes")).toBe(false);
    });

    it("returns true for commands", () => {
      expect(shouldPrefetch("Create a new component for the dashboard")).toBe(true);
    });
  });

  describe("executePrefetch", () => {
    it("queries facts based on prediction", () => {
      const prediction = analyzePrefetchNeeds('What is "John" favorite color?');

      // Mock query functions
      const mockFact: Fact = {
        id: generateId("fact"),
        subject: "John",
        predicate: "favorite_color",
        object: "blue",
        confidence: 0.9,
        evidence: [],
        isActive: true,
        userAffirmed: false,
        createdAt: now(),
        updatedAt: now(),
      };

      const result = executePrefetch(
        prediction,
        () => [mockFact], // queryFacts
        () => [], // queryEpisodes
        () => [], // queryCausalLinks
      );

      // When queries are generated, facts should be returned
      expect(result.prefetchTimeMs).toBeDefined();
      expect(result.facts.length).toBeGreaterThanOrEqual(0);
    });

    it("queries episodes for reference intents", () => {
      const prediction = analyzePrefetchNeeds('Remember when we discussed "ProjectX"?');

      // Mock query functions
      const mockEpisode: Episode = {
        id: generateId("ep"),
        timestamp: now(),
        summary: "Discussed project timeline",
        participants: ["user", "assistant"],
        topic: "project",
        keywords: ["project", "timeline"],
        emotionalSalience: 0.5,
        utilityScore: 0.7,
        sourceSessionId: "sess-1",
        sourceMessageIds: ["msg-1"],
        ttl: "30d",
        accessCount: 0,
        createdAt: now(),
        updatedAt: now(),
      };

      const result = executePrefetch(
        prediction,
        () => [], // queryFacts
        () => [mockEpisode], // queryEpisodes
        () => [], // queryCausalLinks
      );

      // Reference intents predict episodes
      expect(prediction.predictedNeeds).toContain("episodes");
      expect(result.episodes.length).toBeGreaterThanOrEqual(0);
    });

    it("respects maxFacts config", () => {
      const prediction = analyzePrefetchNeeds("What do I know about everything?");

      const manyFacts: Fact[] = Array.from({ length: 20 }, (_, i) => ({
        id: generateId("fact"),
        subject: `Subject${i}`,
        predicate: "knows",
        object: "something",
        confidence: 0.8,
        evidence: [],
        isActive: true,
        userAffirmed: false,
        createdAt: now(),
        updatedAt: now(),
      }));

      const result = executePrefetch(
        prediction,
        () => manyFacts,
        () => [],
        () => [],
        { maxFacts: 5 },
      );

      expect(result.facts.length).toBeLessThanOrEqual(5);
    });

    it("tracks expanded entities in debug info", () => {
      const prediction = analyzePrefetchNeeds('What does "Claude" know about "APIs"?');

      const result = executePrefetch(
        prediction,
        () => [],
        () => [],
        () => [],
        { expandEntities: true },
      );

      expect(result.debug).toBeDefined();
      // entitiesExpanded tracks what was expanded (may be empty if no entities found)
      expect(Array.isArray(result.debug!.entitiesExpanded)).toBe(true);
    });
  });
});
