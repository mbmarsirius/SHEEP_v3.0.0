/**
 * SHEEP AI - Benchmark Suite
 *
 * Measures SHEEP AI performance against baseline memory systems.
 * This enables A/B testing and continuous improvement tracking.
 *
 * Key metrics:
 * - Retrieval accuracy (precision/recall)
 * - Response relevance
 * - Memory efficiency (storage, query time)
 * - Consolidation performance
 * - Prefetch hit rate
 *
 * @module sheep/tests/benchmarks/benchmark-suite
 */

import type { Episode, Fact } from "../../memory/schema.js";
import { generateId, now } from "../../memory/schema.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A single benchmark test case
 */
export type BenchmarkCase = {
  id: string;
  name: string;
  description: string;
  /** Input query/message */
  input: string;
  /** Expected facts that should be retrieved */
  expectedFacts?: string[];
  /** Expected episodes that should be retrieved */
  expectedEpisodes?: string[];
  /** Tags for categorizing test cases */
  tags: string[];
};

/**
 * Result of a single benchmark run
 */
export type BenchmarkResult = {
  caseId: string;
  /** Whether the expected results were found */
  passed: boolean;
  /** Retrieval metrics */
  metrics: {
    precision: number;
    recall: number;
    f1Score: number;
    queryTimeMs: number;
    totalRetrieved: number;
    expectedCount: number;
  };
  /** What was actually retrieved */
  retrieved: {
    facts: Fact[];
    episodes: Episode[];
  };
  /** Debug information */
  debug?: Record<string, unknown>;
};

/**
 * Aggregated benchmark results
 */
export type BenchmarkSummary = {
  /** Total test cases run */
  totalCases: number;
  /** Cases that passed */
  passedCases: number;
  /** Overall pass rate */
  passRate: number;
  /** Average metrics across all cases */
  averageMetrics: {
    precision: number;
    recall: number;
    f1Score: number;
    queryTimeMs: number;
  };
  /** Results by tag */
  byTag: Record<
    string,
    {
      count: number;
      passRate: number;
      avgF1: number;
    }
  >;
  /** Individual case results */
  results: BenchmarkResult[];
  /** Timestamp of benchmark run */
  timestamp: string;
  /** Duration of full benchmark in ms */
  totalDurationMs: number;
};

/**
 * Configuration for benchmark runs
 */
export type BenchmarkConfig = {
  /** Minimum F1 score to consider a case "passed" */
  passThreshold?: number;
  /** Tags to include (empty = all) */
  includeTags?: string[];
  /** Tags to exclude */
  excludeTags?: string[];
  /** Maximum query time before flagging slow */
  maxQueryTimeMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
};

// =============================================================================
// BENCHMARK TEST CASES
// =============================================================================

/**
 * Standard benchmark test cases for SHEEP AI
 */
export const STANDARD_BENCHMARK_CASES: BenchmarkCase[] = [
  // Fact retrieval tests
  {
    id: "fact-simple-1",
    name: "Simple fact lookup",
    description: "Retrieve a directly stated fact",
    input: "What is my favorite color?",
    expectedFacts: ["favorite_color"],
    tags: ["fact", "simple", "user-preference"],
  },
  {
    id: "fact-simple-2",
    name: "Name lookup",
    description: "Retrieve the user's name",
    input: "What is my name?",
    expectedFacts: ["name", "called"],
    tags: ["fact", "simple", "identity"],
  },
  {
    id: "fact-relation-1",
    name: "Relationship lookup",
    description: "Retrieve relationship facts",
    input: "Who is my manager?",
    expectedFacts: ["manager", "works_for", "reports_to"],
    tags: ["fact", "relationship"],
  },
  {
    id: "fact-temporal-1",
    name: "Temporal fact",
    description: "Fact with time context",
    input: "Where did I work before?",
    expectedFacts: ["worked_at", "previous_employer"],
    tags: ["fact", "temporal", "employment"],
  },

  // Episode retrieval tests
  {
    id: "episode-recent-1",
    name: "Recent conversation recall",
    description: "Retrieve recent episode",
    input: "What did we discuss yesterday?",
    expectedEpisodes: ["yesterday"],
    tags: ["episode", "temporal", "recent"],
  },
  {
    id: "episode-topic-1",
    name: "Topic-based retrieval",
    description: "Find episodes by topic",
    input: "What did we talk about regarding the project?",
    expectedEpisodes: ["project"],
    tags: ["episode", "topic"],
  },
  {
    id: "episode-reference-1",
    name: "Reference pattern",
    description: "Remember when pattern",
    input: "Remember when we debugged that issue?",
    expectedEpisodes: ["debug", "issue"],
    tags: ["episode", "reference"],
  },

  // Combined tests
  {
    id: "combined-1",
    name: "Fact + Episode",
    description: "Query needing both facts and episodes",
    input: "How does my preference for Python relate to our database discussion?",
    expectedFacts: ["prefers", "python"],
    expectedEpisodes: ["database"],
    tags: ["combined", "complex"],
  },

  // Edge cases
  {
    id: "edge-empty-1",
    name: "No relevant memory",
    description: "Query with no expected matches",
    input: "What is the airspeed velocity of an unladen swallow?",
    tags: ["edge", "no-match"],
  },
  {
    id: "edge-ambiguous-1",
    name: "Ambiguous query",
    description: "Query that could match multiple things",
    input: "Tell me about the thing we discussed",
    tags: ["edge", "ambiguous"],
  },

  // Performance tests
  {
    id: "perf-many-entities-1",
    name: "Many entities",
    description: "Query with multiple entities to look up",
    input: "What do Alice, Bob, and Charlie think about the API redesign?",
    expectedFacts: ["alice", "bob", "charlie", "api"],
    tags: ["performance", "multi-entity"],
  },
  {
    id: "perf-long-query-1",
    name: "Long query",
    description: "Very long input message",
    input:
      "I remember we had a very long discussion about software architecture, specifically about microservices versus monoliths, and we talked about the trade-offs, and you mentioned something about eventual consistency, can you remind me what that was?",
    expectedEpisodes: ["architecture", "microservices", "consistency"],
    tags: ["performance", "long-query"],
  },
];

