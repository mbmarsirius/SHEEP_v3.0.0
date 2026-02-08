/**
 * SHEEP AI - Memory Cleanup
 *
 * Automatic and manual cleanup operations:
 * - Deduplicate facts (keep best, retract rest)
 * - Remove low-quality/meaningless facts
 * - Merge similar facts
 *
 * @module sheep/health/cleanup
 */

import { SheepDatabase } from "../memory/database.js";
import type { Fact } from "../memory/schema.js";
import { now } from "../memory/schema.js";
import {
  runHealthCheck,
  findDuplicates,
  findLowQualityFacts,
  type HealthReport,
  type DuplicateGroup,
  type HealthIssue,
} from "./health-check.js";

// =============================================================================
// TYPES
// =============================================================================

export interface CleanupResult {
  timestamp: string;
  agentId: string;
  dryRun: boolean;
  summary: {
    duplicatesResolved: number;
    factsRetracted: number;
    factsMerged: number;
    issuesFixed: number;
  };
  actions: CleanupAction[];
  errors: string[];
}

export interface CleanupAction {
  type: "retract" | "merge" | "update";
  factId: string;
  reason: string;
  details?: string;
}

export interface CleanupOptions {
  dryRun?: boolean;
  autoFix?: boolean;
  deduplicateOnly?: boolean;
  cleanupOnly?: boolean;
  verbose?: boolean;
}

// =============================================================================
// CLEANUP FUNCTIONS
// =============================================================================

/**
 * Run cleanup based on health report
 */
export function runCleanup(agentId: string, options: CleanupOptions = {}): CleanupResult {
  const db = new SheepDatabase(agentId);
  const timestamp = now();
  const actions: CleanupAction[] = [];
  const errors: string[] = [];

  let duplicatesResolved = 0;
  let factsRetracted = 0;
  let factsMerged = 0;
  let issuesFixed = 0;

  try {
    // Get all active facts
    const activeFacts = db.findFacts({ activeOnly: true });

    // Deduplicate if requested or running full cleanup
    if (!options.cleanupOnly) {
      const duplicates = findDuplicates(activeFacts);
      for (const group of duplicates) {
        if (group.duplicateCount <= 1) continue;

        try {
          const result = deduplicateGroup(db, group, options.dryRun);
          actions.push(...result.actions);
          duplicatesResolved += result.duplicatesResolved;
          factsRetracted += result.factsRetracted;
          factsMerged += result.factsMerged;
        } catch (err) {
          errors.push(`Failed to deduplicate ${group.subject} ${group.predicate}: ${err}`);
        }
      }
    }

    // Cleanup low quality if requested or running full cleanup
    if (!options.deduplicateOnly && options.autoFix) {
      const lowQuality = findLowQualityFacts(activeFacts);
      for (const fact of lowQuality) {
        try {
          // Only auto-retract meaningless and truncated facts
          if (isSafeToAutoRetract(fact)) {
            if (!options.dryRun) {
              db.retractFact(fact.id, "auto-cleanup: low quality fact");
            }
            actions.push({
              type: "retract",
              factId: fact.id,
              reason: "Low quality / meaningless",
              details: `"${fact.subject} ${fact.predicate} ${fact.object}"`,
            });
            factsRetracted++;
            issuesFixed++;
          }
        } catch (err) {
          errors.push(`Failed to cleanup fact ${fact.id}: ${err}`);
        }
      }
    }

    return {
      timestamp,
      agentId,
      dryRun: options.dryRun ?? false,
      summary: {
        duplicatesResolved,
        factsRetracted,
        factsMerged,
        issuesFixed,
      },
      actions,
      errors,
    };
  } finally {
    db.close();
  }
}

/**
 * Deduplicate a group of facts with same subject+predicate
 */
function deduplicateGroup(
  db: SheepDatabase,
  group: DuplicateGroup,
  dryRun?: boolean,
): {
  actions: CleanupAction[];
  duplicatesResolved: number;
  factsRetracted: number;
  factsMerged: number;
} {
  const actions: CleanupAction[] = [];
  let factsRetracted = 0;
  let factsMerged = 0;

  // Facts are already sorted by quality (best first)
  const best = group.bestFact;
  const duplicates = group.facts.slice(1);

  // Collect unique objects from duplicates
  const uniqueObjects = new Set<string>();
  uniqueObjects.add(best.object.toLowerCase().trim());

  for (const dup of duplicates) {
    const dupObj = dup.object.toLowerCase().trim();

    // Check if this is truly a duplicate or just same predicate with different value
    if (isDuplicateValue(best.object, dup.object)) {
      // True duplicate - retract the worse one
      if (!dryRun) {
        db.retractFact(dup.id, `duplicate of ${best.id}`);
      }
      actions.push({
        type: "retract",
        factId: dup.id,
        reason: `Duplicate of ${best.id}`,
        details: `"${dup.object}" → keeping "${best.object}"`,
      });
      factsRetracted++;
    } else if (!uniqueObjects.has(dupObj)) {
      // Different value - might want to merge evidence
      uniqueObjects.add(dupObj);

      // If the duplicate has evidence the best doesn't have, we could merge
      // For now, just retract lower-confidence versions
      if (dup.confidence < 0.5 && !dup.userAffirmed) {
        if (!dryRun) {
          db.retractFact(dup.id, `lower quality than ${best.id}`);
        }
        actions.push({
          type: "retract",
          factId: dup.id,
          reason: `Lower quality version of "${best.object}"`,
          details: `Confidence ${(dup.confidence * 100).toFixed(0)}% vs ${(best.confidence * 100).toFixed(0)}%`,
        });
        factsRetracted++;
      }
    }
  }

  return {
    actions,
    duplicatesResolved: duplicates.length > 0 ? 1 : 0,
    factsRetracted,
    factsMerged,
  };
}

