#!/usr/bin/env node
/**
 * SHEEP AI - Fact Deduplication Script
 *
 * Merges duplicate facts (same subject, predicate, object) into one.
 * Keeps the highest-confidence fact, retracts duplicates.
 *
 * Usage: AGENT_ID=default pnpm run dedup
 *        AGENT_ID=default pnpm run dedup -- --dry-run
 */

import { SheepDatabase } from "../memory/database.js";

const agentId = process.env.AGENT_ID ?? "default";
const dryRun = process.argv.includes("--dry-run");

function normalizeSpo(s: string, p: string, o: string): string {
  return `${(s || "").toLowerCase().trim()}|${(p || "").toLowerCase().trim()}|${(o || "").toLowerCase().trim()}`;
}

async function main() {
  console.log("\n========================================");
  console.log("  SHEEP AI - Fact Deduplication");
  console.log("========================================\n");
  console.log(`Agent ID: ${agentId}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}\n`);

  const db = new SheepDatabase(agentId);
  const allFacts = db.findFacts({ activeOnly: true });
  console.log(`Total active facts: ${allFacts.length}`);

  const groups = new Map<string, typeof allFacts>();
  for (const f of allFacts) {
    const key = normalizeSpo(f.subject, f.predicate, f.object);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  let retracted = 0;
  let totalDuplicates = 0;
  const duplicateGroups: Array<{ key: string; count: number; example: string }> = [];

  for (const [key, facts] of groups) {
    if (facts.length <= 1) continue;
    totalDuplicates += facts.length - 1;
    const sorted = [...facts].sort((a, b) => b.confidence - a.confidence);
    const keep = sorted[0];
    const toRetract = sorted.slice(1);
    duplicateGroups.push({
      key,
      count: facts.length,
      example: `${keep.subject} ${keep.predicate} ${keep.object}`,
    });
    if (!dryRun) {
      for (const f of toRetract) {
        db.retractFact(f.id, `Dedup: merged into ${keep.id}`);
        retracted++;
      }
    }
  }

  console.log(`\nDuplicate groups: ${duplicateGroups.length}`);
  console.log(`Facts to retract (merge): ${totalDuplicates}`);

  if (duplicateGroups.length > 0) {
    console.log("\nTop 10 duplicate groups:");
    duplicateGroups
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .forEach((g, i) => {
        console.log(`  ${i + 1}. ${g.example} (${g.count}x)`);
      });
  }

  if (!dryRun && retracted > 0) {
    console.log(`\nRetracted ${retracted} duplicate facts.`);
  } else if (dryRun && totalDuplicates > 0) {
    console.log(`\n[DRY RUN] Would retract ${totalDuplicates} facts. Run without --dry-run to apply.`);
  }

  db.close();
  console.log("\n========================================");
  console.log("  Dedup complete.");
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("Dedup failed:", err);
  process.exit(1);
});