// =============================================================================
// BENCHMARK RUNNER
// =============================================================================

/**
 * Calculate precision, recall, and F1 score
 */
export function calculateMetrics(
  expected: string[],
  retrieved: string[],
): { precision: number; recall: number; f1Score: number } {
  if (expected.length === 0 && retrieved.length === 0) {
    return { precision: 1, recall: 1, f1Score: 1 };
  }

  if (expected.length === 0) {
    // No expected results, precision is 0 if we retrieved anything
    return {
      precision: retrieved.length === 0 ? 1 : 0,
      recall: 1,
      f1Score: retrieved.length === 0 ? 1 : 0,
    };
  }

  if (retrieved.length === 0) {
    return { precision: 0, recall: 0, f1Score: 0 };
  }

  // Count matches (case-insensitive partial matching)
  const matches = expected.filter((exp) =>
    retrieved.some(
      (ret) =>
        ret.toLowerCase().includes(exp.toLowerCase()) ||
        exp.toLowerCase().includes(ret.toLowerCase()),
    ),
  );

  const precision = matches.length / retrieved.length;
  const recall = matches.length / expected.length;
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1Score };
}

/**
 * Run a single benchmark case
 */
export function runBenchmarkCase(
  testCase: BenchmarkCase,
  queryFacts: (query: string) => Fact[],
  queryEpisodes: (query: string) => Episode[],
  config: BenchmarkConfig = {},
): BenchmarkResult {
  const passThreshold = config.passThreshold ?? 0.5;
  const startTime = Date.now();

  // Run queries
  const facts = queryFacts(testCase.input);
  const episodes = queryEpisodes(testCase.input);
  const queryTimeMs = Date.now() - startTime;

  // Extract searchable strings from results
  const retrievedFactStrings = facts.map((f) =>
    `${f.subject} ${f.predicate} ${f.object}`.toLowerCase(),
  );
  const retrievedEpisodeStrings = episodes.map((e) =>
    `${e.summary} ${e.topic} ${e.keywords.join(" ")}`.toLowerCase(),
  );

  // Calculate metrics for facts
  const expectedFactStrings = testCase.expectedFacts ?? [];
  const factMetrics = calculateMetrics(expectedFactStrings, retrievedFactStrings);

  // Calculate metrics for episodes
  const expectedEpisodeStrings = testCase.expectedEpisodes ?? [];
  const episodeMetrics = calculateMetrics(expectedEpisodeStrings, retrievedEpisodeStrings);

  // Combined metrics (weighted average)
  const hasExpectedFacts = expectedFactStrings.length > 0;
  const hasExpectedEpisodes = expectedEpisodeStrings.length > 0;

  let combinedF1: number;
  let combinedPrecision: number;
  let combinedRecall: number;

  if (hasExpectedFacts && hasExpectedEpisodes) {
    combinedPrecision = (factMetrics.precision + episodeMetrics.precision) / 2;
    combinedRecall = (factMetrics.recall + episodeMetrics.recall) / 2;
    combinedF1 = (factMetrics.f1Score + episodeMetrics.f1Score) / 2;
  } else if (hasExpectedFacts) {
    combinedPrecision = factMetrics.precision;
    combinedRecall = factMetrics.recall;
    combinedF1 = factMetrics.f1Score;
  } else if (hasExpectedEpisodes) {
    combinedPrecision = episodeMetrics.precision;
    combinedRecall = episodeMetrics.recall;
    combinedF1 = episodeMetrics.f1Score;
  } else {
    // No expected results - pass if we didn't retrieve much
    combinedPrecision = facts.length + episodes.length < 3 ? 1 : 0.5;
    combinedRecall = 1;
    combinedF1 = combinedPrecision;
  }

  const passed = combinedF1 >= passThreshold;

  return {
    caseId: testCase.id,
    passed,
    metrics: {
      precision: combinedPrecision,
      recall: combinedRecall,
      f1Score: combinedF1,
      queryTimeMs,
      totalRetrieved: facts.length + episodes.length,
      expectedCount: expectedFactStrings.length + expectedEpisodeStrings.length,
    },
    retrieved: { facts, episodes },
  };
}

