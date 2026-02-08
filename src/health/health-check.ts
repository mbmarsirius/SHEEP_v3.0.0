/**
 * SHEEP AI - Memory Health Check
 *
 * Analyzes cognitive memory for quality issues:
 * - Duplicate facts (same subject+predicate with similar objects)
 * - Low-quality facts (too short, truncated, meaningless)
 * - Orphaned memories (facts without evidence)
 * - Stale memories (very old, never accessed)
 *
 * @module sheep/health/health-check
 */

import { SheepDatabase } from "../memory/database.js";
import type { Fact, Episode } from "../memory/schema.js";

// =============================================================================
// TYPES
// =============================================================================

export interface HealthIssue {
  id: string;
  type: "duplicate" | "low_quality" | "orphaned" | "stale" | "truncated" | "meaningless";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  affectedIds: string[];
  suggestedAction: "merge" | "retract" | "review" | "keep";
  autoFixable: boolean;
}

export interface DuplicateGroup {
  subject: string;
  predicate: string;
  facts: Fact[];
  bestFact: Fact;
  duplicateCount: number;
}

export interface HealthReport {
  timestamp: string;
  agentId: string;
  summary: {
    totalFacts: number;
    activeFacts: number;
    totalEpisodes: number;
    totalIssues: number;
    criticalIssues: number;
    autoFixableIssues: number;
    healthScore: number; // 0-100
  };
  issues: HealthIssue[];
  duplicates: DuplicateGroup[];
  lowQualityFacts: Fact[];
  orphanedFacts: Fact[];
  staleFacts: Fact[];
}

// =============================================================================
// QUALITY RULES
// =============================================================================

/**
 * Patterns that indicate meaningless/garbage facts
 */
const MEANINGLESS_PATTERNS = [
  /^it$/i,
  /^this$/i,
  /^that$/i,
  /^what$/i,
  /^the$/i,
  /^a$/i,
  /^an$/i,
  /^\d+$/,
  /^yes$/i,
  /^no$/i,
  /^ok$/i,
  /^okay$/i,
  /^done$/i,
  /^here$/i,
  /^there$/i,
];

/**
 * Predicates that should have substantial objects
 */
const PREDICATES_NEEDING_SUBSTANCE: Record<string, number> = {
  prefers: 5,
  uses: 3,
  wants: 5,
  needs: 5,
  likes: 3,
  dislikes: 3,
  is_interested_in: 5,
  works_on: 5,
  working_on: 5,
  location: 3,
  email: 5,
  is: 3,
};

/**
 * Minimum confidence for keeping facts
 */
const MIN_USEFUL_CONFIDENCE = 0.3;

/**
 * Days after which unaccessed facts are considered stale
 */
const STALE_DAYS = 30;

// =============================================================================
// HEALTH CHECK FUNCTIONS
// =============================================================================

/**
 * Run a complete health check on SHEEP memory
 */
export function runHealthCheck(agentId: string): HealthReport {
  const db = new SheepDatabase(agentId);
  const timestamp = new Date().toISOString();

  try {
    // Get all facts
    const allFacts = db.findFacts({ activeOnly: false });
    const activeFacts = allFacts.filter((f) => f.isActive);
    const episodes = db.queryEpisodes({});

    // Run all checks
    const duplicates = findDuplicates(activeFacts);
    const lowQuality = findLowQualityFacts(activeFacts);
    const orphaned = findOrphanedFacts(activeFacts);
    const stale = findStaleFacts(activeFacts);

    // Build issues list
    const issues: HealthIssue[] = [];

    // Add duplicate issues
    for (const group of duplicates) {
      if (group.duplicateCount > 1) {
        issues.push({
          id: `dup-${group.subject}-${group.predicate}`,
          type: "duplicate",
          severity:
            group.duplicateCount > 10 ? "high" : group.duplicateCount > 5 ? "medium" : "low",
          description: `${group.duplicateCount} duplicate facts for "${group.subject} ${group.predicate}"`,
          affectedIds: group.facts.map((f) => f.id),
          suggestedAction: "merge",
          autoFixable: true,
        });
      }
    }

    // Add low quality issues
    for (const fact of lowQuality) {
      const issue = classifyLowQualityIssue(fact);
      issues.push(issue);
    }

    // Add orphaned issues
    for (const fact of orphaned) {
      issues.push({
        id: `orphan-${fact.id}`,
        type: "orphaned",
        severity: "low",
        description: `Fact "${fact.subject} ${fact.predicate} ${fact.object}" has no evidence`,
        affectedIds: [fact.id],
        suggestedAction: "review",
        autoFixable: false,
      });
    }

    // Add stale issues
    for (const fact of stale) {
      issues.push({
        id: `stale-${fact.id}`,
        type: "stale",
        severity: "low",
        description: `Fact "${fact.subject} ${fact.predicate}" not accessed in ${STALE_DAYS}+ days`,
        affectedIds: [fact.id],
        suggestedAction: "review",
        autoFixable: false,
      });
    }

    // Calculate health score
    const healthScore = calculateHealthScore(activeFacts.length, issues);

    return {
      timestamp,
      agentId,
      summary: {
        totalFacts: allFacts.length,
        activeFacts: activeFacts.length,
        totalEpisodes: episodes.length,
        totalIssues: issues.length,
        criticalIssues: issues.filter((i) => i.severity === "critical").length,
        autoFixableIssues: issues.filter((i) => i.autoFixable).length,
        healthScore,
      },
      issues,
      duplicates: duplicates.filter((d) => d.duplicateCount > 1),
      lowQualityFacts: lowQuality,
      orphanedFacts: orphaned,
      staleFacts: stale,
    };
  } finally {
    db.close();
  }
}

