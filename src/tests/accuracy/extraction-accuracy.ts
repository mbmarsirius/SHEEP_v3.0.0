/**
 * SHEEP AI - Extraction Accuracy Measurement
 *
 * Compares LLM extraction results against the golden dataset to measure:
 * - Fact extraction precision/recall/F1
 * - Causal link extraction precision/recall/F1
 *
 * Targets:
 * - Fact Recall: >85%
 * - Causal F1: >70%
 *
 * @module sheep/tests/accuracy/extraction-accuracy
 */

import type { Fact, CausalLink } from "../../memory/schema.js";
import type { GoldenTestCase } from "../fixtures/golden-dataset.js";
import {
  GOLDEN_DATASET,
  DATASET_CATEGORIES,
  type DatasetCategory,
} from "../fixtures/golden-dataset.js";
import {
  extractFactsWithLLM,
  extractCausalLinksWithLLM,
  createSheepLLMProvider,
  createMockLLMProvider,
  type LLMProvider,
} from "../../extraction/llm-extractor.js";

// =============================================================================
// TYPES
// =============================================================================

export type FactMatchResult = {
  expected: GoldenTestCase["expectedFacts"][0];
  matched: boolean;
  matchedFact?: Omit<Fact, "id" | "createdAt" | "updatedAt">;
  similarity: number;
};

export type CausalMatchResult = {
  expected: GoldenTestCase["expectedCausalLinks"][0];
  matched: boolean;
  matchedLink?: Omit<CausalLink, "id" | "createdAt" | "updatedAt">;
  similarity: number;
};

export type TestCaseResult = {
  testCaseId: string;
  category: string;

  factResults: {
    expected: number;
    extracted: number;
    matched: number;
    precision: number;
    recall: number;
    f1: number;
    details: FactMatchResult[];
  };

  causalResults: {
    expected: number;
    extracted: number;
    matched: number;
    precision: number;
    recall: number;
    f1: number;
    details: CausalMatchResult[];
  };

  extractionTimeMs: number;
  error?: string;
};

export type AccuracyReport = {
  timestamp: string;
  model: string;

  overall: {
    factPrecision: number;
    factRecall: number;
    factF1: number;
    causalPrecision: number;
    causalRecall: number;
    causalF1: number;
    meetsTargets: boolean;
  };

  byCategory: Record<
    string,
    {
      count: number;
      factF1: number;
      causalF1: number;
    }
  >;

  testCases: TestCaseResult[];

  summary: {
    totalTestCases: number;
    totalExpectedFacts: number;
    totalExtractedFacts: number;
    totalMatchedFacts: number;
    totalExpectedCausal: number;
    totalExtractedCausal: number;
    totalMatchedCausal: number;
    totalTimeMs: number;
    avgTimePerCase: number;
  };
};

// =============================================================================
// MATCHING LOGIC
// =============================================================================

/**
 * Fuzzy string matching (0-1)
 * Uses character overlap and substring containment
 */
