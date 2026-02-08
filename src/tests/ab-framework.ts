/**
 * SHEEP AI - A/B Testing Framework
 *
 * Compares SHEEP's cognitive memory against baseline systems:
 * - SHEEP memory vs no memory
 * - SHEEP memory vs simple keyword memory
 * - Different SHEEP configurations
 *
 * Metrics tracked:
 * - Retrieval accuracy (precision, recall, F1)
 * - Response relevance (user satisfaction proxy)
 * - Latency (prefetch time, total response time)
 * - Memory efficiency (storage, queries)
 *
 * @module sheep/tests/ab-framework
 */

import type { Episode, Fact } from "../memory/schema.js";
import { generateId, now } from "../memory/schema.js";
import {
  runBenchmarkSuite,
  STANDARD_BENCHMARK_CASES,
  type BenchmarkSummary,
  type BenchmarkConfig,
} from "./benchmarks/benchmark-suite.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Memory system variant for A/B testing
 */
export type MemoryVariant = {
  name: string;
  description: string;
  /** Query facts function */
  queryFacts: (query: string) => Fact[];
  /** Query episodes function */
  queryEpisodes: (query: string) => Episode[];
  /** Optional setup function */
  setup?: () => Promise<void>;
  /** Optional teardown function */
  teardown?: () => Promise<void>;
};

/**
 * A/B test configuration
 */
export type ABTestConfig = {
  /** Name of the test */
  name: string;
  /** Baseline variant (control) */
  baseline: MemoryVariant;
  /** Experimental variant (treatment) */
  experimental: MemoryVariant;
  /** Benchmark configuration */
  benchmarkConfig?: BenchmarkConfig;
  /** Number of iterations for statistical significance */
  iterations?: number;
  /** Tags to filter benchmark cases */
  includeTags?: string[];
  excludeTags?: string[];
};

/**
 * Single A/B test run result
 */
export type ABTestRun = {
  iteration: number;
  baseline: BenchmarkSummary;
  experimental: BenchmarkSummary;
  delta: {
    f1: number;
    passRate: number;
    queryTime: number;
  };
};

/**
 * Aggregated A/B test result
 */
export type ABTestResult = {
  testName: string;
  baselineName: string;
  experimentalName: string;
  runs: ABTestRun[];
  summary: {
    /** Total iterations */
    iterations: number;
    /** Experimental wins */
    experimentalWins: number;
    /** Baseline wins */
    baselineWins: number;
    /** Ties */
    ties: number;
    /** Average F1 delta */
    avgF1Delta: number;
    /** Average pass rate delta */
    avgPassRateDelta: number;
    /** Average query time delta (ms) */
    avgQueryTimeDelta: number;
    /** Statistical significance (p < 0.05) */
    isSignificant: boolean;
    /** Confidence level (0-1) */
    confidenceLevel: number;
    /** p-value from t-test */
    pValue: number;
    /** t-statistic */
    tStatistic: number;
    /** Chi-square test result for win/loss distribution */
    chiSquareTest?: StatisticalTestResult;
    /** Winner: "experimental" | "baseline" | "inconclusive" */
    winner: "experimental" | "baseline" | "inconclusive";
    /** Human-readable conclusion */
    conclusion: string;
  };
  timestamp: string;
  durationMs: number;
};

// =============================================================================
// BASELINE IMPLEMENTATIONS
// =============================================================================

/**
 * Create a "no memory" baseline (returns nothing)
 */
export function createNoMemoryBaseline(): MemoryVariant {
  return {
    name: "No Memory",
    description: "Baseline with no memory retrieval",
    queryFacts: () => [],
    queryEpisodes: () => [],
  };
}

/**
 * Create a simple keyword-matching baseline
 */