/**
 * Run the full benchmark suite
 */
export function runBenchmarkSuite(
  cases: BenchmarkCase[],
  queryFacts: (query: string) => Fact[],
  queryEpisodes: (query: string) => Episode[],
  config: BenchmarkConfig = {},
): BenchmarkSummary {
  const startTime = Date.now();
  const results: BenchmarkResult[] = [];

  // Filter cases by tags
  let filteredCases = cases;
  if (config.includeTags && config.includeTags.length > 0) {
    filteredCases = filteredCases.filter((c) =>
      c.tags.some((t) => config.includeTags!.includes(t)),
    );
  }
  if (config.excludeTags && config.excludeTags.length > 0) {
    filteredCases = filteredCases.filter(
      (c) => !c.tags.some((t) => config.excludeTags!.includes(t)),
    );
  }

  // Run each case
  for (const testCase of filteredCases) {
    const result = runBenchmarkCase(testCase, queryFacts, queryEpisodes, config);
    results.push(result);

    if (config.verbose) {
      console.log(
        `[${result.passed ? "PASS" : "FAIL"}] ${testCase.name} - F1: ${result.metrics.f1Score.toFixed(2)}`,
      );
    }
  }

  // Calculate summary
  const passedCases = results.filter((r) => r.passed).length;
  const passRate = results.length > 0 ? passedCases / results.length : 0;

  const avgPrecision =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.metrics.precision, 0) / results.length
      : 0;
  const avgRecall =
    results.length > 0 ? results.reduce((sum, r) => sum + r.metrics.recall, 0) / results.length : 0;
  const avgF1 =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.metrics.f1Score, 0) / results.length
      : 0;
  const avgQueryTime =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.metrics.queryTimeMs, 0) / results.length
      : 0;

  // Group by tag
  const byTag: BenchmarkSummary["byTag"] = {};
  for (const testCase of filteredCases) {
    const result = results.find((r) => r.caseId === testCase.id)!;
    for (const tag of testCase.tags) {
      if (!byTag[tag]) {
        byTag[tag] = { count: 0, passRate: 0, avgF1: 0 };
      }
      byTag[tag].count++;
      byTag[tag].avgF1 =
        (byTag[tag].avgF1 * (byTag[tag].count - 1) + result.metrics.f1Score) / byTag[tag].count;
      if (result.passed) {
        byTag[tag].passRate =
          ((byTag[tag].passRate * (byTag[tag].count - 1) + 1) / byTag[tag].count) * 100;
      }
    }
  }

  return {
    totalCases: results.length,
    passedCases,
    passRate,
    averageMetrics: {
      precision: avgPrecision,
      recall: avgRecall,
      f1Score: avgF1,
      queryTimeMs: avgQueryTime,
    },
    byTag,
    results,
    timestamp: now(),
    totalDurationMs: Date.now() - startTime,
  };
}

// =============================================================================
// COMPARISON UTILITIES
// =============================================================================

/**
 * Compare two benchmark runs (A/B testing)
 */
export function compareBenchmarks(
  baseline: BenchmarkSummary,
  experimental: BenchmarkSummary,
): {
  improved: boolean;
  f1Delta: number;
  passRateDelta: number;
  queryTimeDelta: number;
  summary: string;
} {
  const f1Delta = experimental.averageMetrics.f1Score - baseline.averageMetrics.f1Score;
  const passRateDelta = experimental.passRate - baseline.passRate;
  const queryTimeDelta =
    experimental.averageMetrics.queryTimeMs - baseline.averageMetrics.queryTimeMs;

  // Improved if F1 is better and query time isn't significantly worse
  const improved = f1Delta > 0.05 || (f1Delta >= 0 && queryTimeDelta < 0);

  const summary = [
    `F1 Score: ${baseline.averageMetrics.f1Score.toFixed(3)} → ${experimental.averageMetrics.f1Score.toFixed(3)} (${f1Delta >= 0 ? "+" : ""}${f1Delta.toFixed(3)})`,
    `Pass Rate: ${(baseline.passRate * 100).toFixed(1)}% → ${(experimental.passRate * 100).toFixed(1)}% (${passRateDelta >= 0 ? "+" : ""}${(passRateDelta * 100).toFixed(1)}%)`,
    `Query Time: ${baseline.averageMetrics.queryTimeMs.toFixed(1)}ms → ${experimental.averageMetrics.queryTimeMs.toFixed(1)}ms (${queryTimeDelta >= 0 ? "+" : ""}${queryTimeDelta.toFixed(1)}ms)`,
    `Result: ${improved ? "✅ IMPROVED" : "⚠️ NO IMPROVEMENT"}`,
  ].join("\n");

  return { improved, f1Delta, passRateDelta, queryTimeDelta, summary };
}