function fuzzyMatch(a: string, b: string): number {
  const aNorm = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const bNorm = b.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (aNorm === bNorm) return 1;
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.9;

  // Token-based matching
  const aTokens = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  const intersection = [...aTokens].filter((t) => bTokens.has(t)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const tokenSimilarity = union > 0 ? intersection / union : 0;

  // Character overlap
  const aChars = new Set(aNorm.split(""));
  const bChars = new Set(bNorm.split(""));
  const charIntersection = [...aChars].filter((c) => bChars.has(c)).length;
  const charUnion = new Set([...aChars, ...bChars]).size;
  const charSimilarity = charUnion > 0 ? charIntersection / charUnion : 0;

  // Combine both approaches
  return Math.max(tokenSimilarity, charSimilarity);
}

/**
 * Compute similarity between expected and extracted fact (0-1).
 */
function factSimilarity(
  expected: GoldenTestCase["expectedFacts"][0],
  extracted: Omit<Fact, "id" | "createdAt" | "updatedAt">,
): number {
  const subjectSim = fuzzyMatch(expected.subject, extracted.subject);
  const predicateSim = fuzzyMatch(
    expected.predicate.replace(/_/g, " "),
    extracted.predicate.replace(/_/g, " "),
  );
  const objectSim = fuzzyMatch(expected.object, extracted.object);

  // Object is the most informative signal. Subject varies widely
  // (e.g., "bug" vs "react_app", "solution" vs "user").
  const baseSim = subjectSim * 0.10 + predicateSim * 0.25 + objectSim * 0.65;

  // Boost: if object matches very well (>0.85), the fact is likely correct
  // even if subject/predicate phrasing differs
  if (objectSim >= 0.85 && predicateSim >= 0.4) {
    return Math.max(baseSim, objectSim * 0.9);
  }

  return baseSim;
}

const MATCH_THRESHOLD = 0.50;

/**
 * Greedy 1-to-1 matching: each extracted fact matches at most one expected,
 * each expected matches at most one extracted. Prevents Precision/F1 > 1.0.
 */
function matchFactsOneToOne(
  expectedFacts: GoldenTestCase["expectedFacts"],
  extractedFacts: Omit<Fact, "id" | "createdAt" | "updatedAt">[],
): { matches: FactMatchResult[]; matchedPairs: number } {
  type Triple = { expIdx: number; extIdx: number; sim: number };
  const candidates: Triple[] = [];
  for (let e = 0; e < expectedFacts.length; e++) {
    for (let x = 0; x < extractedFacts.length; x++) {
      const sim = factSimilarity(expectedFacts[e], extractedFacts[x]);
      if (sim >= MATCH_THRESHOLD) {
        candidates.push({ expIdx: e, extIdx: x, sim });
      }
    }
  }
  candidates.sort((a, b) => b.sim - a.sim);
  const usedExpected = new Set<number>();
  const usedExtracted = new Set<number>();
  const matchedPairs: Array<{ expIdx: number; extIdx: number; sim: number }> = [];
  for (const c of candidates) {
    if (!usedExpected.has(c.expIdx) && !usedExtracted.has(c.extIdx)) {
      usedExpected.add(c.expIdx);
      usedExtracted.add(c.extIdx);
      matchedPairs.push(c);
    }
  }
  const matchMap = new Map<number, { extIdx: number; sim: number }>();
  for (const m of matchedPairs) {
    matchMap.set(m.expIdx, { extIdx: m.extIdx, sim: m.sim });
  }
  const matches: FactMatchResult[] = expectedFacts.map((exp, expIdx) => {
    const m = matchMap.get(expIdx);
    return {
      expected: exp,
      matched: !!m,
      matchedFact: m ? extractedFacts[m.extIdx] : undefined,
      similarity: m?.sim ?? 0,
    };
  });
  return { matches, matchedPairs: matchedPairs.length };
}

/**
 * Legacy: single expected vs all extracted (for backward compat in details).
 */
function matchFact(
  expected: GoldenTestCase["expectedFacts"][0],
  extracted: Omit<Fact, "id" | "createdAt" | "updatedAt">[],
): FactMatchResult {
  let bestSim = 0;
  let bestExt: Omit<Fact, "id" | "createdAt" | "updatedAt"> | undefined;
  for (const f of extracted) {
    const sim = factSimilarity(expected, f);
    if (sim > bestSim) {
      bestSim = sim;
      bestExt = f;
    }
  }
  return {
    expected,
    matched: bestSim >= MATCH_THRESHOLD,
    matchedFact: bestSim >= MATCH_THRESHOLD ? bestExt : undefined,
    similarity: bestSim,
  };
}

/**
 * Compute similarity between expected and extracted causal link (0-1).
 */
function causalSimilarity(
  expected: GoldenTestCase["expectedCausalLinks"][0],
  extracted: Omit<CausalLink, "id" | "createdAt" | "updatedAt">,
): number {
  const causeSim = fuzzyMatch(expected.cause, extracted.causeDescription);
  const effectSim = fuzzyMatch(expected.effect, extracted.effectDescription);
  // Also try swapped (sometimes LLM reverses cause/effect phrasing)
  const swappedCauseSim = fuzzyMatch(expected.cause, extracted.effectDescription);
  const swappedEffectSim = fuzzyMatch(expected.effect, extracted.causeDescription);
  const normalScore = causeSim * 0.5 + effectSim * 0.5;
  const swappedScore = swappedCauseSim * 0.5 + swappedEffectSim * 0.5;
  return Math.max(normalScore, swappedScore * 0.9); // small penalty for swapped
}

const CAUSAL_MATCH_THRESHOLD = 0.50;

/**
 * Greedy 1-to-1 matching for causal links. Prevents Precision/F1 > 1.0.
 */
function matchCausalLinksOneToOne(
  expectedLinks: GoldenTestCase["expectedCausalLinks"],
  extractedLinks: Omit<CausalLink, "id" | "createdAt" | "updatedAt">[],
): { matches: CausalMatchResult[]; matchedPairs: number } {
  type Triple = { expIdx: number; extIdx: number; sim: number };
  const candidates: Triple[] = [];
  for (let e = 0; e < expectedLinks.length; e++) {
    for (let x = 0; x < extractedLinks.length; x++) {
      const sim = causalSimilarity(expectedLinks[e], extractedLinks[x]);
      if (sim >= CAUSAL_MATCH_THRESHOLD) {
        candidates.push({ expIdx: e, extIdx: x, sim });
      }
    }
  }
  candidates.sort((a, b) => b.sim - a.sim);
  const usedExpected = new Set<number>();
  const usedExtracted = new Set<number>();
  const matchedPairs: Array<{ expIdx: number; extIdx: number; sim: number }> = [];
  for (const c of candidates) {
    if (!usedExpected.has(c.expIdx) && !usedExtracted.has(c.extIdx)) {
      usedExpected.add(c.expIdx);
      usedExtracted.add(c.extIdx);
      matchedPairs.push(c);
    }
  }
  const matchMap = new Map<number, { extIdx: number; sim: number }>();
  for (const m of matchedPairs) matchMap.set(m.expIdx, { extIdx: m.extIdx, sim: m.sim });
  const matches: CausalMatchResult[] = expectedLinks.map((exp, expIdx) => {
    const m = matchMap.get(expIdx);
    return {
      expected: exp,
      matched: !!m,
      matchedLink: m ? extractedLinks[m.extIdx] : undefined,
      similarity: m?.sim ?? 0,
    };
  });
  return { matches, matchedPairs: matchedPairs.length };
}

/**
 * Legacy: single expected vs all extracted.
 */
function matchCausalLink(
  expected: GoldenTestCase["expectedCausalLinks"][0],
  extracted: Omit<CausalLink, "id" | "createdAt" | "updatedAt">[],
): CausalMatchResult {
  let bestSim = 0;
  let bestLink: Omit<CausalLink, "id" | "createdAt" | "updatedAt"> | undefined;
  for (const l of extracted) {
    const sim = causalSimilarity(expected, l);
    if (sim > bestSim) {
      bestSim = sim;
      bestLink = l;
    }
  }
  return {
    expected,
    matched: bestSim >= CAUSAL_MATCH_THRESHOLD,
    matchedLink: bestSim >= CAUSAL_MATCH_THRESHOLD ? bestLink : undefined,
    similarity: bestSim,
  };
}

// =============================================================================
// MAIN ACCURACY MEASUREMENT
// =============================================================================

/**
 * Run accuracy measurement on the golden dataset
 */
export async function measureExtractionAccuracy(options: {
  /** Model to test (default: claude-3-5-sonnet-latest) */
  model?: string;
  /** Categories to test (default: all) */
  categories?: DatasetCategory[];
  /** Max test cases to run (for quick testing) */
  limit?: number;
  /** Use mock LLM (for testing without API calls) */
  useMock?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, testCaseId: string) => void;
}): Promise<AccuracyReport> {
  const model = options.model ?? "claude-3-5-sonnet-latest";

  // Create LLM provider
  let llm: LLMProvider;
  if (options.useMock) {
    llm = createMockLLMProvider();
  } else {
    try {
      llm = await createSheepLLMProvider("extraction", { extractionModel: model });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to create LLM provider: ${message}. Using mock.`);
      llm = createMockLLMProvider();
    }
  }

  // Filter test cases
  let testCases = [...GOLDEN_DATASET];
  if (options.categories && options.categories.length > 0) {
    testCases = testCases.filter((tc) =>
      options.categories!.includes(tc.category as DatasetCategory),
    );
  }
  if (options.limit) {
    testCases = testCases.slice(0, options.limit);
  }

  const results: TestCaseResult[] = [];
  const startTime = Date.now();

  // Process each test case
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];

    if (options.onProgress) {
      options.onProgress(i + 1, testCases.length, testCase.id);
    }

    if (options.verbose) {
      console.log(`Testing: ${testCase.id} (${testCase.category})`);
    }

    const caseStart = Date.now();
    let result: TestCaseResult;

    try {
      // Extract facts using LLM
      const extractedFacts = await extractFactsWithLLM(
        llm,
        testCase.conversation,
        `test-${testCase.id}`,
      );

      // Extract causal links using LLM
      const extractedCausal = await extractCausalLinksWithLLM(
        llm,
        testCase.conversation,
        `test-${testCase.id}`,
      );

      // Match facts (1-to-1: prevents Precision/F1 > 1.0)
      const { matches: factMatches, matchedPairs: factMatchedPairs } = matchFactsOneToOne(
        testCase.expectedFacts,
        extractedFacts,
      );
      const factPrecision =
        extractedFacts.length > 0 ? factMatchedPairs / extractedFacts.length : 1;
      const factRecall =
        testCase.expectedFacts.length > 0 ? factMatchedPairs / testCase.expectedFacts.length : 1;
      const factF1 =
        factPrecision + factRecall > 0
          ? (2 * factPrecision * factRecall) / (factPrecision + factRecall)
          : 0;

      // Match causal links (1-to-1)
      const { matches: causalMatches, matchedPairs: causalMatchedPairs } =
        matchCausalLinksOneToOne(testCase.expectedCausalLinks, extractedCausal);
      const causalPrecision =
        extractedCausal.length > 0 ? causalMatchedPairs / extractedCausal.length : 1;
      const causalRecall =
        testCase.expectedCausalLinks.length > 0
          ? causalMatchedPairs / testCase.expectedCausalLinks.length
          : 1;
      const causalF1 =
        causalPrecision + causalRecall > 0
          ? (2 * causalPrecision * causalRecall) / (causalPrecision + causalRecall)
          : 0;

      result = {
        testCaseId: testCase.id,
        category: testCase.category,
        factResults: {
          expected: testCase.expectedFacts.length,
          extracted: extractedFacts.length,
          matched: factMatchedPairs,
          precision: factPrecision,
          recall: factRecall,
          f1: factF1,
          details: factMatches,
        },
        causalResults: {
          expected: testCase.expectedCausalLinks.length,
          extracted: extractedCausal.length,
          matched: causalMatchedPairs,
          precision: causalPrecision,
          recall: causalRecall,
          f1: causalF1,
          details: causalMatches,
        },
        extractionTimeMs: Date.now() - caseStart,
      };
    } catch (err) {
      result = {
        testCaseId: testCase.id,
        category: testCase.category,
        factResults: {
          expected: 0,
          extracted: 0,
          matched: 0,
          precision: 0,
          recall: 0,
          f1: 0,
          details: [],
        },
        causalResults: {
          expected: 0,
          extracted: 0,
          matched: 0,
          precision: 0,
          recall: 0,
          f1: 0,
          details: [],
        },
        extractionTimeMs: Date.now() - caseStart,
        error: String(err),
      };
    }

    results.push(result);

    if (options.verbose) {
      console.log(
        `  Facts: P=${result.factResults.precision.toFixed(2)} R=${result.factResults.recall.toFixed(2)} F1=${result.factResults.f1.toFixed(2)}`,
      );
      console.log(
        `  Causal: P=${result.causalResults.precision.toFixed(2)} R=${result.causalResults.recall.toFixed(2)} F1=${result.causalResults.f1.toFixed(2)}`,
      );
    }
  }

  // Calculate overall metrics
  const totalExpectedFacts = results.reduce((sum, r) => sum + r.factResults.expected, 0);
  const totalExtractedFacts = results.reduce((sum, r) => sum + r.factResults.extracted, 0);
  const totalMatchedFacts = results.reduce((sum, r) => sum + r.factResults.matched, 0);

  const totalExpectedCausal = results.reduce((sum, r) => sum + r.causalResults.expected, 0);
  const totalExtractedCausal = results.reduce((sum, r) => sum + r.causalResults.extracted, 0);
  const totalMatchedCausal = results.reduce((sum, r) => sum + r.causalResults.matched, 0);

  const overallFactPrecision =
    totalExtractedFacts > 0 ? totalMatchedFacts / totalExtractedFacts : 1;
  const overallFactRecall = totalExpectedFacts > 0 ? totalMatchedFacts / totalExpectedFacts : 1;
  const overallFactF1 =
    overallFactPrecision + overallFactRecall > 0
      ? (2 * overallFactPrecision * overallFactRecall) / (overallFactPrecision + overallFactRecall)
      : 0;

  const overallCausalPrecision =
    totalExtractedCausal > 0 ? totalMatchedCausal / totalExtractedCausal : 1;
  const overallCausalRecall =
    totalExpectedCausal > 0 ? totalMatchedCausal / totalExpectedCausal : 1;
  const overallCausalF1 =
    overallCausalPrecision + overallCausalRecall > 0
      ? (2 * overallCausalPrecision * overallCausalRecall) /
        (overallCausalPrecision + overallCausalRecall)
      : 0;

  // Calculate by category
  const byCategory: AccuracyReport["byCategory"] = {};
  for (const cat of DATASET_CATEGORIES) {
    const catResults = results.filter((r) => r.category === cat);
    if (catResults.length > 0) {
      byCategory[cat] = {
        count: catResults.length,
        factF1: catResults.reduce((sum, r) => sum + r.factResults.f1, 0) / catResults.length,
        causalF1: catResults.reduce((sum, r) => sum + r.causalResults.f1, 0) / catResults.length,
      };
    }
  }

  const totalTimeMs = Date.now() - startTime;

  return {
    timestamp: new Date().toISOString(),
    model,
    overall: {
      factPrecision: overallFactPrecision,
      factRecall: overallFactRecall,
      factF1: overallFactF1,
      causalPrecision: overallCausalPrecision,
      causalRecall: overallCausalRecall,
      causalF1: overallCausalF1,
      meetsTargets: overallFactRecall >= 0.85 && overallCausalF1 >= 0.7,
    },
    byCategory,
    testCases: results,
    summary: {
      totalTestCases: results.length,
      totalExpectedFacts,
      totalExtractedFacts,
      totalMatchedFacts,
      totalExpectedCausal,
      totalExtractedCausal,
      totalMatchedCausal,
      totalTimeMs,
      avgTimePerCase: results.length > 0 ? totalTimeMs / results.length : 0,
    },
  };
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format accuracy report for display
 */
export function formatAccuracyReport(report: AccuracyReport): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════════════════",
    "           SHEEP AI - EXTRACTION ACCURACY REPORT                   ",
    "═══════════════════════════════════════════════════════════════════",
    "",
    `Model: ${report.model}`,
    `Timestamp: ${report.timestamp}`,
    `Test Cases: ${report.summary.totalTestCases}`,
    "",
    "OVERALL RESULTS",
    "───────────────────────────────────────────────────────────────────",
    "Fact Extraction:",
    `  Precision: ${(report.overall.factPrecision * 100).toFixed(1)}%`,
    `  Recall:    ${(report.overall.factRecall * 100).toFixed(1)}%  ${report.overall.factRecall >= 0.85 ? "✅ (target: 85%)" : "❌ (target: 85%)"}`,
    `  F1 Score:  ${(report.overall.factF1 * 100).toFixed(1)}%`,
    "",
    "Causal Link Extraction:",
    `  Precision: ${(report.overall.causalPrecision * 100).toFixed(1)}%`,
    `  Recall:    ${(report.overall.causalRecall * 100).toFixed(1)}%`,
    `  F1 Score:  ${(report.overall.causalF1 * 100).toFixed(1)}%  ${report.overall.causalF1 >= 0.7 ? "✅ (target: 70%)" : "❌ (target: 70%)"}`,
    "",
    `Meets Targets: ${report.overall.meetsTargets ? "✅ YES" : "❌ NO"}`,
    "",
    "BY CATEGORY",
    "───────────────────────────────────────────────────────────────────",
  ];

  for (const [cat, stats] of Object.entries(report.byCategory)) {
    lines.push(
      `  ${cat}: ${stats.count} cases, Fact F1=${(stats.factF1 * 100).toFixed(0)}%, Causal F1=${(stats.causalF1 * 100).toFixed(0)}%`,
    );
  }

  lines.push("");
  lines.push("SUMMARY");
  lines.push("───────────────────────────────────────────────────────────────────");
  lines.push(
    `Expected Facts: ${report.summary.totalExpectedFacts}, Extracted: ${report.summary.totalExtractedFacts}, Matched: ${report.summary.totalMatchedFacts}`,
  );
  lines.push(
    `Expected Causal: ${report.summary.totalExpectedCausal}, Extracted: ${report.summary.totalExtractedCausal}, Matched: ${report.summary.totalMatchedCausal}`,
  );
  lines.push(
    `Total Time: ${report.summary.totalTimeMs}ms (avg ${report.summary.avgTimePerCase.toFixed(0)}ms/case)`,
  );
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════════");

  return lines.join("\n");
}

/**
 * Export accuracy report to JSON
 */
export function exportAccuracyReport(report: AccuracyReport): string {
  return JSON.stringify(report, null, 2);
}