export function createKeywordBaseline(facts: Fact[], episodes: Episode[]): MemoryVariant {
  return {
    name: "Keyword Matching",
    description: "Simple keyword-based memory retrieval",
    queryFacts: (query: string) => {
      const queryLower = query.toLowerCase();
      const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
      return facts.filter((f) => {
        const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
        return words.some((w) => text.includes(w));
      });
    },
    queryEpisodes: (query: string) => {
      const queryLower = query.toLowerCase();
      const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
      return episodes.filter((e) => {
        const text = `${e.summary} ${e.topic} ${e.keywords.join(" ")}`.toLowerCase();
        return words.some((w) => text.includes(w));
      });
    },
  };
}

/**
 * Create a SHEEP memory variant from query functions
 */
export function createSheepVariant(
  queryFacts: (query: string) => Fact[],
  queryEpisodes: (query: string) => Episode[],
): MemoryVariant {
  return {
    name: "SHEEP AI",
    description: "SHEEP cognitive memory with semantic search and intent classification",
    queryFacts,
    queryEpisodes,
  };
}

// =============================================================================
// A/B TEST RUNNER
// =============================================================================

/**
 * Run A/B test comparing two memory variants
 */
export async function runABTest(config: ABTestConfig): Promise<ABTestResult> {
  const startTime = Date.now();
  const iterations = config.iterations ?? 3;
  const runs: ABTestRun[] = [];

  // Setup variants
  if (config.baseline.setup) {
    await config.baseline.setup();
  }
  if (config.experimental.setup) {
    await config.experimental.setup();
  }

  const benchmarkConfig: BenchmarkConfig = {
    ...config.benchmarkConfig,
    includeTags: config.includeTags,
    excludeTags: config.excludeTags,
  };

  // Run iterations
  for (let i = 0; i < iterations; i++) {
    // Run baseline
    const baselineResult = runBenchmarkSuite(
      STANDARD_BENCHMARK_CASES,
      config.baseline.queryFacts,
      config.baseline.queryEpisodes,
      benchmarkConfig,
    );

    // Run experimental
    const experimentalResult = runBenchmarkSuite(
      STANDARD_BENCHMARK_CASES,
      config.experimental.queryFacts,
      config.experimental.queryEpisodes,
      benchmarkConfig,
    );

    // Calculate deltas
    const delta = {
      f1: experimentalResult.averageMetrics.f1Score - baselineResult.averageMetrics.f1Score,
      passRate: experimentalResult.passRate - baselineResult.passRate,
      queryTime:
        experimentalResult.averageMetrics.queryTimeMs - baselineResult.averageMetrics.queryTimeMs,
    };

    runs.push({
      iteration: i + 1,
      baseline: baselineResult,
      experimental: experimentalResult,
      delta,
    });
  }

  // Teardown variants
  if (config.baseline.teardown) {
    await config.baseline.teardown();
  }
  if (config.experimental.teardown) {
    await config.experimental.teardown();
  }

  // Calculate summary statistics
  const summary = calculateABSummary(runs, config);

  return {
    testName: config.name,
    baselineName: config.baseline.name,
    experimentalName: config.experimental.name,
    runs,
    summary,
    timestamp: now(),
    durationMs: Date.now() - startTime,
  };
}

/**
 * Calculate summary statistics from A/B test runs
 */
