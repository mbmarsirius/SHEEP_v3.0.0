#!/usr/bin/env npx tsx
/**
 * SHEEP AI - Integration Test
 *
 * Tests the complete SHEEP memory pipeline:
 * 1. Seed facts via simulated conversation learning
 * 2. Run consolidation
 * 3. Test prefetch retrieval
 * 4. Verify metrics
 * 5. Clean up test data
 *
 * Usage: npx tsx src/sheep/tests/integration-test.ts
 *
 * @module sheep/tests/integration-test
 */

import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";

// Test configuration
const TEST_AGENT_ID = "sheep-integration-test";
const TEST_DB_PATH = join(process.env.HOME ?? "", ".clawdbot", "sheep", `${TEST_AGENT_ID}.sqlite`);

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function log(message: string, color: string = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string): void {
  console.log();
  log(`${"═".repeat(60)}`, colors.cyan);
  log(`  ${title}`, colors.cyan + colors.bold);
  log(`${"═".repeat(60)}`, colors.cyan);
}

function logResult(test: string, passed: boolean, details?: string): void {
  const icon = passed ? "✓" : "✗";
  const color = passed ? colors.green : colors.red;
  log(`  ${icon} ${test}`, color);
  if (details) {
    log(`    ${details}`, colors.yellow);
  }
}

// =============================================================================
// TEST HELPERS
// =============================================================================

async function cleanupTestData(): Promise<void> {
  if (existsSync(TEST_DB_PATH)) {
    rmSync(TEST_DB_PATH);
    log(`  Cleaned up test database: ${TEST_DB_PATH}`, colors.yellow);
  }
}

// =============================================================================
// TEST CASES
// =============================================================================

async function testDatabaseCreation(): Promise<boolean> {
  const { SheepDatabase } = await import("../memory/database.js");

  try {
    const db = new SheepDatabase(TEST_AGENT_ID);
    const stats = db.getStats();
    db.close();

    return stats.agentId === TEST_AGENT_ID;
  } catch (err) {
    console.error("Database creation failed:", err);
    return false;
  }
}

async function testFactInsertion(): Promise<{ passed: boolean; factCount: number }> {
  const { SheepDatabase } = await import("../memory/database.js");
  const { now } = await import("../memory/schema.js");

  try {
    const db = new SheepDatabase(TEST_AGENT_ID);
    const timestamp = now();

    // Insert test facts
    const testFacts = [
      { subject: "test_user", predicate: "prefers_language", object: "TypeScript" },
      { subject: "test_user", predicate: "works_at", object: "Acme Corp" },
      { subject: "test_user", predicate: "favorite_color", object: "blue" },
      { subject: "test_project", predicate: "uses_framework", object: "React" },
      { subject: "test_user", predicate: "lives_in", object: "San Francisco" },
    ];

    for (const fact of testFacts) {
      db.insertFact({
        ...fact,
        confidence: 0.9,
        evidence: ["test-episode-1"],
        firstSeen: timestamp,
        lastConfirmed: timestamp,
        userAffirmed: true,
      });
    }

    const stats = db.getStats();
    db.close();

    return {
      passed: stats.totalFacts === testFacts.length,
      factCount: stats.totalFacts,
    };
  } catch (err) {
    console.error("Fact insertion failed:", err);
    return { passed: false, factCount: 0 };
  }
}

async function testEpisodeInsertion(): Promise<{ passed: boolean; episodeCount: number }> {
  const { SheepDatabase } = await import("../memory/database.js");
  const { now } = await import("../memory/schema.js");

  try {
    const db = new SheepDatabase(TEST_AGENT_ID);
    const timestamp = now();

    // Insert test episodes
    const testEpisodes = [
      {
        timestamp,
        summary:
          "User discussed their programming language preferences, mentioning they love TypeScript",
        participants: ["test_user", "assistant"],
        topic: "programming",
        keywords: ["typescript", "programming", "preferences"],
        emotionalSalience: 0.7,
        utilityScore: 0.8,
        sourceSessionId: "test-session-1",
        sourceMessageIds: ["msg-1", "msg-2"],
        ttl: "30d" as const,
      },
      {
        timestamp,
        summary: "User talked about their work at Acme Corp and current projects",
        participants: ["test_user", "assistant"],
        topic: "work",
        keywords: ["acme", "work", "projects"],
        emotionalSalience: 0.5,
        utilityScore: 0.6,
        sourceSessionId: "test-session-2",
        sourceMessageIds: ["msg-3", "msg-4"],
        ttl: "30d" as const,
      },
    ];

    for (const episode of testEpisodes) {
      db.insertEpisode(episode);
    }

    const stats = db.getStats();
    db.close();

    return {
      passed: stats.totalEpisodes === testEpisodes.length,
      episodeCount: stats.totalEpisodes,
    };
  } catch (err) {
    console.error("Episode insertion failed:", err);
    return { passed: false, episodeCount: 0 };
  }
}

