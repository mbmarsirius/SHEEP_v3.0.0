/**
 * SHEEP AI - Metrics Tracking
 *
 * Tracks key performance metrics for SHEEP AI:
 * - Prefetch hit rate (memories found / prefetches attempted)
 * - Memory recall accuracy
 * - Consolidation performance
 * - Learning effectiveness
 *
 * @module sheep/metrics/metrics
 */

import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Timing breakdown for prefetch operations
 */
export type PrefetchTimingBreakdown = {
  /** Total prefetch time */
  totalMs: number;
  /** Time to classify intent */
  intentClassificationMs: number;
  /** Time to extract entities */
  entityExtractionMs: number;
  /** Time to query database */
  dbQueryMs: number;
  /** Time for semantic search (if used) */
  semanticSearchMs?: number;
  /** Whether we met the <100ms target */
  metLatencyTarget: boolean;
};

/**
 * Prefetch metrics for a single operation
 */
export type PrefetchMetrics = {
  /** Timestamp of the prefetch */
  timestamp: number;
  /** Agent ID */
  agentId: string;
  /** Whether prefetch found any memories */
  hadMemories: boolean;
  /** Number of facts prefetched */
  factsCount: number;
  /** Number of episodes prefetched */
  episodesCount: number;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Intent type detected */
  intentType?: string;
  /** Entities extracted */
  entities?: string[];
  /** Detailed timing breakdown */
  timing?: PrefetchTimingBreakdown;
};

/**
 * Enhanced prefetch metrics with timing breakdown
 */
export type EnhancedPrefetchMetrics = PrefetchMetrics & {
  timing: PrefetchTimingBreakdown;
};

/**
 * Aggregated prefetch statistics
 */
export type PrefetchStats = {
  /** Total number of prefetches */
  totalPrefetches: number;
  /** Number of prefetches that found memories */
  successfulPrefetches: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Average duration in ms */
  avgDurationMs: number;
  /** Total facts prefetched */
  totalFacts: number;
  /** Total episodes prefetched */
  totalEpisodes: number;
  /** Breakdown by intent type */
  byIntentType: Record<string, { count: number; hitRate: number }>;
};

/**
 * Learning metrics for a single operation
 */
export type LearningMetrics = {
  /** Timestamp of the learning */
  timestamp: number;
  /** Agent ID */
  agentId: string;
  /** Number of facts learned */
  factsLearned: number;
  /** Number of episodes created */
  episodesCreated: number;
  /** Number of causal links found */
  causalLinksFound: number;
  /** Number of procedures extracted */
  proceduresExtracted: number;
  /** Duration in ms */
  durationMs: number;
};

/**
 * LLM Sleep consolidation metrics
 */
export type LLMSleepMetrics = {
  /** Timestamp of the sleep cycle */
  timestamp: number;
  /** Agent ID */
  agentId: string;
  /** Number of memories processed */
  memoriesProcessed: number;
  /** Patterns discovered */
  patternsDiscovered: number;
  /** Facts consolidated */
  factsConsolidated: number;
  /** Connections created */
  connectionsCreated: number;
  /** Forgetting recommendations */
  forgettingRecommendations: number;
  /** Contradictions resolved */
  contradictionsResolved: number;
  /** Total duration in ms */
  durationMs: number;
  /** LLM tokens used (if available) */
  tokensUsed?: number;
  /** LLM cost estimate in USD (if available) */
  costEstimate?: number;
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
};

/**
 * Aggregated learning statistics
 */
export type LearningStats = {
  /** Total learning operations */
  totalOperations: number;
  /** Total facts learned */
  totalFactsLearned: number;
  /** Total episodes created */
  totalEpisodesCreated: number;
  /** Total causal links */
  totalCausalLinks: number;
  /** Total procedures */
  totalProcedures: number;
  /** Average duration */
  avgDurationMs: number;
};

// =============================================================================
// METRICS STORAGE
// =============================================================================

/**
 * Rolling window size for metrics (last N operations)
 */
const METRICS_WINDOW_SIZE = 1000;

/**
 * Prefetch metrics storage
 */
const prefetchMetrics: PrefetchMetrics[] = [];

/**
 * Learning metrics storage
 */
const learningMetrics: LearningMetrics[] = [];

/**
 * LLM Sleep metrics storage
 */
const llmSleepMetrics: LLMSleepMetrics[] = [];

