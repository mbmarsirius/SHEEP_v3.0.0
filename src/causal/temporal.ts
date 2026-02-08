/**
 * SHEEP AI - Temporal Reasoning
 *
 * Enables point-in-time queries and belief evolution tracking:
 * - "What did I believe on January 15?"
 * - "How has my understanding of X changed?"
 * - "When did I first learn Y?"
 *
 * @module sheep/causal/temporal
 */

import { SheepDatabase } from "../memory/database.js";
import type { Fact, Episode, MemoryChange } from "../memory/schema.js";

// =============================================================================
// TYPES
// =============================================================================

export type TemporalQuery = {
  /** Point in time to query (ISO string) */
  asOf: string;
  /** Optional subject filter */
  subject?: string;
  /** Optional predicate filter */
  predicate?: string;
};

export type BeliefSnapshot = {
  asOf: string;
  facts: Fact[];
  recentEpisodes: Episode[];
};

export type BeliefEvolution = {
  subject: string;
  predicate: string;
  timeline: Array<{
    timestamp: string;
    value: string;
    confidence: number;
    changeType: "learned" | "updated" | "retracted";
    reason?: string;
  }>;
  firstLearned: string;
  lastUpdated: string;
  totalChanges: number;
};

export type TemporalDiff = {
  fromTimestamp: string;
  toTimestamp: string;
  factsAdded: Fact[];
  factsRemoved: Array<{
    id: string;
    subject: string;
    predicate: string;
    object: string;
    reason: string;
  }>;
  factsModified: Array<{
    id: string;
    before: string;
    after: string;
    reason: string;
  }>;
  episodesAdded: number;
};

export type BeliefExplanation = {
  fact: Fact | null;
  evidenceChain: Array<{
    episodeId: string;
    episodeSummary: string;
    timestamp: string;
  }>;
  changeHistory: MemoryChange[];
};

// =============================================================================
// TEMPORAL QUERIES
// =============================================================================

/**
 * Get beliefs as they were at a specific point in time.
 * Reconstructs the state of SHEEP's memory as of the given timestamp.
 */
export function getBeliefSnapshot(db: SheepDatabase, query: TemporalQuery): BeliefSnapshot {
  // Use the database's point-in-time query
  const facts = db.queryFactsAtTime(query.asOf, {
    subject: query.subject,
    predicate: query.predicate,
  });

  // Get episodes around that time (within 7 days window)
  const episodes = db.queryEpisodesAtTime(query.asOf, 7);

  return {
    asOf: query.asOf,
    facts,
    recentEpisodes: episodes,
  };
}

/**
 * Track how a specific belief has evolved over time.
 * Shows the history of a fact from when it was first learned to now.
 */
export function trackBeliefEvolution(
  db: SheepDatabase,
  subject: string,
  predicate?: string,
): BeliefEvolution {
  const timeline = db.getBeliefTimeline(subject);

  // Filter to specific predicate if provided
  const filtered = predicate
    ? timeline.filter((t) => t.predicate.toLowerCase().includes(predicate.toLowerCase()))
    : timeline;

  if (filtered.length === 0) {
    return {
      subject,
      predicate: predicate ?? "*",
      timeline: [],
      firstLearned: "",
      lastUpdated: "",
      totalChanges: 0,
    };
  }

  // Sort by timestamp
  filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return {
    subject,
    predicate: predicate ?? "*",
    timeline: filtered.map((t) => ({
      timestamp: t.timestamp,
      value: t.value,
      confidence: t.confidence,
      changeType:
        t.changeType === "created"
          ? "learned"
          : t.changeType === "retracted"
            ? "retracted"
            : "updated",
      reason: t.reason,
    })),
    firstLearned: filtered[0].timestamp,
    lastUpdated: filtered[filtered.length - 1].timestamp,
    totalChanges: filtered.length,
  };
}

/**
 * Compare beliefs between two points in time.
 * Shows what was added, removed, or modified between the two timestamps.
 */
export function compareBeliefs(
  db: SheepDatabase,
  fromTimestamp: string,
  toTimestamp: string,
): TemporalDiff {
  const changes = db.getChangesSince(fromTimestamp);

  // Filter to changes before toTimestamp
  const newFacts = changes.newFacts.filter((f) => f.createdAt <= toTimestamp);
  const retractedFacts = changes.retractedFacts.filter((r) => r.timestamp <= toTimestamp);
  const updatedFacts = changes.updatedFacts.filter((u) => u.createdAt <= toTimestamp);
  const newEpisodes = changes.newEpisodes.filter((e) => e.createdAt <= toTimestamp);

  return {
    fromTimestamp,
    toTimestamp,
    factsAdded: newFacts,
    factsRemoved: retractedFacts.map((r) => ({
      id: r.id,
      subject: "", // Would need to look up original fact
      predicate: "",
      object: "",
      reason: r.reason,
    })),
    factsModified: updatedFacts.map((u) => ({
      id: u.targetId,
      before: u.previousValue ?? "",
      after: u.newValue,
      reason: u.reason,
    })),
    episodesAdded: newEpisodes.length,
  };
}