/**
 * Format benchmark summary as a report
 */
export function formatBenchmarkReport(summary: BenchmarkSummary): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════════",
    "                    SHEEP AI BENCHMARK REPORT               ",
    "═══════════════════════════════════════════════════════════",
    "",
    `Timestamp: ${summary.timestamp}`,
    `Duration: ${summary.totalDurationMs}ms`,
    "",
    "OVERALL RESULTS",
    "───────────────────────────────────────────────────────────",
    `Total Cases: ${summary.totalCases}`,
    `Passed: ${summary.passedCases} (${(summary.passRate * 100).toFixed(1)}%)`,
    `Failed: ${summary.totalCases - summary.passedCases}`,
    "",
    "METRICS",
    "───────────────────────────────────────────────────────────",
    `Precision: ${summary.averageMetrics.precision.toFixed(3)}`,
    `Recall: ${summary.averageMetrics.recall.toFixed(3)}`,
    `F1 Score: ${summary.averageMetrics.f1Score.toFixed(3)}`,
    `Avg Query Time: ${summary.averageMetrics.queryTimeMs.toFixed(2)}ms`,
    "",
    "BY TAG",
    "───────────────────────────────────────────────────────────",
  ];

  for (const [tag, stats] of Object.entries(summary.byTag)) {
    lines.push(
      `  ${tag}: ${stats.count} cases, ${stats.passRate.toFixed(1)}% pass, F1=${stats.avgF1.toFixed(3)}`,
    );
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════");

  return lines.join("\n");
}

// =============================================================================
// MOCK DATA GENERATORS (for testing the benchmark suite itself)
// =============================================================================

/**
 * Create mock facts for benchmark testing
 */
export function createMockFactsForBenchmark(): Fact[] {
  const timestamp = now();
  return [
    {
      id: generateId("fact"),
      subject: "user",
      predicate: "favorite_color",
      object: "blue",
      confidence: 0.9,
      evidence: [],
      isActive: true,
      userAffirmed: true,
      accessCount: 1,
      firstSeen: timestamp,
      lastConfirmed: timestamp,
      contradictions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: generateId("fact"),
      subject: "user",
      predicate: "name",
      object: "Alice",
      confidence: 0.95,
      evidence: [],
      isActive: true,
      userAffirmed: true,
      accessCount: 2,
      firstSeen: timestamp,
      lastConfirmed: timestamp,
      contradictions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: generateId("fact"),
      subject: "user",
      predicate: "prefers",
      object: "Python",
      confidence: 0.85,
      evidence: [],
      isActive: true,
      userAffirmed: false,
      accessCount: 1,
      firstSeen: timestamp,
      lastConfirmed: timestamp,
      contradictions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

/**
 * Create mock episodes for benchmark testing
 */
export function createMockEpisodesForBenchmark(): Episode[] {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  return [
    {
      id: generateId("ep"),
      timestamp: yesterday.toISOString(),
      summary: "Discussed database architecture and indexing strategies",
      participants: ["user", "assistant"],
      topic: "database",
      keywords: ["database", "architecture", "indexing"],
      emotionalSalience: 0.6,
      utilityScore: 0.8,
      sourceSessionId: "sess-1",
      sourceMessageIds: ["msg-1", "msg-2"],
      ttl: "30d",
      accessCount: 2,
      createdAt: yesterday.toISOString(),
      updatedAt: yesterday.toISOString(),
    },
    {
      id: generateId("ep"),
      timestamp: now(),
      summary: "Talked about the project timeline and milestones",
      participants: ["user", "assistant"],
      topic: "project",
      keywords: ["project", "timeline", "milestones"],
      emotionalSalience: 0.5,
      utilityScore: 0.7,
      sourceSessionId: "sess-2",
      sourceMessageIds: ["msg-3"],
      ttl: "30d",
      accessCount: 1,
      createdAt: now(),
      updatedAt: now(),
    },
  ];
}