function calculateABSummary(runs: ABTestRun[], config: ABTestConfig): ABTestResult["summary"] {
  const iterations = runs.length;

  // Count wins
  let experimentalWins = 0;
  let baselineWins = 0;
  let ties = 0;

  for (const run of runs) {
    if (run.delta.f1 > 0.01) {
      experimentalWins++;
    } else if (run.delta.f1 < -0.01) {
      baselineWins++;
    } else {
      ties++;
    }
  }

  // Calculate averages
  const avgF1Delta = runs.reduce((sum, r) => sum + r.delta.f1, 0) / iterations;
  const avgPassRateDelta = runs.reduce((sum, r) => sum + r.delta.passRate, 0) / iterations;
  const avgQueryTimeDelta = runs.reduce((sum, r) => sum + r.delta.queryTime, 0) / iterations;

  // Statistical significance tests
  const f1Deltas = runs.map((r) => r.delta.f1);
  const { isSignificant, confidenceLevel, pValue, tStatistic } = calculateSignificance(f1Deltas);

  // Chi-square test for win/loss distribution
  const chiSquareResult = calculateChiSquareSignificance(experimentalWins, baselineWins, ties);

  // Determine winner
  let winner: "experimental" | "baseline" | "inconclusive";
  let conclusion: string;

  if (!isSignificant) {
    winner = "inconclusive";
    conclusion = `Results are not statistically significant (confidence: ${(confidenceLevel * 100).toFixed(0)}%). More iterations may be needed.`;
  } else if (avgF1Delta > 0.05) {
    winner = "experimental";
    conclusion = `${config.experimental.name} significantly outperforms ${config.baseline.name} with +${(avgF1Delta * 100).toFixed(1)}% F1 improvement.`;
  } else if (avgF1Delta < -0.05) {
    winner = "baseline";
    conclusion = `${config.baseline.name} outperforms ${config.experimental.name}. Consider reverting changes.`;
  } else if (avgQueryTimeDelta < -50) {
    winner = "experimental";
    conclusion = `${config.experimental.name} is significantly faster (${Math.abs(avgQueryTimeDelta).toFixed(0)}ms) with similar accuracy.`;
  } else {
    winner = "inconclusive";
    conclusion = `Performance is similar between variants. Consider other factors.`;
  }

  return {
    iterations,
    experimentalWins,
    baselineWins,
    ties,
    avgF1Delta,
    avgPassRateDelta,
    avgQueryTimeDelta,
    isSignificant,
    confidenceLevel,
    pValue,
    tStatistic,
    chiSquareTest: chiSquareResult,
    winner,
    conclusion,
  };
}

/**
 * Statistical test results
 */
export type StatisticalTestResult = {
  /** Test name */
  testName: string;
  /** p-value */
  pValue: number;
  /** Is statistically significant (p < 0.05) */
  isSignificant: boolean;
  /** Confidence level (1 - p-value) */
  confidenceLevel: number;
  /** Test statistic value */
  statistic: number;
  /** Degrees of freedom */
  degreesOfFreedom: number;
};

/**
 * Calculate statistical significance using proper t-test (paired samples)
 */
function calculateSignificance(deltas: number[]): {
  isSignificant: boolean;
  confidenceLevel: number;
  pValue: number;
  tStatistic: number;
} {
  if (deltas.length < 2) {
    return { isSignificant: false, confidenceLevel: 0, pValue: 1.0, tStatistic: 0 };
  }

  const n = deltas.length;
  const mean = deltas.reduce((a, b) => a + b, 0) / n;

  // Calculate sample variance (Bessel's correction: n-1)
  const variance = deltas.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  const stdError = stdDev / Math.sqrt(n);

  // t-statistic (testing H0: mean = 0)
  const tStat = stdError > 0 ? Math.abs(mean / stdError) : 0;
  const df = n - 1;

  // Calculate p-value using t-distribution approximation
  // Using two-tailed test
  const pValue = calculatePValueFromT(tStat, df);

  const isSignificant = pValue < 0.05;
  const confidenceLevel = Math.max(0, Math.min(1, 1 - pValue));

  return { isSignificant, confidenceLevel, pValue, tStatistic: tStat };
}

/**
 * Calculate p-value from t-statistic using approximation
 * For df >= 30, use normal approximation; otherwise use t-distribution
 */