/**
 * Find when a specific fact was first learned.
 * Returns the timestamp and episode where the fact originated.
 */
export function whenLearned(
  db: SheepDatabase,
  subject: string,
  predicate: string,
  object?: string,
): { timestamp: string; episode?: string } | null {
  const facts = db.findFacts({
    subject,
    predicate,
    object,
    activeOnly: false, // Include retracted facts
  });

  if (facts.length === 0) return null;

  // Sort by firstSeen and return earliest
  facts.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));

  return {
    timestamp: facts[0].firstSeen,
    episode: facts[0].evidence[0],
  };
}

/**
 * Explain why SHEEP believes a fact.
 * Traces the evidence chain and change history for a current belief.
 */
export function explainBelief(db: SheepDatabase, factId: string): BeliefExplanation {
  const fact = db.getFact(factId);

  if (!fact) {
    return {
      fact: null,
      evidenceChain: [],
      changeHistory: [],
    };
  }

  // Get evidence episodes
  const evidenceChain: BeliefExplanation["evidenceChain"] = [];

  for (const epId of fact.evidence) {
    const episode = db.getEpisode(epId);
    if (episode) {
      evidenceChain.push({
        episodeId: epId,
        episodeSummary: episode.summary,
        timestamp: episode.timestamp,
      });
    }
  }

  // Get change history
  const changeHistory = db.getChangesFor("fact", factId);

  return {
    fact,
    evidenceChain,
    changeHistory,
  };
}

// =============================================================================
// HELPER: FIND FACTS BY CRITERIA
// =============================================================================

/**
 * Find facts matching a partial description.
 * Useful for queries like "What do I know about TypeScript?"
 */
export function findFactsAbout(db: SheepDatabase, topic: string): Fact[] {
  const topicLower = topic.toLowerCase();

  // Get all active facts
  const allFacts = db.findFacts({ activeOnly: true });

  // Filter by topic appearing in subject, predicate, or object
  return allFacts.filter(
    (f) =>
      f.subject.toLowerCase().includes(topicLower) ||
      f.predicate.toLowerCase().includes(topicLower) ||
      f.object.toLowerCase().includes(topicLower),
  );
}

/**
 * Get the most confident facts about a subject.
 * Returns facts sorted by confidence.
 */
export function getMostConfidentFacts(
  db: SheepDatabase,
  subject: string,
  limit: number = 10,
): Fact[] {
  const facts = db.findFacts({ subject, activeOnly: true });
  return facts.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

// =============================================================================
// NATURAL LANGUAGE TIME PARSING
// =============================================================================

/**
 * Parse natural language time references to ISO timestamps.
 * Supports: "yesterday", "last week", "January 15", "2024-01-15", etc.
 */
export function parseTimeReference(reference: string): string {
  const now = new Date();
  const refLower = reference.toLowerCase().trim();

  // Handle relative references
  if (refLower === "now" || refLower === "today") {
    return now.toISOString();
  }

  if (refLower === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString();
  }

  if (refLower === "last week" || refLower === "a week ago") {
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);
    return lastWeek.toISOString();
  }

  if (refLower === "last month" || refLower === "a month ago") {
    const lastMonth = new Date(now);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    return lastMonth.toISOString();
  }

  // Handle "N days/weeks/months ago"
  const agoMatch = refLower.match(/(\d+)\s+(day|week|month)s?\s+ago/);
  if (agoMatch) {
    const num = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    const date = new Date(now);

    if (unit === "day") {
      date.setDate(date.getDate() - num);
    } else if (unit === "week") {
      date.setDate(date.getDate() - num * 7);
    } else if (unit === "month") {
      date.setMonth(date.getMonth() - num);
    }

    return date.toISOString();
  }

  // Handle month names (e.g., "January", "January 15", "January 2024")
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

  for (let i = 0; i < months.length; i++) {
    if (refLower.includes(months[i])) {
      const date = new Date(now);
      date.setMonth(i);

      // Check for day
      const dayMatch = refLower.match(/(\d{1,2})(?:st|nd|rd|th)?/);
      if (dayMatch) {
        date.setDate(parseInt(dayMatch[1], 10));
      } else {
        date.setDate(1);
      }

      // Check for year
      const yearMatch = refLower.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        date.setFullYear(parseInt(yearMatch[1], 10));
      }

      // Set to start of day
      date.setHours(0, 0, 0, 0);
      return date.toISOString();
    }
  }

  // Try parsing as ISO date directly
  const parsed = new Date(reference);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  // Default to now if we can't parse
  return now.toISOString();
}

/**
 * Format a timestamp for human-readable display
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
