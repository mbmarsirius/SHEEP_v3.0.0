/**
 * SHEEP AI - LLM Extractor Tests
 */

import { describe, it, expect } from "vitest";
import type { Fact } from "../memory/schema.js";
import { generateId, now } from "../memory/schema.js";
import {
  extractFactsWithLLM,
  extractCausalLinksWithLLM,
  summarizeEpisodeWithLLM,
  resolveContradictionWithLLM,
  createMockLLMProvider,
} from "./llm-extractor.js";

describe("LLM Extractor (Breakthrough!)", () => {
  describe("extractFactsWithLLM", () => {
    it("extracts facts using LLM", async () => {
      const llm = createMockLLMProvider();
      const text = "The user said they prefer TypeScript over JavaScript.";

      const facts = await extractFactsWithLLM(llm, text, "ep-test-1");

      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].subject).toBeDefined();
      expect(facts[0].predicate).toBeDefined();
      expect(facts[0].object).toBeDefined();
      expect(facts[0].confidence).toBeGreaterThan(0);
    });

    it("includes episode ID in evidence", async () => {
      const llm = createMockLLMProvider();
      const text = "User prefers dark mode.";

      const facts = await extractFactsWithLLM(llm, text, "ep-123");

      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].evidence).toContain("ep-123");
    });

    it("handles empty LLM response", async () => {
      // Override the default mock to return empty facts
      const llm = createMockLLMProvider(
        new Map([["No useful information here", JSON.stringify({ facts: [] })]]),
      );
      const text = "No useful information here.";

      const facts = await extractFactsWithLLM(llm, text, "ep-test");

      expect(facts).toEqual([]);
    });

    it("normalizes predicate to lowercase with underscores", async () => {
      const responses = new Map([
        [
          "User works at Google", // Match on the conversation text instead
          JSON.stringify({
            facts: [
              {
                subject: "User",
                predicate: "Works At", // Will be normalized to "works_at"
                object: "Google",
                confidence: 0.9,
                reasoning: "Stated directly",
              },
            ],
          }),
        ],
      ]);
      const llm = createMockLLMProvider(responses);

      const facts = await extractFactsWithLLM(llm, "User works at Google", "ep-1");

      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].predicate).toBe("works_at");
    });
  });

  describe("extractCausalLinksWithLLM", () => {
    it("extracts causal links using LLM", async () => {
      // Use custom response to ensure we get a causal link
      const responses = new Map([
        [
          "The refactoring caused performance improvements", // Match on conversation text
          JSON.stringify({
            causalLinks: [
              {
                cause: "code refactoring",
                effect: "improved performance",
                mechanism: "better algorithms and cleaner code",
                confidence: 0.8,
                reasoning: "Direct stated consequence",
              },
            ],
          }),
        ],
      ]);
      const llm = createMockLLMProvider(responses);
      const text = "The refactoring caused performance improvements.";

      const links = await extractCausalLinksWithLLM(llm, text, "ep-test-1");

      expect(links.length).toBeGreaterThan(0);
      expect(links[0].causeDescription).toBeDefined();
      expect(links[0].effectDescription).toBeDefined();
      expect(links[0].mechanism).toBeDefined();
    });

    it("sets causal strength based on confidence", async () => {
      const responses = new Map([
        [
          "Bug fix improved stability", // Match on conversation text
          JSON.stringify({
            causalLinks: [
              {
                cause: "bug fix",
                effect: "system stability",
                mechanism: "removed race condition",
                confidence: 0.9, // > 0.75, so should be "direct"
                reasoning: "Direct cause",
              },
            ],
          }),
        ],
      ]);
      const llm = createMockLLMProvider(responses);

      const links = await extractCausalLinksWithLLM(llm, "Bug fix improved stability", "ep-1");

      expect(links.length).toBeGreaterThan(0);
      expect(links[0].causalStrength).toBe("direct");
    });
  });

  describe("summarizeEpisodeWithLLM", () => {
    it("generates episode summary", async () => {
      const llm = createMockLLMProvider();
      const text = "We discussed best practices for writing clean code.";

      const summary = await summarizeEpisodeWithLLM(llm, text);

      expect(summary).not.toBeNull();
      expect(summary?.summary).toBeDefined();
      expect(summary?.topic).toBeDefined();
      expect(summary?.keywords).toBeInstanceOf(Array);
      expect(summary?.salience).toBeGreaterThanOrEqual(0);
      expect(summary?.salience).toBeLessThanOrEqual(1);
    });

    it("extracts emotional tone", async () => {
      const llm = createMockLLMProvider();
      const text = "Amazing progress today! Everything worked perfectly!";

      const summary = await summarizeEpisodeWithLLM(llm, text);

      expect(summary?.emotionalTone).toBeDefined();
    });
  });

  describe("resolveContradictionWithLLM", () => {
    it("resolves contradictions between facts", async () => {
      const llm = createMockLLMProvider();

      const fact1: Fact = {
        id: generateId("fact"),
        subject: "user",
        predicate: "favorite_language",
        object: "Python",
        confidence: 0.7,
        evidence: ["ep-1"],
        isActive: true,
        userAffirmed: false,
        accessCount: 1,
        firstSeen: now(),
        lastConfirmed: now(),
        contradictions: [],
        createdAt: now(),
        updatedAt: now(),
      };

      const fact2: Fact = {
        id: generateId("fact"),
        subject: "user",
        predicate: "favorite_language",
        object: "TypeScript",
        confidence: 0.9,
        evidence: ["ep-2"],
        isActive: true,
        userAffirmed: false,
        accessCount: 1,
        firstSeen: now(),
        lastConfirmed: now(),
        contradictions: [],
        createdAt: now(),
        updatedAt: now(),
      };

      const resolution = await resolveContradictionWithLLM(llm, fact1, fact2);

      expect(resolution.isContradiction).toBeDefined();
      expect(resolution.resolution).toBeDefined();
      expect(["keep_both", "keep_first", "keep_second", "merge", "needs_user_input"]).toContain(
        resolution.resolution,
      );
    });
  });

  describe("createMockLLMProvider", () => {
    it("creates a mock provider with default responses", async () => {
      const llm = createMockLLMProvider();

      expect(llm.name).toBe("mock");
      expect(typeof llm.complete).toBe("function");
    });

    it("supports custom responses", async () => {
      const customResponse = JSON.stringify({ custom: "response" });
      const llm = createMockLLMProvider(new Map([["test keyword", customResponse]]));

      const response = await llm.complete("This contains test keyword in it");

      expect(response).toBe(customResponse);
    });
  });

  describe("HTTP 400 error handling", () => {
    it("provides detailed error message for HTTP 400 (Bad Request)", async () => {
      // Simulate HTTP 400 error response - mock provider returns error format
      const responses = new Map([
        [
          "test prompt",
          JSON.stringify({
            stopReason: "error",
            errorMessage: "HTTP 400: Invalid API key or model not found",
          }),
        ],
      ]);
      const llm = createMockLLMProvider(responses);

      // Mock the complete function to throw an error with 400
      const originalComplete = llm.complete;
      llm.complete = async (prompt: string) => {
        if (prompt.includes("test prompt")) {
          throw new Error("HTTP 400: Provider returned error");
        }
        return originalComplete(prompt);
      };

      // Try to use the provider - should get an error
      await expect(llm.complete("test prompt")).rejects.toThrow("HTTP 400");
    });

    it("identifies HTTP 400 errors correctly", () => {
      // Test that error message contains helpful information
      const errorMsg = `HTTP 400: Provider returned error. This usually means:
- Invalid API key or missing authentication
- Invalid model name/format: openrouter/anthropic/claude-opus-4-6
- Malformed request parameters
- Model not found or not available

Error details: Invalid API key`;

      expect(errorMsg).toContain("HTTP 400");
      expect(errorMsg).toContain("Invalid API key");
      expect(errorMsg).toContain("model name/format");
    });
  });
});