/**
 * Find duplicate facts (same subject+predicate)
 */
export function findDuplicates(facts: Fact[]): DuplicateGroup[] {
  const groups = new Map<string, Fact[]>();

  // Group by subject+predicate
  for (const fact of facts) {
    const key = `${fact.subject.toLowerCase()}|${fact.predicate.toLowerCase()}`;
    const existing = groups.get(key) || [];
    existing.push(fact);
    groups.set(key, existing);
  }

  // Build duplicate groups
  const result: DuplicateGroup[] = [];
  for (const [key, groupFacts] of groups) {
    const [subject, predicate] = key.split("|");

    // Sort by quality: user affirmed > confidence > evidence count > length
    const sorted = [...groupFacts].sort((a, b) => {
      // User affirmed wins
      if (a.userAffirmed && !b.userAffirmed) return -1;
      if (!a.userAffirmed && b.userAffirmed) return 1;

      // Then confidence
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;

      // Then evidence count
      const aEvidence = a.evidence.length;
      const bEvidence = b.evidence.length;
      if (aEvidence !== bEvidence) return bEvidence - aEvidence;

      // Then object length (prefer more detailed)
      return b.object.length - a.object.length;
    });

    result.push({
      subject,
      predicate,
      facts: sorted,
      bestFact: sorted[0],
      duplicateCount: sorted.length,
    });
  }

  // Sort by duplicate count descending
  return result.sort((a, b) => b.duplicateCount - a.duplicateCount);
}

/**
 * Find low-quality facts
 */
export function findLowQualityFacts(facts: Fact[]): Fact[] {
  return facts.filter((fact) => {
    // Skip user-affirmed facts
    if (fact.userAffirmed) return false;

    // Check for meaningless object
    if (isMeaningless(fact.object)) return true;

    // Check for truncated content (ends mid-word or with incomplete sentence)
    if (isTruncated(fact.object)) return true;

    // Check for too-short objects for specific predicates
    const minLength = PREDICATES_NEEDING_SUBSTANCE[fact.predicate.toLowerCase()];
    if (minLength && fact.object.length < minLength) return true;

    // Check for very low confidence
    if (fact.confidence < MIN_USEFUL_CONFIDENCE) return true;

    return false;
  });
}

/**
 * Find orphaned facts (no evidence)
 */
export function findOrphanedFacts(facts: Fact[]): Fact[] {
  return facts.filter((fact) => {
    if (fact.userAffirmed) return false;
    return fact.evidence.length === 0;
  });
}

/**
 * Find stale facts (not accessed recently)
 */
export function findStaleFacts(facts: Fact[]): Fact[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);
  const cutoffStr = cutoff.toISOString();

  return facts.filter((fact) => {
    // Skip user-affirmed facts
    if (fact.userAffirmed) return false;

    // Never accessed and old
    if (fact.accessCount === 0 && fact.lastConfirmed < cutoffStr) {
      return true;
    }

    return false;
  });
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function isMeaningless(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return MEANINGLESS_PATTERNS.some((p) => p.test(trimmed));
}

function isTruncated(text: string): boolean {
  const trimmed = text.trim();

  // Empty or very short
  if (trimmed.length < 3) return true;

  // Ends with incomplete word indicators
  if (/\s\w{1,2}$/.test(trimmed)) return true; // Ends with 1-2 char word after space
  if (
    /[a-z]$/.test(trimmed) &&
    !trimmed.endsWith(".") &&
    !trimmed.endsWith("!") &&
    !trimmed.endsWith("?")
  ) {
    // Ends mid-sentence without punctuation - check if it's a natural end
    const words = trimmed.split(/\s+/);
    const lastWord = words[words.length - 1];
    if (lastWord.length < 3 && words.length > 3) return true;
  }

  return false;
}

