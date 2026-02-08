/**
 * SHEEP AI - Active Forgetting Engine
 *
 * Implements the retention scoring formula from the master plan:
 * - Access frequency (20% weight)
 * - Emotional salience (15% weight)
 * - Causal importance (25% weight)
 * - Recency (15% weight)
 * - Uniqueness (15% weight)
 * - User explicit marking (10% weight)
 *
 * Key principle: Demote instead of delete (raw → episode → fact)
 *
 * @module sheep/consolidation/forgetting
 */

import type { SheepDatabase } from "../memory/database.js";
import type { Episode, Fact } from "../memory/schema.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Retention score breakdown for debugging
 */
export type RetentionScoreBreakdown = {
  /** Overall retention score (0-1) */
  total: number;
  /** Access frequency component */
  accessFrequency: number;
  /** Emotional salience component */
  emotionalSalience: number;
  /** Causal importance component */
  causalImportance: number;
  /** Recency component */
  recency: number;
  /** Uniqueness component */
  uniqueness: number;
  /** User marking component */
  userMarking: number;
};

/**
 * Options for retention calculation
 */
export type RetentionOptions = {
  /** Include detailed breakdown in result */
  includeBreakdown?: boolean;
  /** Custom weights (must sum to 1.0) */
  weights?: RetentionWeights;
  /** Minimum retention score threshold (default: 0.3) */
  minRetentionThreshold?: number;
  /** Demote threshold (below this, demote instead of delete, default: 0.2) */
  demoteThreshold?: number;
};

/**
 * Custom weights for retention scoring
 */
export type RetentionWeights = {
  accessFrequency: number;
  emotionalSalience: number;
  causalImportance: number;
  recency: number;
  uniqueness: number;
  userMarking: number;
};

// =============================================================================
// DEFAULT WEIGHTS (FROM MASTER PLAN)
// =============================================================================

const DEFAULT_WEIGHTS: RetentionWeights = {
  accessFrequency: 0.2, // 20%
  emotionalSalience: 0.15, // 15%
  causalImportance: 0.25, // 25%
  recency: 0.15, // 15%
  uniqueness: 0.15, // 15%
  userMarking: 0.1, // 10%
};

// =============================================================================
// RETENTION SCORING FOR EPISODES
// =============================================================================

/**
 * Calculate comprehensive retention score for an episode
 */
export function calculateEpisodeRetentionScore(
  episode: Episode,
  db: SheepDatabase,
  options: RetentionOptions = {},
): number | { score: number; breakdown: RetentionScoreBreakdown } {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const now = Date.now();
  const created = new Date(episode.createdAt).getTime();
  const ageMs = now - created;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // 1. Access Frequency (20%)
  // Normalized by age to avoid penalizing new memories
  const accessScore = Math.min(episode.accessCount / Math.max(ageDays, 1), 1);

  // 2. Emotional Salience (15%)
  // Direct from episode metadata
  const salienceScore = episode.emotionalSalience;

  // 3. Causal Importance (25%)
  // Check if this episode is referenced in any causal links
  const causalLinks = db.findCausalLinks({});
  const isInCausalChain = causalLinks.some(
    (link) =>
      (link.causeType === "episode" && link.causeId === episode.id) ||
      (link.effectType === "episode" && link.effectId === episode.id),
  );
  // Also check if any facts from this episode are in causal chains
  const episodeFacts = db.findFacts({}).filter((f) => f.evidence.includes(episode.id));
  const factsInCausalChains = episodeFacts.filter((fact) =>
    causalLinks.some(
      (link) =>
        (link.causeType === "fact" && link.causeId === fact.id) ||
        (link.effectType === "fact" && link.effectId === fact.id),
    ),
  );
  const causalScore = isInCausalChain ? 1.0 : factsInCausalChains.length > 0 ? 0.7 : 0.2;

  // 4. Recency (15%)
  // Exponential decay with ~30 day half-life
  const recencyScore = Math.exp(-ageDays / 30);

  // 5. Uniqueness (15%)
  // Check how unique this episode's topic is compared to others
  const allEpisodes = db.queryEpisodes({ limit: 100 });
  const similarTopicCount = allEpisodes.filter(
    (e) => e.id !== episode.id && e.topic.toLowerCase() === episode.topic.toLowerCase(),
  ).length;
  // Fewer similar episodes = more unique = higher score
  const uniquenessScore = Math.exp(-similarTopicCount / 5);

  // 6. User Explicit Marking (10%)
  // TTL-based marking from user
  let userMarkingScore = 0;
  switch (episode.ttl) {
    case "permanent":
      userMarkingScore = 1.0;
      break;
    case "90d":
      userMarkingScore = 0.7;
      break;
    case "30d":
      userMarkingScore = 0.3;
      break;
    case "7d":
      userMarkingScore = 0.1;
      break;
  }

  // Calculate weighted total
  const totalScore =
    weights.accessFrequency * accessScore +
    weights.emotionalSalience * salienceScore +
    weights.causalImportance * causalScore +
    weights.recency * recencyScore +
    weights.uniqueness * uniquenessScore +
    weights.userMarking * userMarkingScore;

  if (options.includeBreakdown) {
    return {
      score: totalScore,
      breakdown: {
        total: totalScore,
        accessFrequency: weights.accessFrequency * accessScore,
        emotionalSalience: weights.emotionalSalience * salienceScore,
        causalImportance: weights.causalImportance * causalScore,
        recency: weights.recency * recencyScore,
        uniqueness: weights.uniqueness * uniquenessScore,
        userMarking: weights.userMarking * userMarkingScore,
      },
    };
  }

  return totalScore;
}

