/**
 * BREAKTHROUGH TEST 1: Task Performance
 *
 * Hypothesis: An AI assistant with SHEEP memory will answer follow-up
 * questions MORE ACCURATELY than one without memory.
 *
 * Test Design:
 * 1. Feed the system a series of "past conversations" to learn from
 * 2. Ask follow-up questions that REQUIRE remembering past info
 * 3. Compare: AI + SHEEP vs AI alone (no memory)
 * 4. Measure: Accuracy of answers
 *
 * This is the REAL test - not "can we extract?" but "does extracting HELP?"
 */

import {
  extractFactsWithLLM,
  createSheepLLMProvider,
  type LLMProvider,
} from "../../extraction/llm-extractor.js";

// =============================================================================
// TEST CASES - Past conversations and follow-up questions
// =============================================================================

type TaskTestCase = {
  id: string;
  /** Past conversations to "remember" */
  pastConversations: string[];
  /** Question that requires memory to answer correctly */
  followUpQuestion: string;
  /** The correct answer (or key facts that must be in the answer) */
  correctAnswer: string;
  /** Keywords that MUST appear in a correct answer */
  requiredKeywords: string[];
};

export const TASK_TEST_CASES: TaskTestCase[] = [
  {
    id: "remember-name",
    pastConversations: [
      `User: Hi! My name is Marcus and I work at Stripe.
Assistant: Nice to meet you, Marcus! What do you do at Stripe?
User: I'm a backend engineer focusing on payment processing.`,
    ],
    followUpQuestion: "What's my name and where do I work?",
    correctAnswer: "Your name is Marcus and you work at Stripe as a backend engineer.",
    requiredKeywords: ["Marcus", "Stripe"],
  },
  {
    id: "remember-preference",
    pastConversations: [
      `User: I really hate using Jira. It's so slow.
Assistant: Many developers feel that way. What do you prefer?
User: We switched to Linear and it's much better.`,
    ],
    followUpQuestion: "What project management tool should you recommend to me?",
    correctAnswer: "I should recommend Linear since you prefer it over Jira.",
    requiredKeywords: ["Linear"],
  },
  {
    id: "remember-technical-context",
    pastConversations: [
      `User: Our API is built with FastAPI and we use PostgreSQL.
Assistant: Solid choices! How's the performance?
User: Great, but we're considering adding Redis for caching.`,
    ],
    followUpQuestion: "If I need to add caching to my API, what should I consider?",
    correctAnswer:
      "Since you use FastAPI with PostgreSQL, Redis would be a good caching layer as you were already considering.",
    requiredKeywords: ["Redis"],
  },
  {
    id: "remember-project-details",
    pastConversations: [
      `User: I'm working on a project called Moonshot. It's a ML pipeline.
Assistant: Interesting! What's the goal?
User: Automated data labeling using GPT-4. We process about 10k items daily.`,
    ],
    followUpQuestion: "Tell me about my project.",
    correctAnswer:
      "Your project Moonshot is an ML pipeline for automated data labeling using GPT-4, processing 10k items daily.",
    requiredKeywords: ["Moonshot", "GPT-4", "labeling"],
  },
  {
    id: "remember-past-problem",
    pastConversations: [
      `User: We had a major outage last week. Certificate expired.
Assistant: That's a common issue. Did you fix it?
User: Yes, we added automated cert renewal with Let's Encrypt.`,
    ],
    followUpQuestion: "What should I do to prevent certificate-related outages?",
    correctAnswer:
      "Based on your past experience, automated cert renewal with Let's Encrypt worked well for you.",
    requiredKeywords: ["Let's Encrypt", "automated"],
  },
  {
    id: "remember-team-structure",
    pastConversations: [
      `User: I'm the tech lead for a team of 5 engineers.
Assistant: Nice team size! What's your focus?
User: We own the authentication service. OAuth, SSO, the whole thing.`,
    ],
    followUpQuestion: "Who should I talk to about OAuth issues in my company?",
    correctAnswer:
      "You're the tech lead of the authentication team that handles OAuth, so you'd be the person.",
    requiredKeywords: ["authentication", "OAuth"],
  },
  {
    id: "remember-timezone",
    pastConversations: [
      `User: I'm based in Tokyo. The timezone difference makes meetings hard.
Assistant: That's tough. What time works best for you?
User: I prefer meetings between 9-11 AM JST.`,
    ],
    followUpQuestion: "When should I schedule a meeting with you?",
    correctAnswer: "Between 9-11 AM JST since you're based in Tokyo.",
    requiredKeywords: ["9", "11", "JST", "Tokyo"],
  },
  {
    id: "remember-learning-goal",
    pastConversations: [
      `User: I want to learn Rust this year. Been doing Python for 5 years.
Assistant: Great goal! Any specific projects in mind?
User: I want to rewrite our data pipeline for better performance.`,
    ],
    followUpQuestion: "What programming language should I help you learn?",
    correctAnswer: "Rust, since you mentioned wanting to learn it to rewrite your data pipeline.",
    requiredKeywords: ["Rust"],
  },
  {
    id: "remember-family",
    pastConversations: [
      `User: My daughter Emma just started kindergarten.
Assistant: That's exciting! How old is she?
User: She's 5. Growing up so fast.`,
    ],
    followUpQuestion: "Do I have any children?",
    correctAnswer: "Yes, you have a daughter named Emma who is 5 and just started kindergarten.",
    requiredKeywords: ["Emma", "5", "daughter"],
  },
  {
    id: "remember-constraint",
    pastConversations: [
      `User: Our budget for the new service is capped at $500/month.
Assistant: That's reasonable. What are you building?
User: A real-time notification system. Needs to handle 1M messages/day.`,
    ],
    followUpQuestion: "What constraints should I keep in mind for your notification system?",
    correctAnswer: "Budget is $500/month max, and it needs to handle 1M messages per day.",
    requiredKeywords: ["500", "1M", "messages"],
  },
];

