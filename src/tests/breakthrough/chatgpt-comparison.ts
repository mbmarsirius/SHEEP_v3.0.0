/**
 * BREAKTHROUGH TEST 4: ChatGPT Memory Comparison
 *
 * This test creates a standardized benchmark that can be run on both:
 * - SHEEP AI (automated)
 * - ChatGPT (manual - copy/paste the conversations and questions)
 *
 * The test measures:
 * 1. Simple fact recall (name, location, company)
 * 2. Complex fact recall (preferences with reasoning)
 * 3. Causal relationship recall
 * 4. Contradiction handling
 */

import {
  extractFactsWithLLM,
  extractCausalLinksWithLLM,
  createSheepLLMProvider,
} from "../../extraction/llm-extractor.js";

// =============================================================================
// STANDARDIZED TEST CASES FOR FAIR COMPARISON
// =============================================================================

export type ComparisonTestCase = {
  id: string;
  category: "simple" | "complex" | "causal" | "contradiction";
  /** The "past conversation" to remember */
  pastConversation: string;
  /** The question to ask later */
  testQuestion: string;
  /** Expected facts in the answer */
  expectedInAnswer: string[];
  /** Facts that should NOT be in the answer (for contradiction tests) */
  shouldNotInclude?: string[];
};

export const COMPARISON_TEST_CASES: ComparisonTestCase[] = [
  // SIMPLE FACT RECALL
  {
    id: "simple-1",
    category: "simple",
    pastConversation: `User: My name is David Chen and I work at Anthropic as a research engineer.
Assistant: Nice to meet you, David! What kind of research do you focus on?
User: Mainly safety research and interpretability work.`,
    testQuestion: "What is my name and where do I work?",
    expectedInAnswer: ["David", "Chen", "Anthropic"],
  },
  {
    id: "simple-2",
    category: "simple",
    pastConversation: `User: I live in Seattle but I'm originally from Portland.
Assistant: The Pacific Northwest is beautiful! How long have you been in Seattle?
User: About 3 years now. Moved for a job at AWS.`,
    testQuestion: "Where do I live and where am I from?",
    expectedInAnswer: ["Seattle", "Portland"],
  },
  {
    id: "simple-3",
    category: "simple",
    pastConversation: `User: My email is dev.marcus@techstartup.io and my phone is 415-555-0123.
Assistant: Got it, I'll note those down.
User: Great, use the email for work stuff.`,
    testQuestion: "What is my email address?",
    expectedInAnswer: ["dev.marcus@techstartup.io"],
  },

  // COMPLEX FACT RECALL (preferences with context)
  {
    id: "complex-1",
    category: "complex",
    pastConversation: `User: I really hate using Slack. The notifications are overwhelming.
Assistant: That's a common complaint. What do you prefer?
User: My team switched to Discord and it's much better for us.
Assistant: Discord has nice notification controls.
User: Exactly, and the threading is cleaner.`,
    testQuestion: "What communication tool should you recommend to me and why?",
    expectedInAnswer: ["Discord", "notification", "threading"],
  },
  {
    id: "complex-2",
    category: "complex",
    pastConversation: `User: I prefer TypeScript over JavaScript because of the type safety.
Assistant: Types do catch a lot of bugs early.
User: Yeah, I also like that my IDE gives better autocomplete with TS.
User: Started using it 2 years ago and never looked back.`,
    testQuestion: "What programming language do I prefer and why?",
    expectedInAnswer: ["TypeScript", "type", "safety"],
  },

  // CAUSAL RELATIONSHIP RECALL
  {
    id: "causal-1",
    category: "causal",
    pastConversation: `User: We had a major incident last week. Our API started timing out.
Assistant: That's serious. Did you find the root cause?
User: Yes, it was a missing database index. Once we added it, response times dropped from 5s to 50ms.
Assistant: Indexes make a huge difference!`,
    testQuestion: "What caused my API timeouts and how did I fix it?",
    expectedInAnswer: ["index", "database", "50ms"],
  },
  {
    id: "causal-2",
    category: "causal",
    pastConversation: `User: Our Docker builds were taking forever - like 20 minutes each.
Assistant: That's painful for CI/CD. What did you do?
User: Switched to multi-stage builds and layer caching. Now it's 3 minutes.
Assistant: Great improvement!`,
    testQuestion: "What was slowing down my Docker builds and what fixed it?",
    expectedInAnswer: ["multi-stage", "caching", "3 minutes"],
  },

  // CONTRADICTION HANDLING
  {
    id: "contradiction-1",
    category: "contradiction",
    pastConversation: `User: I work at Google.
Assistant: Nice! What team?
User: Actually, I made a mistake. I work at GitHub, not Google.
Assistant: GitHub, got it.
User: Yeah, I'm on the Actions team.`,
    testQuestion: "Where do I work?",
    expectedInAnswer: ["GitHub"],
    shouldNotInclude: ["Google"],
  },
  {
    id: "contradiction-2",
    category: "contradiction",
    pastConversation: `User: Our server has 32GB of RAM.
Assistant: That should be enough for most workloads.
User: Wait, I just checked - it's actually 64GB. We upgraded last month.
Assistant: 64GB gives you more headroom.`,
    testQuestion: "How much RAM does my server have?",
    expectedInAnswer: ["64GB"],
    shouldNotInclude: ["32GB"],
  },
];