/**
 * Latency distribution buckets for prefetch operations
 */
const latencyBuckets = {
  under50ms: 0,
  under100ms: 0,
  under200ms: 0,
  under500ms: 0,
  over500ms: 0,
};

// =============================================================================
// PREFETCH METRICS
// =============================================================================

/**
 * Record a prefetch operation
 */
export function recordPrefetch(metrics: PrefetchMetrics): void {
  prefetchMetrics.push(metrics);

  // Track latency distribution
  const ms = metrics.durationMs;
  if (ms < 50) latencyBuckets.under50ms++;
  else if (ms < 100) latencyBuckets.under100ms++;
  else if (ms < 200) latencyBuckets.under200ms++;
  else if (ms < 500) latencyBuckets.under500ms++;
  else latencyBuckets.over500ms++;

  // Keep only last N entries
  while (prefetchMetrics.length > METRICS_WINDOW_SIZE) {
    prefetchMetrics.shift();
  }

  // Log significant events
  if (metrics.hadMemories && (metrics.factsCount > 0 || metrics.episodesCount > 0)) {
    log.info("SHEEP prefetch hit", {
      agentId: metrics.agentId,
      facts: metrics.factsCount,
      episodes: metrics.episodesCount,
      durationMs: metrics.durationMs,
      intent: metrics.intentType,
    });
  }

  // Warn if latency target missed
  if (metrics.timing && !metrics.timing.metLatencyTarget) {
    log.warn("SHEEP prefetch exceeded 100ms target", {
      agentId: metrics.agentId,
      totalMs: metrics.durationMs,
      breakdown: metrics.timing,
    });
  }
}

/**
 * Record a prefetch operation with detailed timing
 */
export function recordPrefetchWithTiming(metrics: EnhancedPrefetchMetrics): void {
  recordPrefetch(metrics);
}

/**
 * Get latency distribution buckets
 */
export function getLatencyDistribution(): {
  under50ms: number;
  under100ms: number;
  under200ms: number;
  under500ms: number;
  over500ms: number;
  total: number;
} {
  return {
    ...latencyBuckets,
    total:
      latencyBuckets.under50ms +
      latencyBuckets.under100ms +
      latencyBuckets.under200ms +
      latencyBuckets.under500ms +
      latencyBuckets.over500ms,
  };
}

/**
 * Get P50, P95, P99 latency percentiles
 */
export function getP50P95P99Latency(): { p50: number; p95: number; p99: number } {
  if (prefetchMetrics.length === 0) {
    return { p50: 0, p95: 0, p99: 0 };
  }

  const times = prefetchMetrics.map((m) => m.durationMs).sort((a, b) => a - b);
  const len = times.length;

  const p50Idx = Math.floor(len * 0.5);
  const p95Idx = Math.floor(len * 0.95);
  const p99Idx = Math.floor(len * 0.99);

  return {
    p50: times[Math.min(p50Idx, len - 1)] || 0,
    p95: times[Math.min(p95Idx, len - 1)] || 0,
    p99: times[Math.min(p99Idx, len - 1)] || 0,
  };
}

/**
 * Get aggregated prefetch statistics
 */
export function getPrefetchStats(agentId?: string): PrefetchStats {
  let filtered = prefetchMetrics;

  if (agentId) {
    filtered = prefetchMetrics.filter((m) => m.agentId === agentId);
  }

  if (filtered.length === 0) {
    return {
      totalPrefetches: 0,
      successfulPrefetches: 0,
      hitRate: 0,
      avgDurationMs: 0,
      totalFacts: 0,
      totalEpisodes: 0,
      byIntentType: {},
    };
  }

  const successful = filtered.filter((m) => m.hadMemories);
  const totalDuration = filtered.reduce((sum, m) => sum + m.durationMs, 0);
  const totalFacts = filtered.reduce((sum, m) => sum + m.factsCount, 0);
  const totalEpisodes = filtered.reduce((sum, m) => sum + m.episodesCount, 0);

  // Group by intent type
  const byIntentType: Record<string, { count: number; hits: number }> = {};
  for (const m of filtered) {
    const intent = m.intentType ?? "unknown";
    if (!byIntentType[intent]) {
      byIntentType[intent] = { count: 0, hits: 0 };
    }
    byIntentType[intent].count++;
    if (m.hadMemories) {
      byIntentType[intent].hits++;
    }
  }

  const byIntentTypeStats: Record<string, { count: number; hitRate: number }> = {};
  for (const [intent, data] of Object.entries(byIntentType)) {
    byIntentTypeStats[intent] = {
      count: data.count,
      hitRate: data.count > 0 ? data.hits / data.count : 0,
    };
  }

  return {
    totalPrefetches: filtered.length,
    successfulPrefetches: successful.length,
    hitRate: filtered.length > 0 ? successful.length / filtered.length : 0,
    avgDurationMs: filtered.length > 0 ? totalDuration / filtered.length : 0,
    totalFacts,
    totalEpisodes,
    byIntentType: byIntentTypeStats,
  };
}

