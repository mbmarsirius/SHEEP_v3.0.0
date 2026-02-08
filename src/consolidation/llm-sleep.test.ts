/**
 * SHEEP AI - LLM Sleep Consolidation Tests
 */

import { describe, it, expect } from "vitest";
import { runLLMSleepConsolidation, shouldRunSleepCycle } from "./llm-sleep.js";
import { createMockLLMProvider } from "../extraction/llm-extractor.js";
import type { Episode, Fact } from "../memory/schema.js";
import { generateId, now } from "../memory/schema.js";

function createTestEpisode(overrides: Partial<Episode> = {}): Episode {
  const timestamp = now();
  return {
    id: generateId("ep"),
    timestamp,
    summary: "Test episode",
    participants: ["user", "assistant"],
    topic: "test",
    keywords: ["test"],
    emotionalSalience: 0.5,
    utilityScore: 0.5,
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
    predicate: "test",
    object: "value",
    confidence: 0.8,
    evidence: [],
    isActive: true,
    userAffirmed: false,
    accessCount: 1,
    firstSeen: timestamp,
    lastConfirmed: timestamp,
    contradictions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("LLM Sleep Consolidation (Breakthrough!)", () => {
  describe("runLLMSleepConsolidation", () => {
    it("returns empty result for no memories", async () => {
      const llm = createMockLLMProvider();

      const result = await runLLMSleepConsolidation(llm, [], [], []);

      expect(result.patternsDiscovered).toEqual([]);
      expect(result.factsConsolidated).toEqual([]);
      expect(result.connectionsCreated).toEqual([]);
      expect(result.forgettingRecommendations).toEqual([]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("discovers patterns in memories", async () => {
      const responses = new Map([
        [
          "discover patterns",
          JSON.stringify({
            patterns: [
              {
                description: "User prefers coding in the morning",
                confidence: 0.8,
                patternType: "behavioral",
                supportingMemories: ["ep-1", "ep-2"],
                reasoning: "Multiple morning coding sessions",
              },
            ],
          }),
        ],
      ]);
      const llm = createMockLLMProvider(responses);

      const episodes = [
        createTestEpisode({ id: "ep-1", summary: "Morning coding session" }),
        createTestEpisode({ id: "ep-2", summary: "Coded in the morning again" }),
        createTestEpisode({ id: "ep-3", summary: "Another morning session" }),
      ];

      const result = await runLLMSleepConsolidation(llm, episodes, [], [], {
        discoverPatterns: true,
        consolidateFacts: false,
        findConnections: false,
        recommendForgetting: false,
      });

      expect(result.patternsDiscovered.length).toBeGreaterThan(0);
      expect(result.patternsDiscovered[0].patternType).toBe("behavioral");
    });

    it("consolidates similar facts", async () => {
      const responses = new Map([
        [
          "consolidating facts",
          JSON.stringify({
            consolidations: [
              {
                originalFactIds: ["fact-1", "fact-2"],
                consolidationType: "merge",
                newFact: {
                  subject: "user",
                  predicate: "prefers",
                  object: "TypeScript and JavaScript",
                  confidence: 0.9,
                },
                reasoning: "Both facts about programming language preference",
              },
            ],
          }),
        ],
      ]);
      const llm = createMockLLMProvider(responses);

      const facts = [
        createTestFact({ id: "fact-1", predicate: "prefers", object: "TypeScript" }),
        createTestFact({ id: "fact-2", predicate: "prefers", object: "JavaScript" }),
        createTestFact({ id: "fact-3", predicate: "prefers", object: "Python" }),
      ];

      const result = await runLLMSleepConsolidation(llm, [], facts, [], {
        discoverPatterns: false,
        consolidateFacts: true,
        findConnections: false,
        recommendForgetting: false,
      });

      expect(result.factsConsolidated.length).toBeGreaterThan(0);
      expect(result.factsConsolidated[0].consolidationType).toBe("merge");
    });

    it("finds connections between memories", async () => {
      const responses = new Map([
        [
          "finding connections",
          JSON.stringify({
            connections: [
              {
                memoryId1: "ep-1",
                memoryId2: "fact-1",
                connectionType: "elaborates",
                confidence: 0.7,
                reasoning: "Episode explains the fact in more detail",
              },
            ],
          }),
        ],
      ]);
      const llm = createMockLLMProvider(responses);

      const episodes = [createTestEpisode({ id: "ep-1" }), createTestEpisode({ id: "ep-2" })];
      const facts = [createTestFact({ id: "fact-1" }), createTestFact({ id: "fact-2" })];

      const result = await runLLMSleepConsolidation(llm, episodes, facts, [], {
        discoverPatterns: false,
        consolidateFacts: false,
        findConnections: true,
        recommendForgetting: false,
      });

      expect(result.connectionsCreated.length).toBeGreaterThan(0);
    });

    it("recommends memories for forgetting", async () => {
      const responses = new Map([
        [
          "which memories can be safely forgotten",
          JSON.stringify({
            recommendations: [
              {
                memoryId: "ep-old",
                reason: "outdated",
                confidence: 0.9,
                reasoning: "This memory is superseded by newer information",
              },
            ],
          }),
        ],
      ]);
      const llm = createMockLLMProvider(responses);

      const episodes = Array.from({ length: 6 }, (_, i) =>
        createTestEpisode({ id: i === 0 ? "ep-old" : `ep-${i}` }),
      );

      const result = await runLLMSleepConsolidation(llm, episodes, [], [], {
        discoverPatterns: false,
        consolidateFacts: false,
        findConnections: false,
        recommendForgetting: true,
      });

      expect(result.forgettingRecommendations.length).toBeGreaterThan(0);
      expect(result.forgettingRecommendations[0].reason).toBe("outdated");
    });

    it("tracks processing duration", async () => {
      const llm = createMockLLMProvider();
      const episodes = [createTestEpisode(), createTestEpisode(), createTestEpisode()];

      const result = await runLLMSleepConsolidation(llm, episodes, [], []);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("shouldRunSleepCycle", () => {
    it("recommends initial consolidation if never run", () => {
      const result = shouldRunSleepCycle(null, 0);

      expect(result.shouldRun).toBe(true);
      expect(result.reason).toBe("initial_consolidation");
    });

    it("recommends consolidation for many new memories", () => {
      const lastRun = new Date(Date.now() - 1000 * 60 * 30); // 30 min ago

      const result = shouldRunSleepCycle(lastRun, 60);

      expect(result.shouldRun).toBe(true);
      expect(result.reason).toBe("many_new_memories");
    });

    it("recommends idle time consolidation", () => {
      const lastRun = new Date(Date.now() - 1000 * 60 * 90); // 1.5 hours ago

      const result = shouldRunSleepCycle(lastRun, 15, true);

      expect(result.shouldRun).toBe(true);
      expect(result.reason).toBe("idle_time_consolidation");
    });

    it("recommends scheduled consolidation after 6 hours", () => {
      const lastRun = new Date(Date.now() - 1000 * 60 * 60 * 7); // 7 hours ago

      const result = shouldRunSleepCycle(lastRun, 10);

      expect(result.shouldRun).toBe(true);
      expect(result.reason).toBe("scheduled_consolidation");
    });

    it("recommends deep sleep after 24 hours", () => {
      const lastRun = new Date(Date.now() - 1000 * 60 * 60 * 25); // 25 hours ago

      const result = shouldRunSleepCycle(lastRun, 2);

      expect(result.shouldRun).toBe(true);
      expect(result.reason).toBe("deep_sleep_consolidation");
    });

    it("does not recommend if no need", () => {
      const lastRun = new Date(Date.now() - 1000 * 60 * 30); // 30 min ago

      const result = shouldRunSleepCycle(lastRun, 3, false);

      expect(result.shouldRun).toBe(false);
      expect(result.reason).toBe("no_consolidation_needed");
    });
  });
});
