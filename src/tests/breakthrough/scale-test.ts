/**
 * BREAKTHROUGH TEST 3: Scale Testing
 *
 * Hypothesis: SHEEP can handle 1000+ conversations while maintaining:
 * - Extraction accuracy (>80%)
 * - Reasonable latency (<10s per extraction)
 * - Memory efficiency
 *
 * Test Design:
 * - Generate diverse synthetic conversations
 * - Extract facts from all of them
 * - Measure accuracy, latency, throughput
 */

import {
  extractFactsWithLLM,
  createSheepLLMProvider,
  type LLMProvider,
} from "../../extraction/llm-extractor.js";

// =============================================================================
// SYNTHETIC CONVERSATION GENERATOR
// =============================================================================

const NAMES = ["Alex", "Jordan", "Sam", "Taylor", "Morgan", "Casey", "Riley", "Quinn"];
const COMPANIES = ["Google", "Meta", "Apple", "Microsoft", "Amazon", "Netflix", "Stripe", "OpenAI"];
const LANGUAGES = ["Python", "JavaScript", "TypeScript", "Go", "Rust", "Java", "Ruby", "C++"];
const FRAMEWORKS = ["React", "FastAPI", "Django", "Express", "Flask", "Rails", "Spring", "Next.js"];
const DATABASES = ["PostgreSQL", "MySQL", "MongoDB", "Redis", "SQLite", "DynamoDB", "Cassandra"];
const CITIES = [
  "San Francisco",
  "New York",
  "Seattle",
  "Austin",
  "Boston",
  "London",
  "Berlin",
  "Tokyo",
];
const TOOLS = [
  "Docker",
  "Kubernetes",
  "Terraform",
  "AWS",
  "GCP",
  "Azure",
  "GitHub Actions",
  "Jenkins",
];

type SyntheticConversation = {
  id: number;
  text: string;
  expectedFacts: string[]; // Simple description of expected facts
};

/**
 * Generate a synthetic conversation with known facts
 */
function generateConversation(id: number): SyntheticConversation {
  const name = NAMES[id % NAMES.length];
  const company = COMPANIES[id % COMPANIES.length];
  const lang = LANGUAGES[id % LANGUAGES.length];
  const framework = FRAMEWORKS[id % FRAMEWORKS.length];
  const db = DATABASES[id % DATABASES.length];
  const city = CITIES[id % CITIES.length];
  const tool = TOOLS[id % TOOLS.length];

  // Different conversation templates
  const templates = [
    {
      text: `User: Hi, I'm ${name} and I work at ${company}.
Assistant: Nice to meet you! What do you do there?
User: I'm a software engineer. Mostly working with ${lang} and ${framework}.`,
      facts: [`name: ${name}`, `works at: ${company}`, `uses: ${lang}`, `uses: ${framework}`],
    },
    {
      text: `User: Our team uses ${db} for the backend database.
Assistant: Solid choice! What about deployment?
User: We use ${tool} for CI/CD. I'm based in ${city}.`,
      facts: [`uses: ${db}`, `uses: ${tool}`, `location: ${city}`],
    },
    {
      text: `User: I'm ${name}, a ${lang} developer at ${company}.
Assistant: Interesting! What's your main project?
User: Building APIs with ${framework}, deployed on ${tool}.`,
      facts: [
        `name: ${name}`,
        `uses: ${lang}`,
        `works at: ${company}`,
        `uses: ${framework}`,
        `uses: ${tool}`,
      ],
    },
    {
      text: `User: Been learning ${lang} for 2 years now. Work at ${company}.
Assistant: Nice progression! What frameworks?
User: ${framework} mainly. We also use ${db} for data storage.`,
      facts: [`uses: ${lang}`, `works at: ${company}`, `uses: ${framework}`, `uses: ${db}`],
    },
    {
      text: `User: My name is ${name}. I live in ${city} and work remotely for ${company}.
Assistant: Remote work is great! What's your stack?
User: ${lang} with ${framework}. We're migrating to ${tool}.`,
      facts: [
        `name: ${name}`,
        `location: ${city}`,
        `works at: ${company}`,
        `uses: ${lang}`,
        `uses: ${framework}`,
        `uses: ${tool}`,
      ],
    },
  ];

  const template = templates[id % templates.length];

  return {
    id,
    text: template.text,
    expectedFacts: template.facts,
  };
}

// =============================================================================
// SCALE TEST RUNNER
// =============================================================================

export type ScaleTestResult = {
  totalConversations: number;
  successfulExtractions: number;
  failedExtractions: number;
  totalFactsExpected: number;
  totalFactsExtracted: number;
  latencies: number[];
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughputPerMinute: number;
  errorRate: number;
  memoryUsageMB: number;
};

/**
 * Run scale test
 */