function calculatePValueFromT(tStat: number, df: number): number {
  if (df >= 30) {
    // Normal approximation (two-tailed)
    // For large df, t-distribution approximates normal
    // P(|Z| > t) ≈ 2 * (1 - Φ(t)) where Φ is standard normal CDF
    // Using approximation: Φ(x) ≈ 1 - 0.5 * (1 + erf(x/√2))
    const z = tStat;
    const erfApprox = (x: number): number => {
      // Error function approximation
      const a1 = 0.254829592;
      const a2 = -0.284496736;
      const a3 = 1.421413741;
      const a4 = -1.453152027;
      const a5 = 1.061405429;
      const p = 0.3275911;
      const sign = x < 0 ? -1 : 1;
      x = Math.abs(x);
      const t = 1.0 / (1.0 + p * x);
      const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
      return sign * y;
    };
    const phi = 0.5 * (1 + erfApprox(z / Math.sqrt(2)));
    return 2 * (1 - phi);
  } else {
    // t-distribution approximation (two-tailed)
    // Using simplified approximation for common df values
    const criticalValues: Record<number, number> = {
      1: 12.706,
      2: 4.303,
      3: 3.182,
      4: 2.776,
      5: 2.571,
      6: 2.447,
      7: 2.365,
      8: 2.306,
      9: 2.262,
      10: 2.228,
      15: 2.131,
      20: 2.086,
      25: 2.06,
      30: 2.042,
    };

    const criticalT = criticalValues[df] || 2.0; // Default to 2.0 for unknown df

    // Approximate p-value: if t > critical, p < 0.05
    if (tStat > criticalT) {
      // Linear interpolation for rough p-value estimate
      const ratio = criticalT / tStat;
      return Math.max(0.001, 0.05 * ratio * ratio); // Rough approximation
    } else {
      // If t < critical, p > 0.05
      return Math.min(0.99, 0.1 + (1 - tStat / criticalT) * 0.4);
    }
  }
}

/**
 * Perform chi-square test for categorical outcomes (win/loss/tie)
 */
function calculateChiSquareSignificance(
  experimentalWins: number,
  baselineWins: number,
  ties: number,
): StatisticalTestResult {
  const total = experimentalWins + baselineWins + ties;
  if (total === 0) {
    return {
      testName: "chi-square",
      pValue: 1.0,
      isSignificant: false,
      confidenceLevel: 0,
      statistic: 0,
      degreesOfFreedom: 2,
    };
  }

  // Expected frequencies under null hypothesis (equal distribution)
  const expected = total / 3;

  // Chi-square statistic
  const chiSquare =
    Math.pow(experimentalWins - expected, 2) / expected +
    Math.pow(baselineWins - expected, 2) / expected +
    Math.pow(ties - expected, 2) / expected;

  const df = 2; // 3 categories - 1 = 2 degrees of freedom

  // Approximate p-value from chi-square distribution
  // Critical value for df=2, alpha=0.05 is 5.991
  const criticalChiSquare = 5.991;
  const pValue = chiSquare > criticalChiSquare ? 0.01 : 0.5; // Simplified approximation

  return {
    testName: "chi-square",
    pValue,
    isSignificant: pValue < 0.05,
    confidenceLevel: Math.max(0, Math.min(1, 1 - pValue)),
    statistic: chiSquare,
    degreesOfFreedom: df,
  };
}

// =============================================================================
// REPORT GENERATION
// =============================================================================

/**
 * Format A/B test result as a human-readable report
 */