async function testFactRetrieval(): Promise<{ passed: boolean; details: string }> {
  const { SheepDatabase } = await import("../memory/database.js");

  try {
    const db = new SheepDatabase(TEST_AGENT_ID);

    // Query by subject
    const userFacts = db.findFacts({ subject: "test_user" });

    // Query by predicate
    const languageFacts = db.findFacts({ predicate: "prefers_language" });

    // Query by object
    const typescriptFacts = db.findFacts({ object: "TypeScript" });

    db.close();

    const passed =
      userFacts.length === 4 && // 4 facts about test_user
      languageFacts.length === 1 && // 1 language preference fact
      typescriptFacts.length === 1; // 1 fact mentioning TypeScript

    return {
      passed,
      details: `Found: ${userFacts.length} user facts, ${languageFacts.length} language facts, ${typescriptFacts.length} TypeScript facts`,
    };
  } catch (err) {
    console.error("Fact retrieval failed:", err);
    return { passed: false, details: String(err) };
  }
}

async function testPrefetchEngine(): Promise<{ passed: boolean; details: string }> {
  const { analyzePrefetchNeeds, shouldPrefetch, classifyIntent } =
    await import("../prefetch/prefetch-engine.js");

  try {
    // Test intent classification
    const questionIntent = classifyIntent("What programming language do you recommend?");
    const commandIntent = classifyIntent("Create a new React component");
    const referenceIntent = classifyIntent("Remember when we talked about TypeScript?");
    const socialIntent = classifyIntent("Hello, how are you?");

    // Test shouldPrefetch
    const shouldPrefetchQuestion = shouldPrefetch("What's my favorite language?");
    const shouldPrefetchSocial = shouldPrefetch("Hi");

    // Test analyzePrefetchNeeds
    const prediction = analyzePrefetchNeeds("What programming language do I prefer?");

    const passed =
      questionIntent.intentType === "question" &&
      commandIntent.intentType === "command" &&
      referenceIntent.intentType === "reference" &&
      socialIntent.intentType === "social" &&
      shouldPrefetchQuestion === true &&
      shouldPrefetchSocial === false &&
      prediction.predictedNeeds.includes("facts");

    return {
      passed,
      details: `Intents: Q=${questionIntent.intentType}, C=${commandIntent.intentType}, R=${referenceIntent.intentType}, S=${socialIntent.intentType}`,
    };
  } catch (err) {
    console.error("Prefetch engine test failed:", err);
    return { passed: false, details: String(err) };
  }
}

async function testConsolidation(): Promise<{ passed: boolean; details: string }> {
  const { runConsolidation } = await import("../consolidation/consolidator.js");

  try {
    const result = await runConsolidation({
      agentId: TEST_AGENT_ID,
      dryRun: true, // Don't actually modify during test
    });

    const passed = result.success === true;

    return {
      passed,
      details: `Sessions: ${result.sessionsProcessed}, Episodes: ${result.episodesExtracted}, Facts: ${result.factsExtracted}`,
    };
  } catch (err) {
    console.error("Consolidation test failed:", err);
    return { passed: false, details: String(err) };
  }
}

async function testRetentionScoring(): Promise<{ passed: boolean; details: string }> {
  const { SheepDatabase } = await import("../memory/database.js");
  const { calculateEpisodeRetentionScore, calculateFactRetentionScore } =
    await import("../consolidation/forgetting.js");

  try {
    const db = new SheepDatabase(TEST_AGENT_ID);

    const episodes = db.queryEpisodes({ limit: 1 });
    const facts = db.findFacts({ activeOnly: true });

    if (episodes.length === 0 || facts.length === 0) {
      db.close();
      return { passed: false, details: "No episodes or facts to score" };
    }

    const episodeScore = calculateEpisodeRetentionScore(episodes[0], db, {
      includeBreakdown: true,
    }) as {
      score: number;
      breakdown: Record<string, number>;
    };
    const factScore = calculateFactRetentionScore(facts[0], db, { includeBreakdown: true }) as {
      score: number;
      breakdown: Record<string, number>;
    };

    db.close();

    const passed =
      episodeScore.score >= 0 &&
      episodeScore.score <= 1 &&
      factScore.score >= 0 &&
      factScore.score <= 1 &&
      Object.keys(episodeScore.breakdown).length === 7; // 6 factors + total

    return {
      passed,
      details: `Episode retention: ${episodeScore.score.toFixed(3)}, Fact retention: ${factScore.score.toFixed(3)}`,
    };
  } catch (err) {
    console.error("Retention scoring test failed:", err);
    return { passed: false, details: String(err) };
  }
}