// =============================================================================
// RETENTION SCORING FOR FACTS
// =============================================================================

/**
 * Calculate comprehensive retention score for a fact
 */
export function calculateFactRetentionScore(
  fact: Fact,
  db: SheepDatabase,
  options: RetentionOptions = {},
): number | { score: number; breakdown: RetentionScoreBreakdown } {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const now = Date.now();
  const created = new Date(fact.createdAt).getTime();
  const ageMs = now - created;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // 1. Access Frequency (20%)
  const accessScore = Math.min(fact.accessCount / Math.max(ageDays, 1), 1);

  // 2. Emotional Salience (15%)
  // Facts don't have direct salience, use confidence as proxy
  const salienceScore = fact.confidence;

  // 3. Causal Importance (25%)
  const causalLinks = db.findCausalLinks({});
  const isInCausalChain = causalLinks.some(
    (link) =>
      (link.causeType === "fact" && link.causeId === fact.id) ||
      (link.effectType === "fact" && link.effectId === fact.id),
  );
  const causalScore = isInCausalChain ? 1.0 : 0.2;

  // 4. Recency (15%)
  const recencyScore = Math.exp(-ageDays / 30);

  // 5. Uniqueness (15%)
  // Check for similar facts (same predicate)
  const similarFacts = db.findFacts({ predicate: fact.predicate, activeOnly: true });
  const similarCount = similarFacts.filter((f) => f.id !== fact.id).length;
  const uniquenessScore = Math.exp(-similarCount / 3);

  // 6. User Explicit Marking (10%)
  const userMarkingScore = fact.userAffirmed ? 1.0 : 0.3;

  // Calculate weighted total
  const totalScore =
    weights.accessFrequency * accessScore +
    weights.emotionalSalience * salienceScore +
    weights.causalImportance * causalScore +
    weights.recency * recencyScore +
    weights.uniqueness * uniquenessScore +
    weights.userMarking * userMarkingScore;

  if (options.includeBreakdown) {
    return {
      score: totalScore,
      breakdown: {
        total: totalScore,
        accessFrequency: weights.accessFrequency * accessScore,
        emotionalSalience: weights.emotionalSalience * salienceScore,
        causalImportance: weights.causalImportance * causalScore,
        recency: weights.recency * recencyScore,
        uniqueness: weights.uniqueness * uniquenessScore,
        userMarking: weights.userMarking * userMarkingScore,
      },
    };
  }

  return totalScore;
}

// =============================================================================
// ACTIVE FORGETTING
// =============================================================================

/**
 * Result of active forgetting operation
 */
export type ForgettingResult = {
  episodesPruned: number;
  factsPruned: number;
  episodesDemoted: number;
  factsDemoted: number;
};

/**
 * Run active forgetting on the database
 * Key principle: Demote instead of delete when possible
 */