// =============================================================================
// TEST RUNNER
// =============================================================================

export type TaskPerformanceResult = {
  testId: string;
  withMemory: {
    answer: string;
    containsKeywords: boolean;
    keywordsFound: string[];
    keywordsMissing: string[];
  };
  withoutMemory: {
    answer: string;
    containsKeywords: boolean;
    keywordsFound: string[];
    keywordsMissing: string[];
  };
  memoryWins: boolean;
};

/**
 * Check if an answer contains the required keywords
 */
function checkKeywords(answer: string, keywords: string[]): { found: string[]; missing: string[] } {
  const answerLower = answer.toLowerCase();
  const found: string[] = [];
  const missing: string[] = [];

  for (const kw of keywords) {
    if (answerLower.includes(kw.toLowerCase())) {
      found.push(kw);
    } else {
      missing.push(kw);
    }
  }

  return { found, missing };
}

/**
 * Run task performance test
 */
export async function runTaskPerformanceTest(options?: {
  limit?: number;
  verbose?: boolean;
}): Promise<{
  results: TaskPerformanceResult[];
  summary: {
    total: number;
    memoryWins: number;
    noMemoryWins: number;
    ties: number;
    memoryWinRate: number;
  };
}> {
  const llm = await createSheepLLMProvider("extraction", { extractionModel: "claude-opus-4-5" });

  let testCases = [...TASK_TEST_CASES];
  if (options?.limit) {
    testCases = testCases.slice(0, options.limit);
  }

  const results: TaskPerformanceResult[] = [];

  for (const testCase of testCases) {
    if (options?.verbose) {
      console.log(`\nTesting: ${testCase.id}`);
    }

    // Step 1: Extract facts from past conversations (SHEEP memory)
    const allFacts: string[] = [];
    for (const conv of testCase.pastConversations) {
      const facts = await extractFactsWithLLM(llm, conv, `task-${testCase.id}`);
      for (const f of facts) {
        allFacts.push(`${f.subject} ${f.predicate} ${f.object}`);
      }
    }

    // Step 2: Answer WITH memory (facts injected into context)
    const memoryContext =
      allFacts.length > 0
        ? `\n\nRelevant facts I remember about you:\n${allFacts.map((f) => `- ${f}`).join("\n")}\n\n`
        : "";

    const withMemoryPrompt = `You are a helpful assistant.${memoryContext}User question: ${testCase.followUpQuestion}\n\nAnswer concisely based on what you know about the user.`;
    const withMemoryAnswer = await llm.complete(withMemoryPrompt, {
      maxTokens: 200,
      temperature: 0.1,
    });

    // Step 3: Answer WITHOUT memory (no facts)
    const withoutMemoryPrompt = `You are a helpful assistant.\n\nUser question: ${testCase.followUpQuestion}\n\nAnswer concisely. If you don't have specific information about the user, say so.`;
    const withoutMemoryAnswer = await llm.complete(withoutMemoryPrompt, {
      maxTokens: 200,
      temperature: 0.1,
    });

    // Step 4: Check keywords
    const withMemoryKeywords = checkKeywords(withMemoryAnswer, testCase.requiredKeywords);
    const withoutMemoryKeywords = checkKeywords(withoutMemoryAnswer, testCase.requiredKeywords);

    const withMemoryScore = withMemoryKeywords.found.length;
    const withoutMemoryScore = withoutMemoryKeywords.found.length;

    const result: TaskPerformanceResult = {
      testId: testCase.id,
      withMemory: {
        answer: withMemoryAnswer.trim(),
        containsKeywords: withMemoryKeywords.missing.length === 0,
        keywordsFound: withMemoryKeywords.found,
        keywordsMissing: withMemoryKeywords.missing,
      },
      withoutMemory: {
        answer: withoutMemoryAnswer.trim(),
        containsKeywords: withoutMemoryKeywords.missing.length === 0,
        keywordsFound: withoutMemoryKeywords.found,
        keywordsMissing: withoutMemoryKeywords.missing,
      },
      memoryWins: withMemoryScore > withoutMemoryScore,
    };

    results.push(result);

    if (options?.verbose) {
      console.log(`  Memory answer: ${result.withMemory.answer.substring(0, 100)}...`);
      console.log(`  Memory keywords: ${result.withMemory.keywordsFound.join(", ") || "none"}`);
      console.log(`  No-memory answer: ${result.withoutMemory.answer.substring(0, 100)}...`);
      console.log(
        `  No-memory keywords: ${result.withoutMemory.keywordsFound.join(", ") || "none"}`,
      );
      console.log(
        `  Winner: ${result.memoryWins ? "MEMORY" : withMemoryScore === withoutMemoryScore ? "TIE" : "NO-MEMORY"}`,
      );
    }
  }

  // Calculate summary
  const memoryWins = results.filter((r) => r.memoryWins).length;
  const noMemoryWins = results.filter((r) => {
    const withScore = r.withMemory.keywordsFound.length;
    const withoutScore = r.withoutMemory.keywordsFound.length;
    return withoutScore > withScore;
  }).length;
  const ties = results.length - memoryWins - noMemoryWins;

  return {
    results,
    summary: {
      total: results.length,
      memoryWins,
      noMemoryWins,
      ties,
      memoryWinRate: memoryWins / results.length,
    },
  };
}

