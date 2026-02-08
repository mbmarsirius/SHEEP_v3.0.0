/**
 * Coreference Resolution Tests
 * Tests that pronouns and relative times are resolved in fact extraction
 */

import { describe, test, expect } from "vitest";
import type { LLMProvider } from "../extraction/llm-extractor.js";
import { extractFactsWithLLM, createMockLLMProvider } from "../extraction/llm-extractor.js";

describe("Coreference Resolution", () => {
  test("pronouns are resolved", async () => {
    const text = "Alice said she will go to the store. He mentioned it was important.";

    // Mock LLM that should resolve pronouns
    const mockLLM: LLMProvider = createMockLLMProvider(
      new Map([
        [
          text,
          JSON.stringify({
            facts: [
              {
                subject: "Alice",
                predicate: "will_go_to",
                object: "the store",
                confidence: 0.9,
                reasoning: "Resolved 'she' to 'Alice'",
              },
              {
                subject: "Bob",
                predicate: "mentioned",
                object: "the store visit was important",
                confidence: 0.85,
                reasoning: "Resolved 'he' to 'Bob' and 'it' to 'the store visit'",
              },
            ],
          }),
        ],
      ]),
    );

    const facts = await extractFactsWithLLM(mockLLM, text, "ep-test-1");

    // No pronouns in extracted facts
    for (const fact of facts) {
      expect(fact.subject).not.toMatch(/\b(he|she|it|they|this|that|these|those)\b/i);
      expect(fact.object).not.toMatch(/\b(he|she|it|they|this|that|these|those)\b/i);
    }

    expect(facts.length).toBeGreaterThan(0);
  });

  test("relative times are absolute", async () => {
    const now = new Date("2025-02-04T15:00:00Z");
    const text = "Bob said he will arrive tomorrow at 3pm.";

    // Mock LLM that should resolve relative times
    const mockLLM: LLMProvider = createMockLLMProvider(
      new Map([
        [
          text,
          JSON.stringify({
            facts: [
              {
                subject: "Bob",
                predicate: "will_arrive_at",
                object: "2025-02-05T15:00:00",
                confidence: 0.9,
                reasoning: "Resolved 'tomorrow at 3pm' to absolute timestamp",
              },
            ],
          }),
        ],
      ]),
    );

    const facts = await extractFactsWithLLM(mockLLM, text, "ep-test-2", {
      timestamp: now.toISOString(),
    });

    // No relative times
    for (const fact of facts) {
      expect(fact.object).not.toMatch(
        /\b(yesterday|today|tomorrow|last week|next month|next year)\b/i,
      );
      // Should have ISO date format if it's a date
      if (fact.object.match(/\d{4}-\d{2}-\d{2}/)) {
        expect(fact.object).toMatch(/\d{4}-\d{2}-\d{2}/); // ISO date format
      }
    }
  });

  test("pronouns in subject are resolved", async () => {
    const text = "Alice works at TechCorp. She is a software engineer.";

    const mockLLM: LLMProvider = createMockLLMProvider(
      new Map([
        [
          text,
          JSON.stringify({
            facts: [
              {
                subject: "Alice",
                predicate: "works_at",
                object: "TechCorp",
                confidence: 0.95,
                reasoning: "Extracted from first sentence",
              },
              {
                subject: "Alice",
                predicate: "is",
                object: "a software engineer",
                confidence: 0.9,
                reasoning: "Resolved 'She' to 'Alice'",
              },
            ],
          }),
        ],
      ]),
    );

    const facts = await extractFactsWithLLM(mockLLM, text, "ep-test-3");

    // Verify no pronouns
    const hasPronouns = facts.some((f) =>
      /\b(he|she|it|they|this|that)\b/i.test(f.subject + " " + f.object),
    );
    expect(hasPronouns).toBe(false);
  });

  test("relative time expressions are converted", async () => {
    const now = new Date("2025-02-04T10:00:00Z");
    const text = "The project deadline is next week. We started it last month.";

    const mockLLM: LLMProvider = createMockLLMProvider(
      new Map([
        [
          text,
          JSON.stringify({
            facts: [
              {
                subject: "project",
                predicate: "deadline_is",
                object: "2025-02-11T00:00:00",
                confidence: 0.85,
                reasoning: "Resolved 'next week' to absolute date",
              },
              {
                subject: "project",
                predicate: "started_at",
                object: "2025-01-04T00:00:00",
                confidence: 0.8,
                reasoning: "Resolved 'last month' to absolute date",
              },
            ],
          }),
        ],
      ]),
    );

    const facts = await extractFactsWithLLM(mockLLM, text, "ep-test-4", {
      timestamp: now.toISOString(),
    });

    // Check that relative times are not present
    for (const fact of facts) {
      expect(fact.object).not.toMatch(/\b(next week|last month|yesterday|today|tomorrow)\b/i);
    }
  });
});