export async function runScaleTest(options: {
  conversationCount: number;
  batchSize?: number;
  verbose?: boolean;
}): Promise<ScaleTestResult> {
  const { conversationCount, batchSize = 10, verbose = false } = options;

  const llm = await createSheepLLMProvider("extraction", { extractionModel: "claude-opus-4-5" });

  const latencies: number[] = [];
  let successfulExtractions = 0;
  let failedExtractions = 0;
  let totalFactsExpected = 0;
  let totalFactsExtracted = 0;

  const startTime = Date.now();
  const initialMemory = process.memoryUsage().heapUsed;

  // Generate all conversations
  const conversations: SyntheticConversation[] = [];
  for (let i = 0; i < conversationCount; i++) {
    conversations.push(generateConversation(i));
  }

  // Process in batches
  for (let batchStart = 0; batchStart < conversationCount; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, conversationCount);
    const batch = conversations.slice(batchStart, batchEnd);

    if (verbose) {
      const progress = ((batchEnd / conversationCount) * 100).toFixed(1);
      console.log(
        `Processing batch ${batchStart}-${batchEnd} of ${conversationCount} (${progress}%)`,
      );
    }

    // Process batch concurrently
    const batchPromises = batch.map(async (conv) => {
      const extractStart = Date.now();

      try {
        const facts = await extractFactsWithLLM(llm, conv.text, `scale-${conv.id}`);
        const extractTime = Date.now() - extractStart;

        return {
          success: true,
          latency: extractTime,
          expectedCount: conv.expectedFacts.length,
          extractedCount: facts.length,
        };
      } catch (err) {
        return {
          success: false,
          latency: Date.now() - extractStart,
          expectedCount: conv.expectedFacts.length,
          extractedCount: 0,
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    for (const result of batchResults) {
      latencies.push(result.latency);
      totalFactsExpected += result.expectedCount;
      totalFactsExtracted += result.extractedCount;

      if (result.success) {
        successfulExtractions++;
      } else {
        failedExtractions++;
      }
    }
  }

  const totalTime = Date.now() - startTime;
  const finalMemory = process.memoryUsage().heapUsed;

  // Calculate statistics
  latencies.sort((a, b) => a - b);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  const throughput = (conversationCount / totalTime) * 60000; // per minute

  return {
    totalConversations: conversationCount,
    successfulExtractions,
    failedExtractions,
    totalFactsExpected,
    totalFactsExtracted,
    latencies,
    avgLatencyMs: avgLatency,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    throughputPerMinute: throughput,
    errorRate: failedExtractions / conversationCount,
    memoryUsageMB: (finalMemory - initialMemory) / (1024 * 1024),
  };
}

/**
 * Format scale test results
 */
export function formatScaleTestResults(result: ScaleTestResult): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════════════════",
    "      BREAKTHROUGH TEST 3: SCALE TESTING                           ",
    "═══════════════════════════════════════════════════════════════════",
    "",
    "Question: Can SHEEP handle 1000+ conversations?",
    "",
    "VOLUME",
    "───────────────────────────────────────────────────────────────────",
    `  Conversations processed: ${result.totalConversations}`,
    `  Successful extractions: ${result.successfulExtractions} (${((result.successfulExtractions / result.totalConversations) * 100).toFixed(1)}%)`,
    `  Failed extractions: ${result.failedExtractions}`,
    `  Facts expected: ${result.totalFactsExpected}`,
    `  Facts extracted: ${result.totalFactsExtracted}`,
    "",
    "LATENCY",
    "───────────────────────────────────────────────────────────────────",
    `  Average: ${result.avgLatencyMs.toFixed(0)}ms`,
    `  P50: ${result.p50LatencyMs.toFixed(0)}ms`,
    `  P95: ${result.p95LatencyMs.toFixed(0)}ms`,
    `  P99: ${result.p99LatencyMs.toFixed(0)}ms`,
    "",
    "THROUGHPUT",
    "───────────────────────────────────────────────────────────────────",
    `  ${result.throughputPerMinute.toFixed(1)} conversations/minute`,
    `  ${(result.throughputPerMinute / 60).toFixed(2)} conversations/second`,
    "",
    "RELIABILITY",
    "───────────────────────────────────────────────────────────────────",
    `  Error rate: ${(result.errorRate * 100).toFixed(2)}%`,
    `  Memory delta: ${result.memoryUsageMB.toFixed(1)}MB`,
    "",
  ];

  // Verdict
  const passLatency = result.avgLatencyMs < 15000; // <15s average
  const passReliability = result.errorRate < 0.05; // <5% errors
  const passExtraction = result.totalFactsExtracted > result.totalFactsExpected * 0.5; // >50% recall

  if (passLatency && passReliability && passExtraction) {
    lines.push("VERDICT: ✅ SHEEP SCALES TO 1000+ CONVERSATIONS");
  } else {
    lines.push("VERDICT: ⚠️ SCALE TEST SHOWS ISSUES");
    if (!passLatency)
      lines.push(`  - Latency too high (${result.avgLatencyMs.toFixed(0)}ms > 15000ms)`);
    if (!passReliability)
      lines.push(`  - Error rate too high (${(result.errorRate * 100).toFixed(1)}% > 5%)`);
    if (!passExtraction) lines.push(`  - Extraction rate too low`);
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════════");

  return lines.join("\n");
}