function classifyLowQualityIssue(fact: Fact): HealthIssue {
  const obj = fact.object.trim();

  if (isMeaningless(obj)) {
    return {
      id: `meaningless-${fact.id}`,
      type: "meaningless",
      severity: "high",
      description: `Meaningless fact: "${fact.subject} ${fact.predicate} ${obj}"`,
      affectedIds: [fact.id],
      suggestedAction: "retract",
      autoFixable: true,
    };
  }

  if (isTruncated(obj)) {
    return {
      id: `truncated-${fact.id}`,
      type: "truncated",
      severity: "medium",
      description: `Truncated fact: "${fact.subject} ${fact.predicate} ${obj.substring(0, 30)}..."`,
      affectedIds: [fact.id],
      suggestedAction: "retract",
      autoFixable: true,
    };
  }

  if (fact.confidence < MIN_USEFUL_CONFIDENCE) {
    return {
      id: `lowconf-${fact.id}`,
      type: "low_quality",
      severity: "low",
      description: `Low confidence (${(fact.confidence * 100).toFixed(0)}%): "${fact.subject} ${fact.predicate}"`,
      affectedIds: [fact.id],
      suggestedAction: "review",
      autoFixable: false,
    };
  }

  return {
    id: `quality-${fact.id}`,
    type: "low_quality",
    severity: "low",
    description: `Low quality: "${fact.subject} ${fact.predicate} ${obj}"`,
    affectedIds: [fact.id],
    suggestedAction: "review",
    autoFixable: false,
  };
}

function calculateHealthScore(totalActive: number, issues: HealthIssue[]): number {
  if (totalActive === 0) return 100;

  // Weight issues by severity
  const weights = {
    critical: 10,
    high: 5,
    medium: 2,
    low: 1,
  };

  let penalty = 0;
  for (const issue of issues) {
    penalty += weights[issue.severity];
  }

  // Max penalty is proportional to fact count
  const maxPenalty = totalActive * 2;
  const score = Math.max(0, 100 - (penalty / maxPenalty) * 100);

  return Math.round(score);
}

/**
 * Format health report for display
 */
export function formatHealthReport(report: HealthReport): string {
  const lines: string[] = [];

  // Header
  lines.push(`🐑 SHEEP Memory Health Report`);
  lines.push(`   Agent: ${report.agentId}`);
  lines.push(`   Time: ${new Date(report.timestamp).toLocaleString()}`);
  lines.push("");

  // Health Score
  const scoreEmoji =
    report.summary.healthScore >= 80 ? "🟢" : report.summary.healthScore >= 50 ? "🟡" : "🔴";
  lines.push(`${scoreEmoji} Health Score: ${report.summary.healthScore}/100`);
  lines.push("");

  // Stats
  lines.push(`📊 Memory Stats:`);
  lines.push(`   • Active Facts: ${report.summary.activeFacts}`);
  lines.push(`   • Total Facts: ${report.summary.totalFacts}`);
  lines.push(`   • Episodes: ${report.summary.totalEpisodes}`);
  lines.push("");

  // Issues Summary
  lines.push(`⚠️  Issues Found: ${report.summary.totalIssues}`);
  if (report.summary.totalIssues > 0) {
    const bySeverity = {
      critical: report.issues.filter((i) => i.severity === "critical").length,
      high: report.issues.filter((i) => i.severity === "high").length,
      medium: report.issues.filter((i) => i.severity === "medium").length,
      low: report.issues.filter((i) => i.severity === "low").length,
    };
    if (bySeverity.critical) lines.push(`   🔴 Critical: ${bySeverity.critical}`);
    if (bySeverity.high) lines.push(`   🟠 High: ${bySeverity.high}`);
    if (bySeverity.medium) lines.push(`   🟡 Medium: ${bySeverity.medium}`);
    if (bySeverity.low) lines.push(`   🟢 Low: ${bySeverity.low}`);
    lines.push(`   ✨ Auto-fixable: ${report.summary.autoFixableIssues}`);
  }
  lines.push("");

  // Top Duplicates
  if (report.duplicates.length > 0) {
    lines.push(`🔁 Top Duplicate Groups:`);
    for (const group of report.duplicates.slice(0, 5)) {
      lines.push(`   • "${group.subject} ${group.predicate}" — ${group.duplicateCount} copies`);
    }
    if (report.duplicates.length > 5) {
      lines.push(`   ... and ${report.duplicates.length - 5} more`);
    }
    lines.push("");
  }

  // Low Quality Facts
  if (report.lowQualityFacts.length > 0) {
    lines.push(`🗑️  Low Quality Facts: ${report.lowQualityFacts.length}`);
    for (const fact of report.lowQualityFacts.slice(0, 5)) {
      const truncatedObj =
        fact.object.length > 20 ? fact.object.substring(0, 20) + "..." : fact.object;
      lines.push(`   • ${fact.subject} ${fact.predicate} "${truncatedObj}"`);
    }
    if (report.lowQualityFacts.length > 5) {
      lines.push(`   ... and ${report.lowQualityFacts.length - 5} more`);
    }
    lines.push("");
  }

  // Suggestions
  if (report.summary.autoFixableIssues > 0) {
    lines.push(
      `💡 Run 'moltbot sheep cleanup --auto' to fix ${report.summary.autoFixableIssues} issues automatically.`,
    );
  }

  return lines.join("\n");
}
