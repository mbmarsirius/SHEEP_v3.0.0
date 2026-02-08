/**
 * SHEEP AI - Memory Schema Tests
 */

import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  EpisodeSchema,
  FactSchema,
  CausalLinkSchema,
  ProcedureSchema,
  ConsolidationRunSchema,
  generateId,
  now,
} from "./schema.js";

describe("SHEEP Memory Schema", () => {
  describe("Episode", () => {
    it("validates a valid episode", () => {
      const episode = {
        id: generateId("ep"),
        timestamp: now(),
        summary: "User discussed model preferences and decided to switch to Opus",
        participants: ["user", "assistant"],
        topic: "AI models",
        keywords: ["opus", "sonnet", "models", "preferences"],
        emotionalSalience: 0.3,
        utilityScore: 0.8,
        sourceSessionId: "sess-001",
        sourceMessageIds: ["msg-1", "msg-2", "msg-3"],
        ttl: "30d" as const,
        accessCount: 0,
        createdAt: now(),
        updatedAt: now(),
      };

      expect(Value.Check(EpisodeSchema, episode)).toBe(true);
    });

    it("validates episode with edge case values", () => {
      const episode = {
        id: generateId("ep"),
        timestamp: now(),
        summary: "Test episode with boundary values",
        participants: [],
        topic: "Test",
        keywords: [],
        emotionalSalience: 1.0, // Edge case: max value
        utilityScore: 0.0, // Edge case: min value
        sourceSessionId: "sess-001",
        sourceMessageIds: [],
        ttl: "permanent" as const,
        accessCount: 0,
        createdAt: now(),
        updatedAt: now(),
      };

      expect(Value.Check(EpisodeSchema, episode)).toBe(true);
    });
  });

  describe("Fact", () => {
    it("validates a valid fact", () => {
      const fact = {
        id: generateId("fact"),
        subject: "user",
        predicate: "prefers",
        object: "Opus 4.5",
        confidence: 0.9,
        evidence: ["ep-001", "ep-002"],
        firstSeen: now(),
        lastConfirmed: now(),
        contradictions: [],
        userAffirmed: true,
        isActive: true,
        accessCount: 5,
        createdAt: now(),
        updatedAt: now(),
      };

      expect(Value.Check(FactSchema, fact)).toBe(true);
    });

    it("validates a retracted fact", () => {
      const fact = {
        id: generateId("fact"),
        subject: "user",
        predicate: "prefers",
        object: "Sonnet",
        confidence: 0.3,
        evidence: ["ep-001"],
        firstSeen: now(),
        lastConfirmed: now(),
        contradictions: ["fact-002"],
        userAffirmed: false,
        isActive: false,
        retractedReason: "User explicitly stated they switched to Opus",
        accessCount: 2,
        createdAt: now(),
        updatedAt: now(),
      };

      expect(Value.Check(FactSchema, fact)).toBe(true);
    });

    it("validates fact with low confidence", () => {
      const fact = {
        id: generateId("fact"),
        subject: "user",
        predicate: "might_prefer",
        object: "Opus",
        confidence: 0.3, // Low confidence - uncertain
        evidence: [],
        firstSeen: now(),
        lastConfirmed: now(),
        contradictions: [],
        userAffirmed: false,
        isActive: true,
        accessCount: 0,
        createdAt: now(),
        updatedAt: now(),
      };

      expect(Value.Check(FactSchema, fact)).toBe(true);
    });
  });

  describe("CausalLink", () => {
    it("validates a valid causal link", () => {
      const link = {
        id: generateId("cl"),
        causeType: "fact" as const,
        causeId: "fact-001",
        causeDescription: "Sonnet had injection security issues",
        effectType: "fact" as const,
        effectId: "fact-002",
        effectDescription: "User switched to Opus",
        mechanism: "Security concerns about prompt injection led to model change",
        confidence: 0.85,
        evidence: ["ep-001", "ep-002"],
        temporalDelay: "1d",
        causalStrength: "direct" as const,
        createdAt: now(),
        updatedAt: now(),
      };

      expect(Value.Check(CausalLinkSchema, link)).toBe(true);
    });

    it("validates a contributing causal link", () => {
      const link = {
        id: generateId("cl"),
        causeType: "episode" as const,
        causeId: "ep-005",
        causeDescription: "Read article about Opus improvements",
        effectType: "fact" as const,
        effectId: "fact-002",
        effectDescription: "User switched to Opus",
        mechanism: "Article highlighted improvements that influenced decision",
        confidence: 0.6,
        evidence: ["ep-005"],
        causalStrength: "contributing" as const,
        createdAt: now(),
        updatedAt: now(),
      };

      expect(Value.Check(CausalLinkSchema, link)).toBe(true);
    });

    it("validates event-type causal link", () => {
      const link = {
        id: generateId("cl"),
        causeType: "event" as const,
        causeId: "external-event-001",
        causeDescription: "New model released",
        effectType: "fact" as const,
        effectId: "fact-002",
        effectDescription: "User interest increased",
        mechanism: "New release prompted evaluation",
        confidence: 0.7,
        evidence: [],
        causalStrength: "contributing" as const,
        createdAt: now(),
        updatedAt: now(),
      };

      expect(Value.Check(CausalLinkSchema, link)).toBe(true);
    });
  });

  describe("Procedure", () => {
    it("validates a valid procedure", () => {
      const procedure = {
        id: generateId("proc"),
        trigger: "when debugging TypeScript code",
        action: "use verbose output and step through code with breakpoints",
        expectedOutcome: "Bug is identified and fixed",
        examples: ["ep-003", "ep-007", "ep-012"],
        successRate: 0.85,
        timesUsed: 20,
        timesSucceeded: 17,
        tags: ["debugging", "typescript", "development"],
        createdAt: now(),
        updatedAt: now(),
      };

      expect(Value.Check(ProcedureSchema, procedure)).toBe(true);
    });

    it("validates a new procedure with no usage", () => {
      const procedure = {
        id: generateId("proc"),
        trigger: "when user asks about weather",
        action: "check location and fetch weather data",
        examples: ["ep-001"],
        successRate: 0,
        timesUsed: 0,
        timesSucceeded: 0,
        tags: ["weather", "utility"],
        createdAt: now(),
        updatedAt: now(),
      };

      expect(Value.Check(ProcedureSchema, procedure)).toBe(true);
    });
  });

  describe("ConsolidationRun", () => {
    it("validates a running consolidation", () => {
      const run = {
        id: generateId("cr"),
        startedAt: now(),
        status: "running" as const,
        processedFrom: "2026-01-27T00:00:00.000Z",
        processedTo: "2026-01-28T00:00:00.000Z",
        sessionsProcessed: 0,
        episodesExtracted: 0,
        factsExtracted: 0,
        causalLinksExtracted: 0,
        proceduresExtracted: 0,
        contradictionsResolved: 0,
        memoriesPruned: 0,
      };

      expect(Value.Check(ConsolidationRunSchema, run)).toBe(true);
    });

    it("validates a completed consolidation", () => {
      const run = {
        id: generateId("cr"),
        startedAt: "2026-01-28T03:00:00.000Z",
        completedAt: "2026-01-28T03:05:32.000Z",
        status: "completed" as const,
        processedFrom: "2026-01-27T00:00:00.000Z",
        processedTo: "2026-01-28T00:00:00.000Z",
        sessionsProcessed: 15,
        episodesExtracted: 42,
        factsExtracted: 18,
        causalLinksExtracted: 7,
        proceduresExtracted: 3,
        contradictionsResolved: 2,
        memoriesPruned: 5,
        durationMs: 332000,
        log: ["Started processing", "Extracted 42 episodes", "Completed successfully"],
      };

      expect(Value.Check(ConsolidationRunSchema, run)).toBe(true);
    });

    it("validates a failed consolidation", () => {
      const run = {
        id: generateId("cr"),
        startedAt: now(),
        completedAt: now(),
        status: "failed" as const,
        processedFrom: "2026-01-27T00:00:00.000Z",
        processedTo: "2026-01-28T00:00:00.000Z",
        sessionsProcessed: 5,
        episodesExtracted: 10,
        factsExtracted: 0,
        causalLinksExtracted: 0,
        proceduresExtracted: 0,
        contradictionsResolved: 0,
        memoriesPruned: 0,
        errorMessage: "Failed to extract facts: API rate limit exceeded",
      };

      expect(Value.Check(ConsolidationRunSchema, run)).toBe(true);
    });
  });

  describe("Utility Functions", () => {
    it("generateId creates unique IDs with correct prefix", () => {
      const epId = generateId("ep");
      const factId = generateId("fact");
      const clId = generateId("cl");
      const procId = generateId("proc");

      expect(epId).toMatch(/^ep-[a-z0-9]+-[a-z0-9]+$/);
      expect(factId).toMatch(/^fact-[a-z0-9]+-[a-z0-9]+$/);
      expect(clId).toMatch(/^cl-[a-z0-9]+-[a-z0-9]+$/);
      expect(procId).toMatch(/^proc-[a-z0-9]+-[a-z0-9]+$/);

      // Should be unique
      expect(generateId("ep")).not.toBe(epId);
    });

    it("now returns valid ISO timestamp", () => {
      const timestamp = now();
      expect(() => new Date(timestamp)).not.toThrow();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