/**
 * Format results for display
 */
export function formatTaskPerformanceResults(
  results: Awaited<ReturnType<typeof runTaskPerformanceTest>>,
): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════════════════",
    "      BREAKTHROUGH TEST 1: TASK PERFORMANCE                        ",
    "═══════════════════════════════════════════════════════════════════",
    "",
    "Question: Does SHEEP memory help AI answer better?",
    "",
    "RESULTS",
    "───────────────────────────────────────────────────────────────────",
  ];

  for (const r of results.results) {
    const winner = r.memoryWins
      ? "✅ MEMORY"
      : r.withMemory.keywordsFound.length === r.withoutMemory.keywordsFound.length
        ? "➖ TIE"
        : "❌ NO-MEMORY";
    lines.push(`  ${r.testId}: ${winner}`);
    lines.push(
      `    With memory: ${r.withMemory.keywordsFound.length}/${r.withMemory.keywordsFound.length + r.withMemory.keywordsMissing.length} keywords`,
    );
    lines.push(
      `    Without:     ${r.withoutMemory.keywordsFound.length}/${r.withoutMemory.keywordsFound.length + r.withoutMemory.keywordsMissing.length} keywords`,
    );
  }

  lines.push("");
  lines.push("SUMMARY");
  lines.push("───────────────────────────────────────────────────────────────────");
  lines.push(`  Total tests: ${results.summary.total}`);
  lines.push(
    `  Memory wins: ${results.summary.memoryWins} (${(results.summary.memoryWinRate * 100).toFixed(1)}%)`,
  );
  lines.push(`  No-memory wins: ${results.summary.noMemoryWins}`);
  lines.push(`  Ties: ${results.summary.ties}`);
  lines.push("");

  if (results.summary.memoryWinRate >= 0.7) {
    lines.push("VERDICT: ✅ SHEEP MEMORY SIGNIFICANTLY IMPROVES TASK PERFORMANCE");
  } else if (results.summary.memoryWinRate >= 0.5) {
    lines.push("VERDICT: ⚠️ SHEEP MEMORY SHOWS MODEST IMPROVEMENT");
  } else {
    lines.push("VERDICT: ❌ SHEEP MEMORY DOES NOT IMPROVE TASK PERFORMANCE");
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════════");

  return lines.join("\n");
}