export function formatABTestReport(result: ABTestResult): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════════",
    "               SHEEP AI A/B TEST REPORT                    ",
    "═══════════════════════════════════════════════════════════",
    "",
    `Test: ${result.testName}`,
    `Timestamp: ${result.timestamp}`,
    `Duration: ${result.durationMs}ms`,
    "",
    "VARIANTS",
    "───────────────────────────────────────────────────────────",
    `Baseline: ${result.baselineName}`,
    `Experimental: ${result.experimentalName}`,
    "",
    "SUMMARY",
    "───────────────────────────────────────────────────────────",
    `Iterations: ${result.summary.iterations}`,
    `Experimental wins: ${result.summary.experimentalWins}`,
    `Baseline wins: ${result.summary.baselineWins}`,
    `Ties: ${result.summary.ties}`,
    "",
    "METRICS (Experimental - Baseline)",
    "───────────────────────────────────────────────────────────",
    `Avg F1 Delta: ${result.summary.avgF1Delta >= 0 ? "+" : ""}${(result.summary.avgF1Delta * 100).toFixed(2)}%`,
    `Avg Pass Rate Delta: ${result.summary.avgPassRateDelta >= 0 ? "+" : ""}${(result.summary.avgPassRateDelta * 100).toFixed(2)}%`,
    `Avg Query Time Delta: ${result.summary.avgQueryTimeDelta >= 0 ? "+" : ""}${result.summary.avgQueryTimeDelta.toFixed(1)}ms`,
    "",
    "STATISTICAL ANALYSIS",
    "───────────────────────────────────────────────────────────",
    `Significant: ${result.summary.isSignificant ? "YES" : "NO"}`,
    `p-value: ${result.summary.pValue.toFixed(4)}`,
    `t-statistic: ${result.summary.tStatistic.toFixed(3)}`,
    `Confidence: ${(result.summary.confidenceLevel * 100).toFixed(0)}%`,
    result.summary.chiSquareTest
      ? `Chi-square: ${result.summary.chiSquareTest.statistic.toFixed(3)} (p=${result.summary.chiSquareTest.pValue.toFixed(4)})`
      : "",
    `Winner: ${result.summary.winner.toUpperCase()}`,
    "",
    "CONCLUSION",
    "───────────────────────────────────────────────────────────",
    result.summary.conclusion,
    "",
    "PER-ITERATION RESULTS",
    "───────────────────────────────────────────────────────────",
  ];

  for (const run of result.runs) {
    lines.push(
      `  #${run.iteration}: B[F1=${run.baseline.averageMetrics.f1Score.toFixed(3)}] vs E[F1=${run.experimental.averageMetrics.f1Score.toFixed(3)}] → Δ=${run.delta.f1 >= 0 ? "+" : ""}${run.delta.f1.toFixed(3)}`,
    );
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════");

  return lines.join("\n");
}

/**
 * Format A/B test result as JSON
 */
export function exportABTestResult(result: ABTestResult): string {
  return JSON.stringify(result, null, 2);
}

// =============================================================================
// MOCK DATA FOR TESTING THE FRAMEWORK
// =============================================================================

/**
 * Create mock facts for A/B testing
 */
export function createMockFactsForAB(): Fact[] {
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
      accessCount: 5,
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
      accessCount: 10,
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
      object: "Python programming language",
      confidence: 0.85,
      evidence: [],
      isActive: true,
      userAffirmed: false,
      accessCount: 3,
      firstSeen: timestamp,
      lastConfirmed: timestamp,
      contradictions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: generateId("fact"),
      subject: "user",
      predicate: "works_at",
      object: "Tech Corp",
      confidence: 0.9,
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
      subject: "project",
      predicate: "uses",
      object: "React framework",
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
    },
  ];
}

/**
 * Create mock episodes for A/B testing
 */
