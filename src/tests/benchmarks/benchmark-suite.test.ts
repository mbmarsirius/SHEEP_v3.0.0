/**
 * SHEEP AI - Benchmark Suite Tests
 */

import { describe, it, expect } from "vitest";
import {
  calculateMetrics,
  runBenchmarkCase,
  runBenchmarkSuite,
  compareBenchmarks,
  formatBenchmarkReport,
  createMockFactsForBenchmark,
  createMockEpisodesForBenchmark,
  STANDARD_BENCHMARK_CASES,
} from "./benchmark-suite.js";
import type { BenchmarkCase, BenchmarkSummary } from "./benchmark-suite.js";
import type { Fact } from "../../memory/schema.js";
import { generateId, now } from "../../memory/schema.js";

describe("Benchmark Suite", () => {
  describe("calculateMetrics", () => {
    it("returns perfect scores for matching results", () => {
      const expected = ["color", "blue"];
      const retrieved = ["user favorite_color blue", "something about color"];

      const metrics = calculateMetrics(expected, retrieved);

      expect(metrics.precision).toBeGreaterThan(0);
      expect(metrics.recall).toBeGreaterThan(0);
      expect(metrics.f1Score).toBeGreaterThan(0);
    });

    it("returns zero recall for no matches", () => {
      const expected = ["foo", "bar"];
      const retrieved = ["completely different"];

      const metrics = calculateMetrics(expected, retrieved);

      expect(metrics.recall).toBe(0);
    });

    it("handles empty expected", () => {
      const metrics = calculateMetrics([], ["retrieved"]);

      expect(metrics.precision).toBe(0);
      expect(metrics.recall).toBe(1);
    });

    it("handles empty retrieved", () => {
      const metrics = calculateMetrics(["expected"], []);

      expect(metrics.precision).toBe(0);
      expect(metrics.recall).toBe(0);
      expect(metrics.f1Score).toBe(0);
    });

    it("handles both empty", () => {
      const metrics = calculateMetrics([], []);

      expect(metrics.precision).toBe(1);
      expect(metrics.recall).toBe(1);
      expect(metrics.f1Score).toBe(1);
    });

    it("calculates F1 correctly", () => {
      // If we have 50% precision and 100% recall
      // F1 = 2 * (0.5 * 1.0) / (0.5 + 1.0) = 2 * 0.5 / 1.5 ≈ 0.667
      const expected = ["a"];
      const retrieved = ["a", "b"]; // One match, one extra

      const metrics = calculateMetrics(expected, retrieved);

      expect(metrics.recall).toBe(1); // Found the expected item
      expect(metrics.precision).toBe(0.5); // Half of retrieved were relevant
      expect(metrics.f1Score).toBeCloseTo(0.667, 1);
    });
  });

  describe("runBenchmarkCase", () => {
    it("runs a benchmark case with mock queries", () => {
      const testCase: BenchmarkCase = {
        id: "test-1",
        name: "Test case",
        description: "A test",
        input: "What is my favorite color?",
        expectedFacts: ["favorite_color"],
        tags: ["test"],
      };

      const mockFact: Fact = {
        id: generateId("fact"),
        subject: "user",
        predicate: "favorite_color",
        object: "blue",
        confidence: 0.9,
        evidence: [],
        isActive: true,
        userAffirmed: true,
        createdAt: now(),
        updatedAt: now(),
      };

      const result = runBenchmarkCase(
        testCase,
        () => [mockFact],
        () => [],
      );

      expect(result.caseId).toBe("test-1");
      expect(result.metrics.queryTimeMs).toBeDefined();
      expect(result.retrieved.facts).toHaveLength(1);
    });

    it("passes when F1 exceeds threshold", () => {
      const testCase: BenchmarkCase = {
        id: "test-2",
        name: "Test case",
        description: "A test",
        input: "What is my name?",
        expectedFacts: ["name"],
        tags: ["test"],
      };

      const mockFact: Fact = {
        id: generateId("fact"),
        subject: "user",
        predicate: "name",
        object: "Alice",
        confidence: 0.95,
        evidence: [],
        isActive: true,
        userAffirmed: true,
        createdAt: now(),
        updatedAt: now(),
      };

      const result = runBenchmarkCase(
        testCase,
        () => [mockFact],
        () => [],
        { passThreshold: 0.5 },
      );

      expect(result.passed).toBe(true);
    });

    it("fails when no results match", () => {
      const testCase: BenchmarkCase = {
        id: "test-3",
        name: "Test case",
        description: "A test",
        input: "What is my favorite programming language?",
        expectedFacts: ["favorite_language", "prefers"],
        tags: ["test"],
      };

      const result = runBenchmarkCase(
        testCase,
        () => [], // No facts returned
        () => [],
        { passThreshold: 0.5 },
      );

      expect(result.passed).toBe(false);
    });
  });

  describe("runBenchmarkSuite", () => {
    it("runs multiple cases and aggregates results", () => {
      const cases: BenchmarkCase[] = [
        {
          id: "case-1",
          name: "Case 1",
          description: "First case",
          input: "What is my color?",
          expectedFacts: ["color"],
          tags: ["simple"],
        },
        {
          id: "case-2",
          name: "Case 2",
          description: "Second case",
          input: "What is my name?",
          expectedFacts: ["name"],
          tags: ["simple"],
        },
      ];

      const facts = createMockFactsForBenchmark();

      const summary = runBenchmarkSuite(
        cases,
        () => facts,
        () => [],
      );

      expect(summary.totalCases).toBe(2);
      expect(summary.results).toHaveLength(2);
      expect(summary.timestamp).toBeDefined();
    });

    it("filters cases by includeTags", () => {
      const cases: BenchmarkCase[] = [
        { id: "1", name: "A", description: "", input: "", tags: ["include"] },
        { id: "2", name: "B", description: "", input: "", tags: ["exclude"] },
      ];

      const summary = runBenchmarkSuite(
        cases,
        () => [],
        () => [],
        { includeTags: ["include"] },
      );

      expect(summary.totalCases).toBe(1);
    });

    it("filters cases by excludeTags", () => {
      const cases: BenchmarkCase[] = [
        { id: "1", name: "A", description: "", input: "", tags: ["keep"] },
        { id: "2", name: "B", description: "", input: "", tags: ["remove"] },
      ];

      const summary = runBenchmarkSuite(
        cases,
        () => [],
        () => [],
        { excludeTags: ["remove"] },
      );

      expect(summary.totalCases).toBe(1);
    });

    it("groups results by tag", () => {
      const cases: BenchmarkCase[] = [
        { id: "1", name: "A", description: "", input: "", tags: ["fact"] },
        { id: "2", name: "B", description: "", input: "", tags: ["fact"] },
        { id: "3", name: "C", description: "", input: "", tags: ["episode"] },
      ];

      const summary = runBenchmarkSuite(
        cases,
        () => [],
        () => [],
      );

      expect(summary.byTag["fact"].count).toBe(2);
      expect(summary.byTag["episode"].count).toBe(1);
    });
  });

  describe("compareBenchmarks", () => {
    it("detects improvement in F1 score", () => {
      const baseline: BenchmarkSummary = {
        totalCases: 10,
        passedCases: 5,
        passRate: 0.5,
        averageMetrics: {
          precision: 0.5,
          recall: 0.5,
          f1Score: 0.5,
          queryTimeMs: 10,
        },
        byTag: {},
        results: [],
        timestamp: now(),
        totalDurationMs: 100,
      };

      const experimental: BenchmarkSummary = {
        ...baseline,
        passedCases: 8,
        passRate: 0.8,
        averageMetrics: {
          ...baseline.averageMetrics,
          f1Score: 0.7,
        },
      };

      const comparison = compareBenchmarks(baseline, experimental);

      expect(comparison.improved).toBe(true);
      expect(comparison.f1Delta).toBeCloseTo(0.2);
    });

    it("detects no improvement when F1 decreases", () => {
      const baseline: BenchmarkSummary = {
        totalCases: 10,
        passedCases: 8,
        passRate: 0.8,
        averageMetrics: {
          precision: 0.8,
          recall: 0.8,
          f1Score: 0.8,
          queryTimeMs: 10,
        },
        byTag: {},
        results: [],
        timestamp: now(),
        totalDurationMs: 100,
      };

      const experimental: BenchmarkSummary = {
        ...baseline,
        passedCases: 5,
        passRate: 0.5,
        averageMetrics: {
          ...baseline.averageMetrics,
          f1Score: 0.5,
        },
      };

      const comparison = compareBenchmarks(baseline, experimental);

      expect(comparison.improved).toBe(false);
      expect(comparison.f1Delta).toBeLessThan(0);
    });

    it("considers faster query time as improvement when F1 is equal", () => {
      const baseline: BenchmarkSummary = {
        totalCases: 10,
        passedCases: 8,
        passRate: 0.8,
        averageMetrics: {
          precision: 0.8,
          recall: 0.8,
          f1Score: 0.8,
          queryTimeMs: 20,
        },
        byTag: {},
        results: [],
        timestamp: now(),
        totalDurationMs: 100,
      };

      const experimental: BenchmarkSummary = {
        ...baseline,
        averageMetrics: {
          ...baseline.averageMetrics,
          queryTimeMs: 5, // Faster
        },
      };

      const comparison = compareBenchmarks(baseline, experimental);

      expect(comparison.improved).toBe(true);
      expect(comparison.queryTimeDelta).toBeLessThan(0);
    });
  });

  describe("formatBenchmarkReport", () => {
    it("generates a readable report", () => {
      const summary: BenchmarkSummary = {
        totalCases: 10,
        passedCases: 8,
        passRate: 0.8,
        averageMetrics: {
          precision: 0.75,
          recall: 0.8,
          f1Score: 0.77,
          queryTimeMs: 5.5,
        },
        byTag: {
          fact: { count: 5, passRate: 90, avgF1: 0.85 },
          episode: { count: 3, passRate: 66.7, avgF1: 0.7 },
        },
        results: [],
        timestamp: now(),
        totalDurationMs: 150,
      };

      const report = formatBenchmarkReport(summary);

      expect(report).toContain("BENCHMARK REPORT");
      expect(report).toContain("Total Cases: 10");
      expect(report).toContain("Passed: 8");
      expect(report).toContain("F1 Score");
      expect(report).toContain("fact:");
      expect(report).toContain("episode:");
    });
  });

  describe("Mock data generators", () => {
    it("creates mock facts", () => {
      const facts = createMockFactsForBenchmark();

      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].subject).toBe("user");
      expect(facts[0].predicate).toBeDefined();
    });

    it("creates mock episodes", () => {
      const episodes = createMockEpisodesForBenchmark();

      expect(episodes.length).toBeGreaterThan(0);
      expect(episodes[0].summary).toBeDefined();
      expect(episodes[0].keywords.length).toBeGreaterThan(0);
    });
  });

  describe("Standard benchmark cases", () => {
    it("has valid test cases", () => {
      expect(STANDARD_BENCHMARK_CASES.length).toBeGreaterThan(0);

      for (const testCase of STANDARD_BENCHMARK_CASES) {
        expect(testCase.id).toBeDefined();
        expect(testCase.name).toBeDefined();
        expect(testCase.input).toBeDefined();
        expect(testCase.tags.length).toBeGreaterThan(0);
      }
    });

    it("includes various test categories", () => {
      const allTags = STANDARD_BENCHMARK_CASES.flatMap((c) => c.tags);
      const uniqueTags = [...new Set(allTags)];

      expect(uniqueTags).toContain("fact");
      expect(uniqueTags).toContain("episode");
      expect(uniqueTags).toContain("simple");
      expect(uniqueTags).toContain("performance");
    });
  });
});