// =============================================================================
// LEARNING METRICS
// =============================================================================

/**
 * Record a learning operation
 */
export function recordLearning(metrics: LearningMetrics): void {
  learningMetrics.push(metrics);

  // Keep only last N entries
  while (learningMetrics.length > METRICS_WINDOW_SIZE) {
    learningMetrics.shift();
  }

  // Log significant events
  if (metrics.factsLearned > 0 || metrics.proceduresExtracted > 0) {
    log.info("SHEEP learning recorded", {
      agentId: metrics.agentId,
      facts: metrics.factsLearned,
      episodes: metrics.episodesCreated,
      causalLinks: metrics.causalLinksFound,
      procedures: metrics.proceduresExtracted,
      durationMs: metrics.durationMs,
    });
  }
}

/**
 * Record LLM sleep consolidation metrics
 */
export function recordLLMSleep(metrics: LLMSleepMetrics): void {
  llmSleepMetrics.push(metrics);

  // Keep only last N entries
  while (llmSleepMetrics.length > METRICS_WINDOW_SIZE) {
    llmSleepMetrics.shift();
  }

  // Log significant events
  if (metrics.success) {
    log.info("SHEEP LLM sleep completed", {
      agentId: metrics.agentId,
      patterns: metrics.patternsDiscovered,
      consolidated: metrics.factsConsolidated,
      connections: metrics.connectionsCreated,
      durationMs: metrics.durationMs,
      tokensUsed: metrics.tokensUsed,
      costEstimate: metrics.costEstimate,
    });
  } else {
    log.error("SHEEP LLM sleep failed", {
      agentId: metrics.agentId,
      error: metrics.error,
      durationMs: metrics.durationMs,
    });
  }

  // Warn if sleep is taking too long
  if (metrics.durationMs > 60000) {
    // > 1 minute
    log.warn("SHEEP LLM sleep took longer than expected", {
      agentId: metrics.agentId,
      durationMs: metrics.durationMs,
      memoriesProcessed: metrics.memoriesProcessed,
    });
  }

  // Warn if cost is high
  if (metrics.costEstimate && metrics.costEstimate > 0.1) {
    // > $0.10
    log.warn("SHEEP LLM sleep cost is high", {
      agentId: metrics.agentId,
      costEstimate: metrics.costEstimate,
      tokensUsed: metrics.tokensUsed,
    });
  }
}

/**
 * Get aggregated LLM sleep statistics
 */
export function getLLMSleepStats(agentId?: string): {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  avgPatternsDiscovered: number;
  avgFactsConsolidated: number;
  avgConnectionsCreated: number;
  totalTokensUsed: number;
  totalCostEstimate: number;
  avgCostPerRun: number;
} {
  let filtered = llmSleepMetrics;

  if (agentId) {
    filtered = llmSleepMetrics.filter((m) => m.agentId === agentId);
  }

  if (filtered.length === 0) {
    return {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      avgDurationMs: 0,
      avgPatternsDiscovered: 0,
      avgFactsConsolidated: 0,
      avgConnectionsCreated: 0,
      totalTokensUsed: 0,
      totalCostEstimate: 0,
      avgCostPerRun: 0,
    };
  }

  const successful = filtered.filter((m) => m.success);
  const totalDuration = filtered.reduce((sum, m) => sum + m.durationMs, 0);
  const totalPatterns = filtered.reduce((sum, m) => sum + m.patternsDiscovered, 0);
  const totalConsolidated = filtered.reduce((sum, m) => sum + m.factsConsolidated, 0);
  const totalConnections = filtered.reduce((sum, m) => sum + m.connectionsCreated, 0);
  const totalTokens = filtered.reduce((sum, m) => sum + (m.tokensUsed ?? 0), 0);
  const totalCost = filtered.reduce((sum, m) => sum + (m.costEstimate ?? 0), 0);

  return {
    totalRuns: filtered.length,
    successfulRuns: successful.length,
    failedRuns: filtered.length - successful.length,
    avgDurationMs: filtered.length > 0 ? totalDuration / filtered.length : 0,
    avgPatternsDiscovered: filtered.length > 0 ? totalPatterns / filtered.length : 0,
    avgFactsConsolidated: filtered.length > 0 ? totalConsolidated / filtered.length : 0,
    avgConnectionsCreated: filtered.length > 0 ? totalConnections / filtered.length : 0,
    totalTokensUsed: totalTokens,
    totalCostEstimate: totalCost,
    avgCostPerRun: filtered.length > 0 ? totalCost / filtered.length : 0,
  };
}

