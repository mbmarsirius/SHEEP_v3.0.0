/**
 * SHEEP AI - Procedure Matching Engine
 *
 * Matches incoming queries/situations to known procedures.
 * This enables the AI to suggest relevant actions based on past patterns.
 *
 * @module sheep/procedures/matcher
 */

import type { Procedure } from "../memory/schema.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of matching a query to procedures
 */
export type ProcedureMatch = {
  procedure: Procedure;
  /** How well the trigger matches the query (0-1) */
  triggerSimilarity: number;
  /** Combined relevance score (0-1) */
  relevanceScore: number;
  /** Why this procedure matched */
  matchReason: string;
};

/**
 * Options for procedure matching
 */
export type MatchingOptions = {
  /** Minimum relevance score to include (default: 0.3) */
  minRelevance?: number;
  /** Maximum procedures to return (default: 5) */
  maxResults?: number;
  /** Filter by tags */
  tags?: string[];
  /** Minimum success rate to include (default: 0) */
  minSuccessRate?: number;
};

// =============================================================================
// MATCHING FUNCTIONS
// =============================================================================

/**
 * Calculate similarity between two strings (Jaccard + keyword overlap)
 */
function calculateSimilarity(query: string, target: string): number {
  const queryWords = new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const targetWords = new Set(
    target
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  if (queryWords.size === 0 || targetWords.size === 0) {
    return 0;
  }

  // Calculate Jaccard similarity
  const intersection = [...queryWords].filter((w) => targetWords.has(w)).length;
  const union = new Set([...queryWords, ...targetWords]).size;
  const jaccard = intersection / union;

  // Bonus for exact substring match
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();
  const substringBonus =
    targetLower.includes(queryLower) || queryLower.includes(targetLower) ? 0.2 : 0;

  return Math.min(1, jaccard + substringBonus);
}

/**
 * Calculate relevance score for a procedure match
 */
function calculateRelevanceScore(params: {
  triggerSimilarity: number;
  procedure: Procedure;
}): number {
  const { triggerSimilarity, procedure } = params;

  // Base score from trigger similarity (50% weight)
  let score = triggerSimilarity * 0.5;

  // Success rate boost (25% weight)
  score += procedure.successRate * 0.25;

  // Usage frequency boost (15% weight) - normalized by log
  const usageScore = Math.min(1, Math.log10(procedure.timesUsed + 1) / 2);
  score += usageScore * 0.15;

  // Example count boost (10% weight) - more examples = more reliable
  const exampleScore = Math.min(1, procedure.examples.length / 5);
  score += exampleScore * 0.1;

  return Math.min(1, score);
}

/**
 * Match a query to known procedures
 */
export function matchProcedures(
  query: string,
  procedures: Procedure[],
  options: MatchingOptions = {},
): ProcedureMatch[] {
  const minRelevance = options.minRelevance ?? 0.3;
  const maxResults = options.maxResults ?? 5;
  const minSuccessRate = options.minSuccessRate ?? 0;
  const filterTags = options.tags;

  const matches: ProcedureMatch[] = [];

  for (const procedure of procedures) {
    // Filter by success rate
    if (procedure.successRate < minSuccessRate) {
      continue;
    }

    // Filter by tags if specified
    if (filterTags && filterTags.length > 0) {
      const hasMatchingTag = filterTags.some((tag) => procedure.tags.includes(tag));
      if (!hasMatchingTag) {
        continue;
      }
    }

    // Calculate trigger similarity
    const triggerSimilarity = calculateSimilarity(query, procedure.trigger);

    // Also check action similarity (sometimes users describe what to do, not the trigger)
    const actionSimilarity = calculateSimilarity(query, procedure.action);

    // Use the better match
    const bestSimilarity = Math.max(triggerSimilarity, actionSimilarity * 0.8);

    if (bestSimilarity < 0.1) {
      continue; // Skip very poor matches early
    }

    const relevanceScore = calculateRelevanceScore({
      triggerSimilarity: bestSimilarity,
      procedure,
    });

    if (relevanceScore >= minRelevance) {
      const matchReason =
        triggerSimilarity > actionSimilarity
          ? `Trigger matches: "${procedure.trigger}"`
          : `Action matches: "${procedure.action}"`;

      matches.push({
        procedure,
        triggerSimilarity: bestSimilarity,
        relevanceScore,
        matchReason,
      });
    }
  }

  // Sort by relevance (highest first) and limit results
  matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return matches.slice(0, maxResults);
}

/**
 * Find procedures by tag
 */
export function findProceduresByTag(procedures: Procedure[], tag: string): Procedure[] {
  return procedures.filter((p) => p.tags.includes(tag.toLowerCase()));
}

/**
 * Find the most successful procedures
 */
export function findMostSuccessfulProcedures(
  procedures: Procedure[],
  minUsage: number = 3,
  limit: number = 10,
): Procedure[] {
  return procedures
    .filter((p) => p.timesUsed >= minUsage)
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, limit);
}

/**
 * Find procedures that might apply to a situation
 */
export function suggestProceduresForSituation(
  situation: string,
  procedures: Procedure[],
  options: MatchingOptions = {},
): ProcedureMatch[] {
  // Use the standard matching with slightly lower threshold for suggestions
  return matchProcedures(situation, procedures, {
    ...options,
    minRelevance: options.minRelevance ?? 0.2,
  });
}

/**
 * Format procedure matches for display
 */
export function formatProcedureMatches(matches: ProcedureMatch[]): string {
  if (matches.length === 0) {
    return "No matching procedures found.";
  }

  const lines: string[] = ["## Relevant Procedures"];

  for (const match of matches) {
    const successPct = (match.procedure.successRate * 100).toFixed(0);
    const relevancePct = (match.relevanceScore * 100).toFixed(0);

    lines.push(
      `\n### ${match.procedure.trigger}`,
      `**Action**: ${match.procedure.action}`,
      match.procedure.expectedOutcome ? `**Expected**: ${match.procedure.expectedOutcome}` : "",
      `**Success rate**: ${successPct}% (${match.procedure.timesUsed} uses)`,
      `**Relevance**: ${relevancePct}%`,
    );
  }

  return lines.filter(Boolean).join("\n");
}
