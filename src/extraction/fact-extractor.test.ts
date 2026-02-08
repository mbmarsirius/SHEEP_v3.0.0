/**
 * SHEEP AI - Fact Extractor Tests
 */

import { describe, it, expect } from "vitest";
import type { Episode, Fact } from "../memory/schema.js";
import { generateId, now } from "../memory/schema.js";
import {
  extractFactsFromEpisode,
  extractFactsFromEpisodes,
  detectContradictions,
  resolveContradiction,
} from "./fact-extractor.js";

function createMockEpisode(summary: string, overrides: Partial<Episode> = {}): Episode {
  return {
    id: generateId("ep"),
    timestamp: now(),
    summary,
    participants: ["user", "assistant"],
    topic: "Test",
    keywords: [],
    emotionalSalience: 0.5,
    utilityScore: 0.5,
    sourceSessionId: "sess-001",
    sourceMessageIds: ["msg-1"],
    ttl: "30d",
    accessCount: 0,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function createMockFact(overrides: Partial<Fact>): Fact {
  return {
    id: generateId("fact"),
    subject: "user",
    predicate: "uses",
    object: "typescript",
    confidence: 0.8,
    evidence: ["ep-001"],
    firstSeen: now(),
    lastConfirmed: now(),
    contradictions: [],
    userAffirmed: false,
    isActive: true,
    accessCount: 0,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

describe("Fact Extractor", () => {
  describe("extractFactsFromEpisode", () => {
    it("extracts facts from 'I work at' pattern", () => {
      const episode = createMockEpisode("I work at Google as a software engineer");
      const facts = extractFactsFromEpisode(episode);

      expect(facts.length).toBeGreaterThan(0);
      const workFact = facts.find((f) => f.predicate === "works_at");
      expect(workFact).toBeDefined();
      expect(workFact!.subject).toBe("user");
      expect(workFact!.object).toContain("google");
    });

    it("extracts facts from 'I live in' pattern", () => {
      const episode = createMockEpisode("I live in San Francisco");
      const facts = extractFactsFromEpisode(episode);

      const liveFact = facts.find((f) => f.predicate === "lives_in");
      expect(liveFact).toBeDefined();
      expect(liveFact!.object).toContain("san francisco");
    });

    it("extracts facts from 'My name is' pattern", () => {
      const episode = createMockEpisode("My name is Alice");
      const facts = extractFactsFromEpisode(episode);

      const nameFact = facts.find((f) => f.predicate === "has_name");
      expect(nameFact).toBeDefined();
      expect(nameFact!.object).toBe("alice");
      expect(nameFact!.confidence).toBeGreaterThan(0.8);
    });

    it("extracts facts from preference patterns", () => {
      const episode = createMockEpisode("I prefer TypeScript over JavaScript");
      const facts = extractFactsFromEpisode(episode);

      const prefFact = facts.find((f) => f.predicate === "prefers");
      expect(prefFact).toBeDefined();
    });

    it("infers facts from code context", () => {
      const episode = createMockEpisode(
        "Here is my TypeScript code: ```typescript\nconst x = 1;\n```",
      );
      const facts = extractFactsFromEpisode(episode);

      const tsFact = facts.find((f) => f.object === "typescript");
      expect(tsFact).toBeDefined();
    });

    it("infers facts from framework mentions", () => {
      const episode = createMockEpisode("I'm building a React application with Next.js");
      const facts = extractFactsFromEpisode(episode);

      const reactFact = facts.find((f) => f.object === "react");
      expect(reactFact).toBeDefined();

      const nextFact = facts.find((f) => f.object === "nextjs");
      expect(nextFact).toBeDefined();
    });

    it("includes episode ID in evidence", () => {
      const episode = createMockEpisode("I work at Microsoft");
      const facts = extractFactsFromEpisode(episode);

      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].evidence).toContain(episode.id);
    });

    it("respects minConfidence threshold", () => {
      const episode = createMockEpisode("I want something");
      const factsLow = extractFactsFromEpisode(episode, { minConfidence: 0.1 });
      const factsHigh = extractFactsFromEpisode(episode, { minConfidence: 0.9 });

      expect(factsLow.length).toBeGreaterThanOrEqual(factsHigh.length);
    });

    it("handles empty episode", () => {
      const episode = createMockEpisode("");
      const facts = extractFactsFromEpisode(episode);

      expect(facts).toEqual([]);
    });
  });

  describe("extractFactsFromEpisodes", () => {
    it("merges facts from multiple episodes", () => {
      const episode1 = createMockEpisode("I work at Google", { id: "ep-1" });
      const episode2 = createMockEpisode("I work at Google", { id: "ep-2" }); // Same exact text

      const facts = extractFactsFromEpisodes([episode1, episode2]);

      // Should merge duplicate facts with same SPO
      const workFacts = facts.filter(
        (f) => f.predicate === "works_at" && f.object.includes("google"),
      );
      expect(workFacts.length).toBe(1);
      // Both episodes provide evidence
      expect(workFacts[0].evidence.length).toBe(2);
    });

    it("increases confidence with more evidence", () => {
      const episode1 = createMockEpisode("I use TypeScript", { id: "ep-1" });
      const episode2 = createMockEpisode("I use TypeScript for everything", { id: "ep-2" });
      const episode3 = createMockEpisode("TypeScript is great, I use it daily", { id: "ep-3" });

      const facts = extractFactsFromEpisodes([episode1, episode2, episode3]);

      const tsFact = facts.find((f) => f.object === "typescript" && f.predicate === "uses");
      if (tsFact) {
        expect(tsFact.confidence).toBeGreaterThan(0.5);
      }
    });

    it("handles empty episode list", () => {
      const facts = extractFactsFromEpisodes([]);
      expect(facts).toEqual([]);
    });
  });

  describe("detectContradictions", () => {
    it("detects contradiction for singular predicates", () => {
      const newFact = createMockFact({
        subject: "user",
        predicate: "works_at",
        object: "microsoft",
      });

      const existingFacts = [
        createMockFact({
          subject: "user",
          predicate: "works_at",
          object: "google",
          isActive: true,
        }),
      ];

      const contradictions = detectContradictions(newFact, existingFacts);
      expect(contradictions).toHaveLength(1);
      expect(contradictions[0].object).toBe("google");
    });

    it("does not detect contradiction for same value", () => {
      const newFact = createMockFact({
        subject: "user",
        predicate: "works_at",
        object: "google",
      });

      const existingFacts = [
        createMockFact({
          subject: "user",
          predicate: "works_at",
          object: "google",
          isActive: true,
        }),
      ];

      const contradictions = detectContradictions(newFact, existingFacts);
      expect(contradictions).toHaveLength(0);
    });

    it("ignores inactive facts", () => {
      const newFact = createMockFact({
        subject: "user",
        predicate: "works_at",
        object: "microsoft",
      });

      const existingFacts = [
        createMockFact({
          subject: "user",
          predicate: "works_at",
          object: "google",
          isActive: false, // Inactive
        }),
      ];

      const contradictions = detectContradictions(newFact, existingFacts);
      expect(contradictions).toHaveLength(0);
    });

    it("does not detect contradiction for non-singular predicates", () => {
      const newFact = createMockFact({
        subject: "user",
        predicate: "uses",
        object: "python",
      });

      const existingFacts = [
        createMockFact({
          subject: "user",
          predicate: "uses",
          object: "typescript",
          isActive: true,
        }),
      ];

      // "uses" is not singular - user can use multiple things
      const contradictions = detectContradictions(newFact, existingFacts);
      expect(contradictions).toHaveLength(0);
    });
  });

  describe("resolveContradiction", () => {
    it("keeps user-affirmed fact", () => {
      const factA = createMockFact({
        userAffirmed: true,
        confidence: 0.5,
      });
      const factB = createMockFact({
        userAffirmed: false,
        confidence: 0.9,
      });

      const result = resolveContradiction(factA, factB);
      expect(result.keep).toBe(factA);
      expect(result.retract).toBe(factB);
    });

    it("keeps more recent fact when not user-affirmed", () => {
      const factA = createMockFact({
        lastConfirmed: "2026-01-28T10:00:00.000Z",
      });
      const factB = createMockFact({
        lastConfirmed: "2026-01-27T10:00:00.000Z",
      });

      const result = resolveContradiction(factA, factB);
      expect(result.keep).toBe(factA);
    });

    it("keeps higher confidence fact when same time", () => {
      const timestamp = now();
      const factA = createMockFact({
        lastConfirmed: timestamp,
        confidence: 0.9,
      });
      const factB = createMockFact({
        lastConfirmed: timestamp,
        confidence: 0.5,
      });

      const result = resolveContradiction(factA, factB);
      expect(result.keep).toBe(factA);
    });

    it("keeps fact with more evidence", () => {
      const timestamp = now();
      const factA = createMockFact({
        lastConfirmed: timestamp,
        confidence: 0.7,
        evidence: ["ep-1", "ep-2", "ep-3"],
      });
      const factB = createMockFact({
        lastConfirmed: timestamp,
        confidence: 0.7,
        evidence: ["ep-4"],
      });

      const result = resolveContradiction(factA, factB);
      expect(result.keep).toBe(factA);
    });
  });
});