/**
 * Get aggregated learning statistics
 */
export function getLearningStats(agentId?: string): LearningStats {
  let filtered = learningMetrics;

  if (agentId) {
    filtered = learningMetrics.filter((m) => m.agentId === agentId);
  }

  if (filtered.length === 0) {
    return {
      totalOperations: 0,
      totalFactsLearned: 0,
      totalEpisodesCreated: 0,
      totalCausalLinks: 0,
      totalProcedures: 0,
      avgDurationMs: 0,
    };
  }

  return {
    totalOperations: filtered.length,
    totalFactsLearned: filtered.reduce((sum, m) => sum + m.factsLearned, 0),
    totalEpisodesCreated: filtered.reduce((sum, m) => sum + m.episodesCreated, 0),
    totalCausalLinks: filtered.reduce((sum, m) => sum + m.causalLinksFound, 0),
    totalProcedures: filtered.reduce((sum, m) => sum + m.proceduresExtracted, 0),
    avgDurationMs: filtered.reduce((sum, m) => sum + m.durationMs, 0) / filtered.length,
  };
}

// =============================================================================
// COMBINED METRICS
// =============================================================================

/**
 * Get all SHEEP metrics for an agent
 */
export function getSheepMetrics(agentId?: string): {
  prefetch: PrefetchStats;
  learning: LearningStats;
  summary: {
    overallHealthScore: number;
    recommendations: string[];
  };
} {
  const prefetch = getPrefetchStats(agentId);
  const learning = getLearningStats(agentId);

  // Calculate overall health score (0-1)
  let healthScore = 0;
  const recommendations: string[] = [];

  // Prefetch hit rate contributes 40%
  healthScore += prefetch.hitRate * 0.4;

  // Learning activity contributes 30%
  const learningScore = Math.min(learning.totalOperations / 10, 1); // Cap at 10 operations
  healthScore += learningScore * 0.3;

  // Content richness contributes 30%
  const contentScore = Math.min((learning.totalFactsLearned + learning.totalProcedures) / 50, 1);
  healthScore += contentScore * 0.3;

  // Generate recommendations
  if (prefetch.hitRate < 0.3) {
    recommendations.push(
      "Low prefetch hit rate - consider running consolidation to extract more facts",
    );
  }
  if (learning.totalOperations < 5) {
    recommendations.push("Limited learning data - use SHEEP more to build memory");
  }
  if (learning.totalFactsLearned === 0) {
    recommendations.push("No facts learned yet - ensure conversations contain factual information");
  }
  if (prefetch.avgDurationMs > 500) {
    recommendations.push("High prefetch latency - consider optimizing semantic index");
  }

  return {
    prefetch,
    learning,
    summary: {
      overallHealthScore: healthScore,
      recommendations,
    },
  };
}

// =============================================================================
// METRICS EXPORT
// =============================================================================

/**
 * Export metrics to JSON for external analysis
 */
export function exportMetrics(): {
  prefetchMetrics: PrefetchMetrics[];
  learningMetrics: LearningMetrics[];
  exportedAt: string;
} {
  return {
    prefetchMetrics: [...prefetchMetrics],
    learningMetrics: [...learningMetrics],
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Clear all metrics (for testing)
 */
export function clearMetrics(): void {
  prefetchMetrics.length = 0;
  learningMetrics.length = 0;
  latencyBuckets.under50ms = 0;
  latencyBuckets.under100ms = 0;
  latencyBuckets.under200ms = 0;
  latencyBuckets.under500ms = 0;
  latencyBuckets.over500ms = 0;
}