export async function runActiveForgetting(
  db: SheepDatabase,
  options: {
    minRetentionScore?: number;
    maxMemories?: number;
    dryRun?: boolean;
  } = {},
): Promise<ForgettingResult> {
  const minRetentionScore = options.minRetentionScore ?? 0.2;
  const maxMemories = options.maxMemories ?? 10000;

  const result: ForgettingResult = {
    episodesPruned: 0,
    factsPruned: 0,
    episodesDemoted: 0,
    factsDemoted: 0,
  };

  // Get all episodes and calculate scores
  const episodes = db.queryEpisodes({ limit: maxMemories });
  const episodeScores: Array<{ episode: Episode; score: number }> = [];

  for (const episode of episodes) {
    // Skip permanent episodes
    if (episode.ttl === "permanent") continue;

    // Check TTL expiration first
    if (isExpired(episode)) {
      if (!options.dryRun) {
        db.deleteEpisode(episode.id);
      }
      result.episodesPruned++;
      continue;
    }

    const score = calculateEpisodeRetentionScore(episode, db) as number;
    episodeScores.push({ episode, score });
  }

  // Prune low-retention episodes
  for (const { episode, score } of episodeScores) {
    if (score < minRetentionScore) {
      if (!options.dryRun) {
        // Before deleting, check if we should demote (keep as summary only)
        // For now, just delete but log the demotion opportunity
        log.debug("Episode retention below threshold", {
          episodeId: episode.id,
          score,
          threshold: minRetentionScore,
          action: "delete", // In future: could demote to summary
        });
        db.deleteEpisode(episode.id);
      }
      result.episodesPruned++;
    }
  }

  // Get all facts and calculate scores
  const facts = db.findFacts({ activeOnly: true });
  const factScores: Array<{ fact: Fact; score: number }> = [];

  for (const fact of facts) {
    // Skip user-affirmed facts (high value)
    if (fact.userAffirmed) continue;

    const score = calculateFactRetentionScore(fact, db) as number;
    factScores.push({ fact, score });
  }

  // Demote (retract) low-retention facts instead of deleting
  for (const { fact, score } of factScores) {
    if (score < minRetentionScore) {
      if (!options.dryRun) {
        // Demote by retracting (marks as inactive but keeps the record)
        db.retractFact(fact.id, `Low retention score: ${score.toFixed(3)}`);
      }
      result.factsDemoted++;
    }
  }

  log.info("Active forgetting completed", {
    ...result,
    dryRun: options.dryRun,
  });

  return result;
}

/**
 * Check if an episode has expired based on TTL
 */
function isExpired(episode: Episode): boolean {
  if (episode.ttl === "permanent") return false;

  const created = new Date(episode.createdAt).getTime();
  const now = Date.now();
  const ageMs = now - created;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  switch (episode.ttl) {
    case "7d":
      return ageDays > 7;
    case "30d":
      return ageDays > 30;
    case "90d":
      return ageDays > 90;
    default:
      return false;
  }
}

// =============================================================================
// RETENTION ANALYSIS
// =============================================================================

/**
 * Analyze retention scores across all memories
 */
export function analyzeRetention(db: SheepDatabase): {
  episodes: {
    total: number;
    byScore: { high: number; medium: number; low: number };
    avgScore: number;
  };
  facts: {
    total: number;
    byScore: { high: number; medium: number; low: number };
    avgScore: number;
  };
  recommendations: string[];
} {
  const episodes = db.queryEpisodes({ limit: 1000 });
  const facts = db.findFacts({ activeOnly: true });

  // Calculate episode scores
  const episodeScores = episodes
    .filter((e) => e.ttl !== "permanent")
    .map((e) => calculateEpisodeRetentionScore(e, db) as number);

  const episodeHigh = episodeScores.filter((s) => s >= 0.6).length;
  const episodeMedium = episodeScores.filter((s) => s >= 0.3 && s < 0.6).length;
  const episodeLow = episodeScores.filter((s) => s < 0.3).length;
  const episodeAvg =
    episodeScores.length > 0 ? episodeScores.reduce((a, b) => a + b, 0) / episodeScores.length : 0;

  // Calculate fact scores
  const factScores = facts
    .filter((f) => !f.userAffirmed)
    .map((f) => calculateFactRetentionScore(f, db) as number);

  const factHigh = factScores.filter((s) => s >= 0.6).length;
  const factMedium = factScores.filter((s) => s >= 0.3 && s < 0.6).length;
  const factLow = factScores.filter((s) => s < 0.3).length;
  const factAvg =
    factScores.length > 0 ? factScores.reduce((a, b) => a + b, 0) / factScores.length : 0;

  // Generate recommendations
  const recommendations: string[] = [];

  if (episodeLow > episodeHigh) {
    recommendations.push(
      "Many episodes have low retention - consider consolidation to extract key facts",
    );
  }
  if (factLow > factHigh) {
    recommendations.push(
      "Many facts have low retention - may need more user interaction to affirm important facts",
    );
  }
  if (episodeAvg < 0.4) {
    recommendations.push(
      "Low overall episode retention - increase activity or mark important memories as permanent",
    );
  }
  if (factAvg < 0.4) {
    recommendations.push("Low overall fact retention - review and affirm important facts");
  }

  return {
    episodes: {
      total: episodes.length,
      byScore: { high: episodeHigh, medium: episodeMedium, low: episodeLow },
      avgScore: episodeAvg,
    },
    facts: {
      total: facts.length,
      byScore: { high: factHigh, medium: factMedium, low: factLow },
      avgScore: factAvg,
    },
    recommendations,
  };
}
