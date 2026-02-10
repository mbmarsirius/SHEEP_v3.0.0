#!/usr/bin/env node
/**
 * SHEEP AI - Self-Validation Script (Step 1)
 *
 * Runs consolidation and outputs stats for manual verification.
 * Use: AGENT_ID=your-agent pnpm exec tsx src/scripts/self-validate.ts
 * Or:  node dist/scripts/self-validate.js (after build)
 */

import { runConsolidation } from "../consolidation/consolidator.js";
import { SheepDatabase } from "../memory/database.js";

const agentId = process.env.AGENT_ID ?? "default";

async function main() {
  console.log("\n========================================");
  console.log("  SHEEP AI - Self-Validation");
  console.log("========================================\n");
  console.log(`Agent ID: ${agentId}\n`);

  // Run consolidation
  console.log("Running consolidation...");
  const start = Date.now();
  const result = await runConsolidation({
    agentId,
    useLLMExtraction: true,
    enableLLMSleep: true,
    onProgress: (stage, current, total) => {
      process.stdout.write(`  ${stage}: ${current}/${total}\r`);
    },
  });
  const duration = Date.now() - start;

  console.log("\n\n--- Consolidation Result ---");
  console.log(`Success: ${result.success}`);
  console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`Sessions processed: ${result.sessionsProcessed}`);
  console.log(`Episodes extracted: ${result.episodesExtracted}`);
  console.log(`Facts extracted: ${result.factsExtracted}`);
  console.log(`Causal links extracted: ${result.causalLinksExtracted}`);
  console.log(`Procedures extracted: ${result.proceduresExtracted}`);
  console.log(`Contradictions resolved: ${result.contradictionsResolved}`);
  console.log(`Memories pruned: ${result.memoriesPruned}`);
  if (result.error) console.log(`Error: ${result.error}`);

  // Get full stats and sample facts
  const db = new SheepDatabase(agentId);
  const stats = db.getMemoryStats();
  const sampleFacts = db.findFacts({ activeOnly: true, limit: 10 });
  db.close();

  console.log("\n--- Memory Statistics ---");
  console.log(`Total episodes: ${stats.totalEpisodes}`);
  console.log(`Total facts: ${stats.totalFacts}`);
  console.log(`Total causal links: ${stats.totalCausalLinks}`);
  console.log(`Total procedures: ${stats.totalProcedures}`);
  console.log(`Average fact confidence: ${(stats.averageFactConfidence * 100).toFixed(1)}%`);
  console.log(`Last consolidation: ${stats.lastConsolidation ?? "never"}`);

  // Sample facts for manual verification

  if (sampleFacts.length > 0) {
    console.log("\n--- Sample Facts (verify these match your conversations) ---");
    for (const f of sampleFacts.slice(0, 5)) {
      console.log(`  • ${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object} (${(f.confidence * 100).toFixed(0)}%)`);
    }
  }

  console.log("\n========================================");
  console.log("  Self-validation complete. Check above.");
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
