/**
 * Causal Link Extraction Tests
 * Tests that cause-effect relationships are extracted correctly
 */

import { describe, test, expect } from "vitest";
import type { LLMProvider } from "../extraction/llm-extractor.js";
import { extractCausalLinksWithLLM, createMockLLMProvider } from "../extraction/llm-extractor.js";

describe("Causal Link Extraction", () => {
  test("extracts cause-effect relationships", async () => {
    const episode = {
      summary:
        "Alice missed the deadline because her computer crashed. This caused the project to be delayed.",
      messages: [
        {
          id: "msg1",
          role: "user" as const,
          content: "Alice missed the deadline because her computer crashed.",
          timestamp: Date.now(),
        },
        {
          id: "msg2",
          role: "assistant" as const,
          content: "This caused the project to be delayed.",
          timestamp: Date.now(),
        },
      ],
    };

    const mockLLM: LLMProvider = createMockLLMProvider(
      new Map([
        [
          episode.summary,
          JSON.stringify({
            causalLinks: [
              {
                cause: "Alice's computer crashed",
                effect: "Alice missed the deadline",
                mechanism: "Hardware failure prevented work completion",
                confidence: 0.85,
                reasoning: "Direct cause-effect relationship",
              },
              {
                cause: "Alice missed the deadline",
                effect: "project was delayed",
                mechanism: "Missing deadline caused project timeline to slip",
                confidence: 0.8,
                reasoning: "Sequential cause-effect chain",
              },
            ],
          }),
        ],
      ]),
    );

    const links = await extractCausalLinksWithLLM(mockLLM, episode.summary, "ep-test-1");

    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveProperty("causeDescription");
    expect(links[0]).toHaveProperty("effectDescription");
    expect(links[0]).toHaveProperty("mechanism");
    expect(links[0].confidence).toBeGreaterThan(0.5);
    expect(links[0].causeDescription).toContain("computer crashed");
    expect(links[0].effectDescription).toContain("deadline");
  });

  test("extracts multiple causal links from complex episode", async () => {
    const text =
      "The server crashed due to high load. This caused data loss. The team then implemented caching to prevent future issues.";

    const mockLLM: LLMProvider = createMockLLMProvider(
      new Map([
        [
          text,
          JSON.stringify({
            causalLinks: [
              {
                cause: "high server load",
                effect: "server crashed",
                mechanism: "Resource exhaustion from excessive requests",
                confidence: 0.9,
                reasoning: "Direct technical cause",
              },
              {
                cause: "server crashed",
                effect: "data loss occurred",
                mechanism: "Unplanned shutdown caused data corruption",
                confidence: 0.85,
                reasoning: "Sequential effect",
              },
              {
                cause: "server crash and data loss",
                effect: "team implemented caching",
                mechanism: "Incident analysis led to preventive measure",
                confidence: 0.75,
                reasoning: "Reactive solution",
              },
            ],
          }),
        ],
      ]),
    );

    const links = await extractCausalLinksWithLLM(mockLLM, text, "ep-test-2");

    expect(links.length).toBeGreaterThanOrEqual(2);

    // Verify structure
    for (const link of links) {
      expect(link).toHaveProperty("causeDescription");
      expect(link).toHaveProperty("effectDescription");
      expect(link).toHaveProperty("mechanism");
      expect(link).toHaveProperty("causeType");
      expect(link).toHaveProperty("effectType");
      expect(link.confidence).toBeGreaterThan(0.5);
      expect(typeof link.causeDescription).toBe("string");
      expect(typeof link.effectDescription).toBe("string");
      expect(typeof link.mechanism).toBe("string");
    }
  });

  test("filters low-confidence causal links", async () => {
    const text = "Something might have caused something else, but we're not sure.";

    const mockLLM: LLMProvider = createMockLLMProvider(
      new Map([
        [
          text,
          JSON.stringify({
            causalLinks: [
              {
                cause: "something",
                effect: "something else",
                mechanism: "uncertain relationship",
                confidence: 0.3, // Below threshold
                reasoning: "Low confidence speculation",
              },
            ],
          }),
        ],
      ]),
    );

    const links = await extractCausalLinksWithLLM(mockLLM, text, "ep-test-3");

    // Low confidence links should be filtered out
    expect(links.length).toBe(0);
  });

  test("handles empty response gracefully", async () => {
    const text = "This is just a simple statement with no causal relationships.";

    const mockLLM: LLMProvider = createMockLLMProvider(
      new Map([
        [
          text,
          JSON.stringify({
            causalLinks: [],
          }),
        ],
      ]),
    );

    const links = await extractCausalLinksWithLLM(mockLLM, text, "ep-test-4");

    expect(links).toEqual([]);
  });
});