export function createMockEpisodesForAB(): Episode[] {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const timestamp = now();

  return [
    {
      id: generateId("ep"),
      timestamp: yesterday.toISOString(),
      summary: "Discussion about database architecture and performance optimization",
      participants: ["user", "assistant"],
      topic: "database",
      keywords: ["database", "architecture", "performance", "optimization", "indexing"],
      emotionalSalience: 0.7,
      utilityScore: 0.85,
      sourceSessionId: "sess-1",
      sourceMessageIds: ["msg-1", "msg-2"],
      ttl: "30d",
      accessCount: 3,
      createdAt: yesterday.toISOString(),
      updatedAt: timestamp,
    },
    {
      id: generateId("ep"),
      timestamp: timestamp,
      summary: "Planning the project roadmap and milestones for Q1",
      participants: ["user", "assistant"],
      topic: "project",
      keywords: ["project", "roadmap", "milestones", "planning", "Q1"],
      emotionalSalience: 0.6,
      utilityScore: 0.8,
      sourceSessionId: "sess-2",
      sourceMessageIds: ["msg-3"],
      ttl: "30d",
      accessCount: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: generateId("ep"),
      timestamp: timestamp,
      summary: "Debugging session for the authentication module",
      participants: ["user", "assistant"],
      topic: "debugging",
      keywords: ["debug", "authentication", "login", "security", "fix"],
      emotionalSalience: 0.5,
      utilityScore: 0.9,
      sourceSessionId: "sess-3",
      sourceMessageIds: ["msg-4", "msg-5", "msg-6"],
      ttl: "30d",
      accessCount: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

// =============================================================================
// QUICK A/B TEST RUNNER
// =============================================================================

/**
 * Run a quick A/B test with mock data to verify the framework works
 */
export async function runQuickABTest(): Promise<ABTestResult> {
  const mockFacts = createMockFactsForAB();
  const mockEpisodes = createMockEpisodesForAB();

  // Create variants
  const noMemoryBaseline = createNoMemoryBaseline();
  // keywordBaseline available for more advanced tests: createKeywordBaseline(mockFacts, mockEpisodes)

  // Simple SHEEP-like variant (better than keyword)
  const sheepVariant: MemoryVariant = {
    name: "SHEEP AI (Mock)",
    description: "Mock SHEEP with semantic-like matching",
    queryFacts: (query: string) => {
      const queryLower = query.toLowerCase();
      // More intelligent matching - handle synonyms and related concepts
      return mockFacts.filter((f) => {
        const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
        // Direct match
        if (text.includes(queryLower)) return true;
        // Query words match
        const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
        if (words.some((w) => text.includes(w))) return true;
        // Semantic-like: "color" matches "favorite_color"
        if (queryLower.includes("color") && f.predicate.includes("color")) return true;
        if (queryLower.includes("name") && f.predicate.includes("name")) return true;
        if (
          queryLower.includes("work") &&
          (f.predicate.includes("work") || f.object.toLowerCase().includes("corp"))
        )
          return true;
        return false;
      });
    },
    queryEpisodes: (query: string) => {
      const queryLower = query.toLowerCase();
      return mockEpisodes.filter((e) => {
        const text = `${e.summary} ${e.topic} ${e.keywords.join(" ")}`.toLowerCase();
        // Direct match
        if (text.includes(queryLower)) return true;
        // Query words match
        const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
        if (words.some((w) => text.includes(w))) return true;
        // Temporal matching
        if (queryLower.includes("yesterday") && e.timestamp < new Date().toISOString()) return true;
        return false;
      });
    },
  };

  // Run test: SHEEP vs No Memory
  const result = await runABTest({
    name: "SHEEP vs No Memory (Mock)",
    baseline: noMemoryBaseline,
    experimental: sheepVariant,
    iterations: 3,
    benchmarkConfig: {
      passThreshold: 0.3,
      verbose: false,
    },
  });

  return result;
}

// =============================================================================
// AUTOMATED COMPARISON REPORTS
// =============================================================================

/**
 * Compare multiple A/B test results and generate comprehensive report
 */
export function compareABTestResults(results: ABTestResult[]): string {
  if (results.length === 0) {
    return "No test results to compare.";
  }

  const lines: string[] = [
    "═══════════════════════════════════════════════════════════",
    "          SHEEP AI A/B TEST COMPARISON REPORT               ",
    "═══════════════════════════════════════════════════════════",
    "",
    `Total Tests: ${results.length}`,
    `Generated: ${now()}`,
    "",
  ];

  // Summary table
  lines.push("SUMMARY TABLE");
  lines.push("───────────────────────────────────────────────────────────");
  lines.push(
    "Test Name".padEnd(40) +
      "Winner".padEnd(15) +
      "F1 Δ".padEnd(10) +
      "p-value".padEnd(10) +
      "Significant",
  );
  lines.push("─".repeat(95));

  for (const result of results) {
    const f1DeltaStr = `${result.summary.avgF1Delta >= 0 ? "+" : ""}${(result.summary.avgF1Delta * 100).toFixed(1)}%`;
    const pValueStr = result.summary.pValue.toFixed(3);
    const winnerStr = result.summary.winner.toUpperCase().padEnd(15);
    const sigStr = result.summary.isSignificant ? "YES" : "NO";

    lines.push(
      result.testName.padEnd(40) +
        winnerStr +
        f1DeltaStr.padEnd(10) +
        pValueStr.padEnd(10) +
        sigStr,
    );
  }

  lines.push("");

  // Detailed analysis
  lines.push("DETAILED ANALYSIS");
  lines.push("───────────────────────────────────────────────────────────");

  // Count winners
  const experimentalWins = results.filter((r) => r.summary.winner === "experimental").length;
  const baselineWins = results.filter((r) => r.summary.winner === "baseline").length;
  const inconclusive = results.filter((r) => r.summary.winner === "inconclusive").length;

  lines.push(`Experimental Wins: ${experimentalWins}`);
  lines.push(`Baseline Wins: ${baselineWins}`);
  lines.push(`Inconclusive: ${inconclusive}`);
  lines.push("");

  // Average improvements
  const significantResults = results.filter((r) => r.summary.isSignificant);
  if (significantResults.length > 0) {
    const avgF1Improvement =
      significantResults.reduce((sum, r) => sum + r.summary.avgF1Delta, 0) /
      significantResults.length;
    const avgTimeImprovement =
      significantResults.reduce((sum, r) => sum + r.summary.avgQueryTimeDelta, 0) /
      significantResults.length;

    lines.push("AVERAGE IMPROVEMENTS (Significant Tests Only)");
    lines.push("───────────────────────────────────────────────────────────");
    lines.push(
      `Avg F1 Improvement: ${avgF1Improvement >= 0 ? "+" : ""}${(avgF1Improvement * 100).toFixed(2)}%`,
    );
    lines.push(
      `Avg Query Time Delta: ${avgTimeImprovement >= 0 ? "+" : ""}${avgTimeImprovement.toFixed(1)}ms`,
    );
    lines.push("");
  }

  // Recommendations
  lines.push("RECOMMENDATIONS");
  lines.push("───────────────────────────────────────────────────────────");
  if (experimentalWins > baselineWins) {
    lines.push("✓ Experimental variant shows consistent improvements");
    lines.push("  Consider deploying experimental variant to production");
  } else if (baselineWins > experimentalWins) {
    lines.push("⚠ Baseline variant outperforms experimental");
    lines.push("  Review experimental changes before proceeding");
  } else {
    lines.push("? Results are mixed or inconclusive");
    lines.push("  Consider running more iterations or reviewing test design");
  }

  if (inconclusive > results.length / 2) {
    lines.push("");
    lines.push("⚠ More than half of tests are inconclusive");
    lines.push("  Consider:");
    lines.push("  - Increasing number of iterations");
    lines.push("  - Checking for test design issues");
    lines.push("  - Ensuring sufficient sample sizes");
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════");

  return lines.join("\n");
}

/**
 * Export comparison report as JSON
 */
export function exportComparisonReport(results: ABTestResult[]): string {
  return JSON.stringify(
    {
      timestamp: now(),
      totalTests: results.length,
      summary: {
        experimentalWins: results.filter((r) => r.summary.winner === "experimental").length,
        baselineWins: results.filter((r) => r.summary.winner === "baseline").length,
        inconclusive: results.filter((r) => r.summary.winner === "inconclusive").length,
        significantTests: results.filter((r) => r.summary.isSignificant).length,
      },
      results: results.map((r) => ({
        testName: r.testName,
        winner: r.summary.winner,
        avgF1Delta: r.summary.avgF1Delta,
        pValue: r.summary.pValue,
        isSignificant: r.summary.isSignificant,
      })),
    },
    null,
    2,
  );
}

// Types are already exported at their definitions above