// =============================================================================
// SHEEP TEST RUNNER
// =============================================================================

export type SheepComparisonResult = {
  testId: string;
  category: string;
  extractedFacts: string[];
  extractedCausalLinks: string[];
  generatedAnswer: string;
  expectedFound: string[];
  expectedMissing: string[];
  incorrectIncluded: string[];
  score: number; // 0-1
};

/**
 * Run SHEEP on the comparison test cases
 */
export async function runSheepComparison(options?: { verbose?: boolean }): Promise<{
  results: SheepComparisonResult[];
  summary: {
    total: number;
    avgScore: number;
    byCategory: Record<string, number>;
  };
}> {
  const llm = await createSheepLLMProvider("extraction", { extractionModel: "claude-opus-4-5" });

  const results: SheepComparisonResult[] = [];

  for (const testCase of COMPARISON_TEST_CASES) {
    if (options?.verbose) {
      console.log(`\nTesting: ${testCase.id} (${testCase.category})`);
    }

    // Extract facts
    const facts = await extractFactsWithLLM(
      llm,
      testCase.pastConversation,
      `compare-${testCase.id}`,
    );
    const causalLinks = await extractCausalLinksWithLLM(
      llm,
      testCase.pastConversation,
      `compare-${testCase.id}`,
    );

    // Format extracted info
    const extractedFacts = facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`);
    const extractedCausal = causalLinks.map(
      (c) => `${c.causeDescription} → ${c.effectDescription}`,
    );

    // Generate answer using extracted facts
    const memoryContext = [
      ...extractedFacts.map((f) => `- ${f}`),
      ...extractedCausal.map((c) => `- Causal: ${c}`),
    ].join("\n");

    const answerPrompt = `You are a helpful assistant. Based on what you know about the user:

${memoryContext}

Question: ${testCase.testQuestion}

Answer concisely.`;

    const answer = await llm.complete(answerPrompt, { maxTokens: 200, temperature: 0.1 });

    // Check answer quality
    const answerLower = answer.toLowerCase();
    const expectedFound: string[] = [];
    const expectedMissing: string[] = [];
    const incorrectIncluded: string[] = [];

    for (const expected of testCase.expectedInAnswer) {
      if (answerLower.includes(expected.toLowerCase())) {
        expectedFound.push(expected);
      } else {
        expectedMissing.push(expected);
      }
    }

    if (testCase.shouldNotInclude) {
      for (const bad of testCase.shouldNotInclude) {
        if (answerLower.includes(bad.toLowerCase())) {
          incorrectIncluded.push(bad);
        }
      }
    }

    // Calculate score
    const expectedScore = expectedFound.length / testCase.expectedInAnswer.length;
    const penaltyScore = testCase.shouldNotInclude
      ? 1 - incorrectIncluded.length / testCase.shouldNotInclude.length
      : 1;
    const score = expectedScore * penaltyScore;

    const result: SheepComparisonResult = {
      testId: testCase.id,
      category: testCase.category,
      extractedFacts,
      extractedCausalLinks: extractedCausal,
      generatedAnswer: answer.trim(),
      expectedFound,
      expectedMissing,
      incorrectIncluded,
      score,
    };

    results.push(result);

    if (options?.verbose) {
      console.log(`  Score: ${(score * 100).toFixed(0)}%`);
      console.log(`  Found: ${expectedFound.join(", ") || "none"}`);
      console.log(`  Missing: ${expectedMissing.join(", ") || "none"}`);
      if (incorrectIncluded.length > 0) {
        console.log(`  Incorrect: ${incorrectIncluded.join(", ")}`);
      }
    }
  }

  // Calculate summary
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  const byCategory: Record<string, number> = {};
  for (const cat of ["simple", "complex", "causal", "contradiction"]) {
    const catResults = results.filter((r) => r.category === cat);
    if (catResults.length > 0) {
      byCategory[cat] = catResults.reduce((sum, r) => sum + r.score, 0) / catResults.length;
    }
  }

  return {
    results,
    summary: {
      total: results.length,
      avgScore,
      byCategory,
    },
  };
}

/**
 * Format results for display
 */
export function formatComparisonResults(
  results: Awaited<ReturnType<typeof runSheepComparison>>,
): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════════════════",
    "      BREAKTHROUGH TEST 4: CHATGPT COMPARISON                      ",
    "═══════════════════════════════════════════════════════════════════",
    "",
    "SHEEP AI RESULTS",
    "───────────────────────────────────────────────────────────────────",
  ];

  for (const r of results.results) {
    const status = r.score >= 0.8 ? "✅" : r.score >= 0.5 ? "⚠️" : "❌";
    lines.push(`  ${r.testId} (${r.category}): ${status} ${(r.score * 100).toFixed(0)}%`);
  }

  lines.push("");
  lines.push("BY CATEGORY");
  lines.push("───────────────────────────────────────────────────────────────────");
  for (const [cat, score] of Object.entries(results.summary.byCategory)) {
    lines.push(`  ${cat}: ${(score * 100).toFixed(0)}%`);
  }

  lines.push("");
  lines.push("OVERALL SHEEP SCORE");
  lines.push("───────────────────────────────────────────────────────────────────");
  lines.push(`  ${(results.summary.avgScore * 100).toFixed(1)}%`);
  lines.push("");

  lines.push("TO COMPARE WITH CHATGPT:");
  lines.push("───────────────────────────────────────────────────────────────────");
  lines.push("  1. Start a new ChatGPT conversation");
  lines.push("  2. Enable memory feature");
  lines.push("  3. Send the 'past conversation' texts");
  lines.push("  4. Then ask the test questions");
  lines.push("  5. Score based on same criteria");
  lines.push("");
  lines.push("  Test cases available in: src/sheep/tests/breakthrough/chatgpt-comparison.ts");
  lines.push("");

  if (results.summary.avgScore >= 0.85) {
    lines.push("VERDICT: ✅ SHEEP ACHIEVES COMPARABLE MEMORY RECALL");
  } else if (results.summary.avgScore >= 0.7) {
    lines.push("VERDICT: ⚠️ SHEEP SHOWS GOOD BUT NOT PERFECT RECALL");
  } else {
    lines.push("VERDICT: ❌ SHEEP NEEDS IMPROVEMENT");
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════════");

  return lines.join("\n");
}

/**
 * Generate a markdown document for manual ChatGPT comparison
 */
export function generateChatGPTTestDocument(): string {
  const lines: string[] = [
    "# ChatGPT Memory Comparison Test",
    "",
    "## Instructions",
    "1. Open ChatGPT (with memory enabled)",
    "2. For each test case:",
    "   - First, send the 'Past Conversation' as if you're the user",
    "   - Wait for ChatGPT to respond",
    "   - Then start a NEW conversation (or wait a while)",
    "   - Ask the 'Test Question'",
    "   - Check if the answer contains the 'Expected' information",
    "",
    "---",
    "",
  ];

  for (const tc of COMPARISON_TEST_CASES) {
    lines.push(`## Test: ${tc.id} (${tc.category})`);
    lines.push("");
    lines.push("### Past Conversation");
    lines.push("```");
    lines.push(tc.pastConversation);
    lines.push("```");
    lines.push("");
    lines.push("### Test Question");
    lines.push(`> ${tc.testQuestion}`);
    lines.push("");
    lines.push("### Expected in Answer");
    lines.push(tc.expectedInAnswer.map((e) => `- ${e}`).join("\n"));
    if (tc.shouldNotInclude) {
      lines.push("");
      lines.push("### Should NOT Include");
      lines.push(tc.shouldNotInclude.map((e) => `- ❌ ${e}`).join("\n"));
    }
    lines.push("");
    lines.push("### ChatGPT Score: ___ / " + tc.expectedInAnswer.length);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  lines.push("| Test | SHEEP | ChatGPT |");
  lines.push("|------|-------|---------|");
  for (const tc of COMPARISON_TEST_CASES) {
    lines.push(`| ${tc.id} | ___% | ___% |`);
  }
  lines.push("");
  lines.push("**Total SHEEP: ___%**");
  lines.push("**Total ChatGPT: ___%**");

  return lines.join("\n");
}
