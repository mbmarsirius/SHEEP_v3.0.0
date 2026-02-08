/**
 * SHEEP AI - Database Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SheepDatabase } from "./database.js";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("SheepDatabase", () => {
  let db: SheepDatabase;
  let testDir: string;

  beforeEach(() => {
    // Create a unique test directory
    testDir = join(tmpdir(), `sheep-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    mkdirSync(testDir, { recursive: true });
    db = new SheepDatabase("test-agent", testDir);
  });

  afterEach(() => {
    db.close();
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Episodes", () => {
    it("inserts and retrieves an episode", () => {
      const episode = db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "User discussed AI model preferences",
        participants: ["user", "assistant"],
        topic: "AI models",
        keywords: ["opus", "sonnet"],
        emotionalSalience: 0.5,
        utilityScore: 0.8,
        sourceSessionId: "sess-001",
        sourceMessageIds: ["msg-1", "msg-2"],
        ttl: "30d",
      });

      expect(episode.id).toMatch(/^ep-/);
      expect(episode.accessCount).toBe(0);

      const retrieved = db.getEpisode(episode.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.summary).toBe("User discussed AI model preferences");
      expect(retrieved!.participants).toEqual(["user", "assistant"]);
      expect(retrieved!.keywords).toEqual(["opus", "sonnet"]);
    });

    it("queries episodes by topic", () => {
      db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "AI model discussion",
        participants: ["user"],
        topic: "AI models",
        keywords: [],
        emotionalSalience: 0.5,
        utilityScore: 0.5,
        sourceSessionId: "sess-001",
        sourceMessageIds: [],
        ttl: "30d",
      });

      db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "Weather discussion",
        participants: ["user"],
        topic: "Weather",
        keywords: [],
        emotionalSalience: 0.3,
        utilityScore: 0.4,
        sourceSessionId: "sess-002",
        sourceMessageIds: [],
        ttl: "7d",
      });

      const aiEpisodes = db.queryEpisodes({ topic: "AI" });
      expect(aiEpisodes).toHaveLength(1);
      expect(aiEpisodes[0].topic).toBe("AI models");

      const weatherEpisodes = db.queryEpisodes({ topic: "Weather" });
      expect(weatherEpisodes).toHaveLength(1);
    });

    it("queries episodes by minimum salience", () => {
      db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "Important discussion",
        participants: ["user"],
        topic: "Important",
        keywords: [],
        emotionalSalience: 0.9,
        utilityScore: 0.8,
        sourceSessionId: "sess-001",
        sourceMessageIds: [],
        ttl: "permanent",
      });

      db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "Trivial discussion",
        participants: ["user"],
        topic: "Trivial",
        keywords: [],
        emotionalSalience: 0.2,
        utilityScore: 0.3,
        sourceSessionId: "sess-002",
        sourceMessageIds: [],
        ttl: "7d",
      });

      const importantEpisodes = db.queryEpisodes({ minSalience: 0.7 });
      expect(importantEpisodes).toHaveLength(1);
      expect(importantEpisodes[0].topic).toBe("Important");
    });

    it("tracks episode access", () => {
      const episode = db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "Test",
        participants: [],
        topic: "Test",
        keywords: [],
        emotionalSalience: 0.5,
        utilityScore: 0.5,
        sourceSessionId: "sess-001",
        sourceMessageIds: [],
        ttl: "30d",
      });

      expect(db.getEpisode(episode.id)!.accessCount).toBe(0);

      db.touchEpisode(episode.id);
      expect(db.getEpisode(episode.id)!.accessCount).toBe(1);

      db.touchEpisode(episode.id);
      db.touchEpisode(episode.id);
      expect(db.getEpisode(episode.id)!.accessCount).toBe(3);
    });

    it("deletes episodes", () => {
      const episode = db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "To be deleted",
        participants: [],
        topic: "Test",
        keywords: [],
        emotionalSalience: 0.5,
        utilityScore: 0.5,
        sourceSessionId: "sess-001",
        sourceMessageIds: [],
        ttl: "30d",
      });

      expect(db.getEpisode(episode.id)).not.toBeNull();

      const deleted = db.deleteEpisode(episode.id);
      expect(deleted).toBe(true);
      expect(db.getEpisode(episode.id)).toBeNull();

      // Deleting again should return false
      expect(db.deleteEpisode(episode.id)).toBe(false);
    });
  });

  describe("Facts", () => {
    it("inserts and retrieves a fact", () => {
      const fact = db.insertFact({
        subject: "user",
        predicate: "prefers",
        object: "Opus 4.5",
        confidence: 0.9,
        evidence: ["ep-001"],
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
        userAffirmed: true,
      });

      expect(fact.id).toMatch(/^fact-/);
      expect(fact.isActive).toBe(true);
      expect(fact.contradictions).toEqual([]);

      const retrieved = db.getFact(fact.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.subject).toBe("user");
      expect(retrieved!.predicate).toBe("prefers");
      expect(retrieved!.object).toBe("Opus 4.5");
    });

    it("finds facts by subject-predicate-object", () => {
      db.insertFact({
        subject: "user",
        predicate: "prefers",
        object: "Opus",
        confidence: 0.9,
        evidence: [],
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
        userAffirmed: false,
      });

      db.insertFact({
        subject: "user",
        predicate: "works_at",
        object: "Acme Corp",
        confidence: 0.95,
        evidence: [],
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
        userAffirmed: true,
      });

      db.insertFact({
        subject: "project",
        predicate: "uses",
        object: "TypeScript",
        confidence: 1.0,
        evidence: [],
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
        userAffirmed: true,
      });

      const userFacts = db.findFacts({ subject: "user" });
      expect(userFacts).toHaveLength(2);

      const prefersFacts = db.findFacts({ predicate: "prefers" });
      expect(prefersFacts).toHaveLength(1);
      expect(prefersFacts[0].object).toBe("Opus");

      const projectFacts = db.findFacts({ subject: "project", predicate: "uses" });
      expect(projectFacts).toHaveLength(1);
      expect(projectFacts[0].object).toBe("TypeScript");
    });

    it("updates fact confidence and records change", () => {
      const fact = db.insertFact({
        subject: "user",
        predicate: "prefers",
        object: "Opus",
        confidence: 0.7,
        evidence: [],
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
        userAffirmed: false,
      });

      db.updateFactConfidence(fact.id, 0.9, "User confirmed preference");

      const updated = db.getFact(fact.id);
      expect(updated!.confidence).toBe(0.9);

      // Check change was recorded
      const changes = db.getChangesFor("fact", fact.id);
      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe("strengthen");
      expect(changes[0].reason).toBe("User confirmed preference");
    });

    it("retracts facts", () => {
      const fact = db.insertFact({
        subject: "user",
        predicate: "prefers",
        object: "Sonnet",
        confidence: 0.8,
        evidence: [],
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
        userAffirmed: false,
      });

      expect(db.getFact(fact.id)!.isActive).toBe(true);

      db.retractFact(fact.id, "User switched to Opus");

      const retracted = db.getFact(fact.id);
      expect(retracted!.isActive).toBe(false);
      expect(retracted!.retractedReason).toBe("User switched to Opus");

      // Should not appear in active-only queries
      const activeFacts = db.findFacts({ subject: "user", activeOnly: true });
      expect(activeFacts).toHaveLength(0);

      // Should appear when including inactive
      const allFacts = db.findFacts({ subject: "user", activeOnly: false });
      expect(allFacts).toHaveLength(1);
    });
  });

  describe("Causal Links", () => {
    it("inserts and retrieves causal links", () => {
      const link = db.insertCausalLink({
        causeType: "fact",
        causeId: "fact-001",
        causeDescription: "Sonnet had injection issues",
        effectType: "fact",
        effectId: "fact-002",
        effectDescription: "User switched to Opus",
        mechanism: "Security concerns led to model change",
        confidence: 0.85,
        evidence: ["ep-001"],
        temporalDelay: "1d",
        causalStrength: "direct",
      });

      expect(link.id).toMatch(/^cl-/);

      const found = db.findCausalLinks({ causeId: "fact-001" });
      expect(found).toHaveLength(1);
      expect(found[0].mechanism).toBe("Security concerns led to model change");
    });

    it("queries causal chains", () => {
      // Create a causal chain: A -> B -> C
      db.insertCausalLink({
        causeType: "fact",
        causeId: "fact-A",
        causeDescription: "A happened",
        effectType: "fact",
        effectId: "fact-B",
        effectDescription: "B happened",
        mechanism: "A caused B",
        confidence: 0.9,
        evidence: [],
        causalStrength: "direct",
      });

      db.insertCausalLink({
        causeType: "fact",
        causeId: "fact-B",
        causeDescription: "B happened",
        effectType: "fact",
        effectId: "fact-C",
        effectDescription: "C happened",
        mechanism: "B caused C",
        confidence: 0.85,
        evidence: [],
        causalStrength: "direct",
      });

      // Query: why did C happen?
      const chain = db.queryCausalChain("fact-C");
      expect(chain.length).toBeGreaterThanOrEqual(2);

      // Should find B->C and A->B
      const mechanisms = chain.map((l) => l.mechanism);
      expect(mechanisms).toContain("B caused C");
      expect(mechanisms).toContain("A caused B");
    });
  });

  describe("Procedures", () => {
    it("inserts and retrieves procedures", () => {
      const proc = db.insertProcedure({
        trigger: "when debugging TypeScript",
        action: "use verbose output",
        expectedOutcome: "Bug is found faster",
        examples: ["ep-001"],
        tags: ["debugging", "typescript"],
      });

      expect(proc.id).toMatch(/^proc-/);
      expect(proc.successRate).toBe(0);
      expect(proc.timesUsed).toBe(0);

      const found = db.findProcedures({ triggerContains: "debugging" });
      expect(found).toHaveLength(1);
      expect(found[0].action).toBe("use verbose output");
    });

    it("records procedure usage and updates success rate", () => {
      const proc = db.insertProcedure({
        trigger: "test trigger",
        action: "test action",
        examples: [],
        tags: [],
      });

      // Use procedure 3 times: 2 successes, 1 failure
      db.recordProcedureUsage(proc.id, true);
      db.recordProcedureUsage(proc.id, true);
      db.recordProcedureUsage(proc.id, false);

      const found = db.findProcedures({ triggerContains: "test" });
      expect(found).toHaveLength(1);
      expect(found[0].timesUsed).toBe(3);
      expect(found[0].timesSucceeded).toBe(2);
      expect(found[0].successRate).toBeCloseTo(0.667, 2);
    });
  });

  describe("Consolidation Runs", () => {
    it("starts and completes a consolidation run", () => {
      const run = db.startConsolidationRun("2026-01-27T00:00:00.000Z", "2026-01-28T00:00:00.000Z");

      expect(run.id).toMatch(/^cr-/);
      expect(run.status).toBe("running");

      db.completeConsolidationRun(run.id, {
        sessionsProcessed: 10,
        episodesExtracted: 25,
        factsExtracted: 12,
        causalLinksExtracted: 5,
        proceduresExtracted: 3,
        contradictionsResolved: 2,
        memoriesPruned: 4,
      });

      const last = db.getLastConsolidationRun();
      expect(last).not.toBeNull();
      expect(last!.status).toBe("completed");
      expect(last!.episodesExtracted).toBe(25);
      expect(last!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("records failed consolidation runs", () => {
      const run = db.startConsolidationRun("2026-01-27T00:00:00.000Z", "2026-01-28T00:00:00.000Z");

      db.completeConsolidationRun(
        run.id,
        {
          sessionsProcessed: 5,
          episodesExtracted: 10,
          factsExtracted: 0,
          causalLinksExtracted: 0,
          proceduresExtracted: 0,
          contradictionsResolved: 0,
          memoriesPruned: 0,
        },
        "API rate limit exceeded",
      );

      const last = db.getLastConsolidationRun();
      expect(last!.status).toBe("failed");
      expect(last!.errorMessage).toBe("API rate limit exceeded");
    });
  });

  describe("Statistics", () => {
    it("returns accurate memory statistics", () => {
      // Insert some data
      db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "Test episode",
        participants: [],
        topic: "Test",
        keywords: [],
        emotionalSalience: 0.5,
        utilityScore: 0.5,
        sourceSessionId: "sess-001",
        sourceMessageIds: [],
        ttl: "30d",
      });

      db.insertFact({
        subject: "user",
        predicate: "test",
        object: "value",
        confidence: 0.8,
        evidence: [],
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
        userAffirmed: false,
      });

      db.insertCausalLink({
        causeType: "fact",
        causeId: "fact-001",
        causeDescription: "Cause",
        effectType: "fact",
        effectId: "fact-002",
        effectDescription: "Effect",
        mechanism: "Mechanism",
        confidence: 0.9,
        evidence: [],
        causalStrength: "direct",
      });

      db.insertProcedure({
        trigger: "trigger",
        action: "action",
        examples: [],
        tags: [],
      });

      const stats = db.getStats();
      expect(stats.agentId).toBe("test-agent");
      expect(stats.totalEpisodes).toBe(1);
      expect(stats.totalFacts).toBe(1);
      expect(stats.totalCausalLinks).toBe(1);
      expect(stats.totalProcedures).toBe(1);
      expect(stats.totalSizeBytes).toBeGreaterThan(0);
      expect(stats.averageFactConfidence).toBe(0.8);
    });
  });
});