async function testMetrics(): Promise<{ passed: boolean; details: string }> {
  const { recordPrefetch, recordLearning, getPrefetchStats, getLearningStats, clearMetrics } =
    await import("../metrics/metrics.js");

  try {
    // Clear any existing metrics
    clearMetrics();

    // Record some test metrics
    recordPrefetch({
      timestamp: Date.now(),
      agentId: TEST_AGENT_ID,
      hadMemories: true,
      factsCount: 3,
      episodesCount: 1,
      durationMs: 50,
      intentType: "question",
    });

    recordPrefetch({
      timestamp: Date.now(),
      agentId: TEST_AGENT_ID,
      hadMemories: false,
      factsCount: 0,
      episodesCount: 0,
      durationMs: 10,
      intentType: "social",
    });

    recordLearning({
      timestamp: Date.now(),
      agentId: TEST_AGENT_ID,
      factsLearned: 5,
      episodesCreated: 1,
      causalLinksFound: 2,
      proceduresExtracted: 1,
      durationMs: 500,
    });

    const prefetchStats = getPrefetchStats(TEST_AGENT_ID);
    const learningStats = getLearningStats(TEST_AGENT_ID);

    // Clear test metrics
    clearMetrics();

    const passed =
      prefetchStats.totalPrefetches === 2 &&
      prefetchStats.successfulPrefetches === 1 &&
      prefetchStats.hitRate === 0.5 &&
      learningStats.totalFactsLearned === 5;

    return {
      passed,
      details: `Prefetch hit rate: ${(prefetchStats.hitRate * 100).toFixed(0)}%, Facts learned: ${learningStats.totalFactsLearned}`,
    };
  } catch (err) {
    console.error("Metrics test failed:", err);
    return { passed: false, details: String(err) };
  }
}

async function testProcedureExtraction(): Promise<{ passed: boolean; details: string }> {
  const { extractProceduresFromEpisode } = await import("../procedures/extractor.js");
  const { SheepDatabase } = await import("../memory/database.js");
  const { now } = await import("../memory/schema.js");

  try {
    const db = new SheepDatabase(TEST_AGENT_ID);
    const timestamp = now();

    // Create an episode with procedural content
    const episode = db.insertEpisode({
      timestamp,
      summary:
        "When debugging TypeScript errors, I always use verbose logging first. For testing React components, I prefer to write unit tests before integration tests.",
      participants: ["test_user", "assistant"],
      topic: "development",
      keywords: ["debugging", "testing", "typescript", "react"],
      emotionalSalience: 0.6,
      utilityScore: 0.9,
      sourceSessionId: "test-session-3",
      sourceMessageIds: ["msg-5"],
      ttl: "30d",
    });

    const procedures = extractProceduresFromEpisode(episode);
    db.close();

    const passed = procedures.length > 0;

    return {
      passed,
      details: `Extracted ${procedures.length} procedures: ${procedures.map((p) => p.trigger.substring(0, 30)).join(", ")}`,
    };
  } catch (err) {
    console.error("Procedure extraction test failed:", err);
    return { passed: false, details: String(err) };
  }
}

async function testCausalExtraction(): Promise<{ passed: boolean; details: string }> {
  const { extractCausalLinksFromEpisode } = await import("../causal/causal-extractor.js");
  const { SheepDatabase } = await import("../memory/database.js");
  const { now } = await import("../memory/schema.js");

  try {
    const db = new SheepDatabase(TEST_AGENT_ID);
    const timestamp = now();

    // Create an episode with causal content
    const episode = db.insertEpisode({
      timestamp,
      summary: `I switched to TypeScript because JavaScript was causing too many runtime errors.
			This led to fewer bugs in production.
			As a result, our team velocity increased by 30%.`,
      participants: ["test_user", "assistant"],
      topic: "technology",
      keywords: ["typescript", "javascript", "bugs"],
      emotionalSalience: 0.6,
      utilityScore: 0.8,
      sourceSessionId: "test-session-causal",
      sourceMessageIds: ["msg-causal"],
      ttl: "30d",
    });

    const links = extractCausalLinksFromEpisode(episode);
    db.close();

    // Links are extracted but not yet saved to DB (no IDs yet)
    // Just verify extraction works
    const passed = links.length > 0;

    return {
      passed,
      details: `Extracted ${links.length} causal links from episode`,
    };
  } catch (err) {
    console.error("Causal extraction test failed:", err);
    return { passed: false, details: String(err) };
  }
}