/**
 * Check if two object values are effectively duplicates
 */
function isDuplicateValue(a: string, b: string): boolean {
  const normA = normalizeValue(a);
  const normB = normalizeValue(b);

  // Exact match after normalization
  if (normA === normB) return true;

  // One is substring of the other (truncation)
  if (normA.startsWith(normB) || normB.startsWith(normA)) {
    // Only if significant overlap
    const shorter = Math.min(normA.length, normB.length);
    const longer = Math.max(normA.length, normB.length);
    if (shorter / longer > 0.8) return true;
  }

  // Levenshtein distance for similar strings
  if (normA.length > 10 && normB.length > 10) {
    const distance = levenshteinDistance(normA, normB);
    const maxLen = Math.max(normA.length, normB.length);
    const similarity = 1 - distance / maxLen;
    if (similarity > 0.85) return true;
  }

  return false;
}

/**
 * Normalize a value for comparison
 */
function normalizeValue(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if a fact is safe to auto-retract
 */
function isSafeToAutoRetract(fact: Fact): boolean {
  // Never auto-retract user-affirmed facts
  if (fact.userAffirmed) return false;

  // Safe to retract meaningless single-word objects
  const obj = fact.object.trim().toLowerCase();
  const meaninglessWords = [
    "it",
    "this",
    "that",
    "what",
    "the",
    "a",
    "an",
    "yes",
    "no",
    "ok",
    "okay",
    "done",
    "here",
    "there",
  ];
  if (meaninglessWords.includes(obj)) return true;

  // Safe to retract very short objects (< 3 chars)
  if (obj.length < 3) return true;

  // Safe to retract very low confidence
  if (fact.confidence < 0.2) return true;

  return false;
}

/**
 * Format cleanup result for display
 */
export function formatCleanupResult(result: CleanupResult): string {
  const lines: string[] = [];

  const dryRunLabel = result.dryRun ? " (DRY RUN)" : "";

  lines.push(`🐑 SHEEP Memory Cleanup${dryRunLabel}`);
  lines.push(`   Agent: ${result.agentId}`);
  lines.push(`   Time: ${new Date(result.timestamp).toLocaleString()}`);
  lines.push("");

  // Summary
  lines.push(`📊 Summary:`);
  lines.push(`   • Duplicate groups resolved: ${result.summary.duplicatesResolved}`);
  lines.push(`   • Facts retracted: ${result.summary.factsRetracted}`);
  lines.push(`   • Facts merged: ${result.summary.factsMerged}`);
  lines.push(`   • Total issues fixed: ${result.summary.issuesFixed}`);
  lines.push("");

  // Actions taken
  if (result.actions.length > 0) {
    lines.push(`📝 Actions${result.dryRun ? " (would take)" : " taken"}:`);
    for (const action of result.actions.slice(0, 20)) {
      const emoji = action.type === "retract" ? "🗑️" : action.type === "merge" ? "🔗" : "✏️";
      lines.push(`   ${emoji} ${action.reason}`);
      if (action.details) {
        lines.push(`      ${action.details}`);
      }
    }
    if (result.actions.length > 20) {
      lines.push(`   ... and ${result.actions.length - 20} more`);
    }
    lines.push("");
  }

  // Errors
  if (result.errors.length > 0) {
    lines.push(`❌ Errors:`);
    for (const error of result.errors.slice(0, 5)) {
      lines.push(`   • ${error}`);
    }
    if (result.errors.length > 5) {
      lines.push(`   ... and ${result.errors.length - 5} more`);
    }
  }

  if (result.dryRun && result.actions.length > 0) {
    lines.push(`💡 Run without --dry-run to apply these changes.`);
  }

  return lines.join("\n");
}

/**
 * Quick deduplicate - just fix duplicates without full health check
 */
export function quickDeduplicate(agentId: string, dryRun = false): CleanupResult {
  return runCleanup(agentId, {
    dryRun,
    deduplicateOnly: true,
  });
}

/**
 * Quick cleanup - fix obvious issues automatically
 */
export function quickCleanup(agentId: string, dryRun = false): CleanupResult {
  return runCleanup(agentId, {
    dryRun,
    autoFix: true,
  });
}
