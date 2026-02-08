/**
 * SHEEP AI - Consolidator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runConsolidation } from "./consolidator.js";
import { SheepDatabase } from "../memory/database.js";

describe("Consolidator", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `sheep-consolidator-test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("runConsolidation", () => {
    it("runs consolidation in dry-run mode", async () => {
      const result = await runConsolidation({
        agentId: "test-agent",
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.runId).toBe("dry-run");
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it("tracks progress during consolidation", async () => {
      const progressUpdates: { stage: string; current: number; total: number }[] = [];

      await runConsolidation({
        agentId: "test-agent",
        dryRun: true,
        onProgress: (stage, current, total) => {
          progressUpdates.push({ stage, current, total });
        },
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates.some((p) => p.stage === "Extracting episodes")).toBe(true);
    });

    it("returns zero counts when no sessions exist", async () => {
      const result = await runConsolidation({
        agentId: "nonexistent-agent",
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.sessionsProcessed).toBe(0);
      expect(result.episodesExtracted).toBe(0);
      expect(result.factsExtracted).toBe(0);
    });
  });

  describe("getMemoryStats", () => {
    it("returns stats for an agent", () => {
      // Create a database with some data
      const db = new SheepDatabase("stats-test-agent", testDir);
      db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "Test episode",
        participants: ["user"],
        topic: "Test",
        keywords: ["test"],
        emotionalSalience: 0.5,
        utilityScore: 0.5,
        sourceSessionId: "sess-001",
        sourceMessageIds: ["msg-1"],
        ttl: "30d",
      });
      db.insertFact({
        subject: "user",
        predicate: "uses",
        object: "test",
        confidence: 0.8,
        evidence: ["ep-001"],
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
        userAffirmed: false,
      });
      db.close();

      // Get stats using the helper
      const db2 = new SheepDatabase("stats-test-agent", testDir);
      const stats = db2.getStats();
      db2.close();

      expect(stats.agentId).toBe("stats-test-agent");
      expect(stats.totalEpisodes).toBe(1);
      expect(stats.totalFacts).toBe(1);
    });
  });

  describe("queryFacts", () => {
    it("queries facts by subject", () => {
      const db = new SheepDatabase("query-test-agent", testDir);
      db.insertFact({
        subject: "user",
        predicate: "prefers",
        object: "typescript",
        confidence: 0.9,
        evidence: [],
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
        userAffirmed: true,
      });
      db.insertFact({
        subject: "project",
        predicate: "uses",
        object: "react",
        confidence: 0.8,
        evidence: [],
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
        userAffirmed: false,
      });
      db.close();

      const db2 = new SheepDatabase("query-test-agent", testDir);
      const userFacts = db2.findFacts({ subject: "user" });
      db2.close();

      expect(userFacts).toHaveLength(1);
      expect(userFacts[0].predicate).toBe("prefers");
    });
  });

  describe("queryEpisodes", () => {
    it("queries episodes by topic", () => {
      const db = new SheepDatabase("episode-query-agent", testDir);
      db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "Discussed TypeScript features",
        participants: ["user", "assistant"],
        topic: "TypeScript",
        keywords: ["typescript", "features"],
        emotionalSalience: 0.6,
        utilityScore: 0.8,
        sourceSessionId: "sess-001",
        sourceMessageIds: ["msg-1"],
        ttl: "30d",
      });
      db.insertEpisode({
        timestamp: new Date().toISOString(),
        summary: "Talked about weather",
        participants: ["user", "assistant"],
        topic: "Weather",
        keywords: ["weather", "sunny"],
        emotionalSalience: 0.3,
        utilityScore: 0.2,
        sourceSessionId: "sess-002",
        sourceMessageIds: ["msg-2"],
        ttl: "7d",
      });
      db.close();

      const db2 = new SheepDatabase("episode-query-agent", testDir);
      const tsEpisodes = db2.queryEpisodes({ topic: "TypeScript" });
      db2.close();

      expect(tsEpisodes).toHaveLength(1);
      expect(tsEpisodes[0].summary).toContain("TypeScript");
    });

    it("queries episodes by minimum salience", () => {
      const db = new SheepDatabase("salience-query-agent", testDir);
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
        summary: "Casual chat",
        participants: ["user"],
        topic: "Casual",
        keywords: [],
        emotionalSalience: 0.2,
        utilityScore: 0.3,
        sourceSessionId: "sess-002",
        sourceMessageIds: [],
        ttl: "7d",
      });
      db.close();

      const db2 = new SheepDatabase("salience-query-agent", testDir);
      const important = db2.queryEpisodes({ minSalience: 0.7 });
      db2.close();

      expect(important).toHaveLength(1);
      expect(important[0].topic).toBe("Important");
    });
  });
});