async function testEndToEndPrefetch(): Promise<{ passed: boolean; details: string }> {
  const { SheepDatabase } = await import("../memory/database.js");

  try {
    const db = new SheepDatabase(TEST_AGENT_ID);

    // Simulate what prefetch does: query facts for entities in a message
    const userMessage = "What programming language do I prefer?";

    // Extract potential entities (simplified)
    const entities = ["test_user", "programming", "language"];

    let foundFacts: Array<{ subject: string; predicate: string; object: string }> = [];
    for (const entity of entities) {
      const facts = db.findFacts({ subject: entity });
      foundFacts.push(
        ...facts.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object })),
      );
    }

    // Also try object match
    const languageFacts = db.findFacts({ predicate: "prefers_language" });
    foundFacts.push(
      ...languageFacts.map((f) => ({
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
      })),
    );

    // Deduplicate
    foundFacts = [
      ...new Map(foundFacts.map((f) => [`${f.subject}:${f.predicate}:${f.object}`, f])).values(),
    ];

    db.close();

    // Check if we found the TypeScript preference
    const foundTypeScript = foundFacts.some(
      (f) => f.object === "TypeScript" && f.predicate === "prefers_language",
    );

    return {
      passed: foundTypeScript,
      details: foundTypeScript
        ? `✓ Found "test_user prefers_language TypeScript" among ${foundFacts.length} facts`
        : `✗ Did not find TypeScript preference (found ${foundFacts.length} facts)`,
    };
  } catch (err) {
    console.error("End-to-end prefetch test failed:", err);
    return { passed: false, details: String(err) };
  }
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllTests(): Promise<void> {
  log("\n");
  log("  🐑 SHEEP AI Integration Test Suite", colors.bold + colors.cyan);
  log(`  Agent ID: ${TEST_AGENT_ID}`, colors.yellow);
  log(`  Database: ${TEST_DB_PATH}`, colors.yellow);

  let passed = 0;
  let failed = 0;

  // Cleanup any previous test data
  logSection("Setup");
  await cleanupTestData();
  log("  Test environment ready", colors.green);

  // Run tests
  logSection("1. Database Layer");

  const dbTest = await testDatabaseCreation();
  logResult("Database creation", dbTest);
  dbTest ? passed++ : failed++;

  const factTest = await testFactInsertion();
  logResult("Fact insertion", factTest.passed, `${factTest.factCount} facts inserted`);
  factTest.passed ? passed++ : failed++;

  const episodeTest = await testEpisodeInsertion();
  logResult(
    "Episode insertion",
    episodeTest.passed,
    `${episodeTest.episodeCount} episodes inserted`,
  );
  episodeTest.passed ? passed++ : failed++;

  const retrievalTest = await testFactRetrieval();
  logResult("Fact retrieval", retrievalTest.passed, retrievalTest.details);
  retrievalTest.passed ? passed++ : failed++;

  logSection("2. Prefetch Engine");

  const prefetchTest = await testPrefetchEngine();
  logResult("Intent classification & prefetch logic", prefetchTest.passed, prefetchTest.details);
  prefetchTest.passed ? passed++ : failed++;

  logSection("3. Extraction Pipeline");

  const procedureTest = await testProcedureExtraction();
  logResult("Procedure extraction", procedureTest.passed, procedureTest.details);
  procedureTest.passed ? passed++ : failed++;

  const causalTest = await testCausalExtraction();
  logResult("Causal link extraction", causalTest.passed, causalTest.details);
  causalTest.passed ? passed++ : failed++;

  logSection("4. Consolidation & Forgetting");

  const consolidationTest = await testConsolidation();
  logResult("Consolidation pipeline", consolidationTest.passed, consolidationTest.details);
  consolidationTest.passed ? passed++ : failed++;

  const retentionTest = await testRetentionScoring();
  logResult("Retention scoring (6-factor)", retentionTest.passed, retentionTest.details);
  retentionTest.passed ? passed++ : failed++;

  logSection("5. Metrics");

  const metricsTest = await testMetrics();
  logResult("Metrics tracking", metricsTest.passed, metricsTest.details);
  metricsTest.passed ? passed++ : failed++;

  logSection("6. End-to-End");

  const e2eTest = await testEndToEndPrefetch();
  logResult("End-to-end fact prefetch", e2eTest.passed, e2eTest.details);
  e2eTest.passed ? passed++ : failed++;

  // Cleanup
  logSection("Cleanup");
  await cleanupTestData();
  log("  Test data removed", colors.green);

  // Summary
  logSection("Results");
  const total = passed + failed;
  const percentage = ((passed / total) * 100).toFixed(0);

  if (failed === 0) {
    log(`  🎉 ALL TESTS PASSED (${passed}/${total})`, colors.green + colors.bold);
    log("\n  SHEEP AI core mechanics are working correctly!", colors.green);
    log("  You can now test with real conversations.\n", colors.green);
  } else {
    log(`  ⚠️  ${passed}/${total} tests passed (${percentage}%)`, colors.yellow + colors.bold);
    log(`  ${failed} test(s) failed - review errors above\n`, colors.red);
  }
}

// Run if executed directly
runAllTests().catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
