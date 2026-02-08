/**
 * SHEEP AI - Cognitive Memory Schema
 *
 * Sleep-based Hierarchical Emergent Entity Protocol
 *
 * This module defines the core data structures for SHEEP AI's
 * hierarchical memory system that mimics human cognitive memory:
 *
 * - Episodes: "What happened" - timestamped summaries of conversations
 * - Facts: "What I know" - subject-predicate-object triples with confidence
 * - CausalLinks: "Why things happen" - cause → effect → mechanism
 * - Procedures: "How to do things" - trigger → action patterns
 *
 * @module sheep/memory/schema
 */

import { Type, Static } from "@sinclair/typebox";

// =============================================================================
// EPISODE - "What happened"
// =============================================================================

/**
 * An Episode represents a coherent unit of conversation or interaction.
 * Episodes are extracted from raw session transcripts and summarized.
 * They form the "episodic memory" layer - remembering events and experiences.
 */
export const EpisodeSchema = Type.Object({
  /** Unique episode identifier (e.g., "ep-<uuid>") */
  id: Type.String(),

  /** When the episode occurred (ISO 8601) */
  timestamp: Type.String(),

  /** One-sentence summary of the episode */
  summary: Type.String(),

  /** Who was involved (usernames, "user", "assistant", etc.) */
  participants: Type.Array(Type.String()),

  /** Main topic of the episode */
  topic: Type.String(),

  /** Keywords/tags for faster retrieval */
  keywords: Type.Array(Type.String()),

  /**
   * Emotional significance score (0-1)
   * Higher = more memorable, less likely to be forgotten
   * Calculated from sentiment, exclamations, explicit importance markers
   */
  emotionalSalience: Type.Number(),

  /**
   * Utility score (0-1)
   * Higher = more useful for future reference
   * Calculated from: was action taken? question answered? problem solved?
   */
  utilityScore: Type.Number(),

  /** Original session this episode came from */
  sourceSessionId: Type.String(),

  /** Original message IDs that comprise this episode */
  sourceMessageIds: Type.Array(Type.String()),

  /**
   * Time to live - how long before this can be forgotten
   * Shorter for trivial episodes, longer for important ones
   */
  ttl: Type.Union([
    Type.Literal("7d"),
    Type.Literal("30d"),
    Type.Literal("90d"),
    Type.Literal("permanent"),
  ]),

  /** Number of times this episode was accessed/retrieved */
  accessCount: Type.Number(),

  /** When this episode was last accessed */
  lastAccessedAt: Type.Optional(Type.String()),

  /** When this record was created */
  createdAt: Type.String(),

  /** When this record was last updated */
  updatedAt: Type.String(),
});

export type Episode = Static<typeof EpisodeSchema>;

// =============================================================================
// FACT - "What I know"
// =============================================================================

/**
 * A Fact represents a piece of knowledge in subject-predicate-object form.
 * Facts form the "semantic memory" layer - general knowledge and beliefs.
 *
 * Examples:
 * - subject: "user", predicate: "prefers", object: "Opus 4.5"
 * - subject: "user", predicate: "works_at", object: "Acme Corp"
 * - subject: "project", predicate: "uses", object: "TypeScript"
 */
export const FactSchema = Type.Object({
  /** Unique fact identifier (e.g., "fact-<uuid>") */
  id: Type.String(),

  /** The entity this fact is about */
  subject: Type.String(),

  /** The relationship type */
  predicate: Type.String(),

  /** The value or target entity */
  object: Type.String(),

  /**
   * Confidence score (0-1)
   * - 1.0: User explicitly stated this
   * - 0.8-0.9: Strongly implied from multiple episodes
   * - 0.5-0.7: Inferred from context
   * - <0.5: Uncertain, needs confirmation
   */
  confidence: Type.Number(),

  /** Episode IDs that support this fact */
  evidence: Type.Array(Type.String()),

  /** When this fact was first learned */
  firstSeen: Type.String(),

  /** When this fact was last confirmed or reinforced */
  lastConfirmed: Type.String(),

  /** Fact IDs that contradict this fact */
  contradictions: Type.Array(Type.String()),

  /**
   * Was this fact explicitly confirmed by the user?
   * User-affirmed facts always win in contradiction resolution
   */
  userAffirmed: Type.Boolean(),

  /**
   * Is this fact currently active?
   * Retracted facts are marked inactive but not deleted (for history)
   */
  isActive: Type.Boolean(),

  /** If retracted, why? */
  retractedReason: Type.Optional(Type.String()),

  /** Number of times this fact was accessed/used */
  accessCount: Type.Number(),

  /** When this record was created */
  createdAt: Type.String(),

  /** When this record was last updated */
  updatedAt: Type.String(),
});

export type Fact = Static<typeof FactSchema>;

// =============================================================================
// CAUSAL LINK - "Why things happen"
// =============================================================================

/**
 * A CausalLink represents a cause-effect relationship with mechanism.
 * This enables "why" queries - understanding causality, not just correlation.
 *
 * Example:
 * - cause: "Sonnet had injection issues" (fact-001)
 * - effect: "User switched to Opus" (fact-002)
 * - mechanism: "Security concerns led to model change"
 */
export const CausalLinkSchema = Type.Object({
  /** Unique causal link identifier (e.g., "cl-<uuid>") */
  id: Type.String(),

  /** Type of cause: a fact, an episode, or an external event */
  causeType: Type.Union([Type.Literal("fact"), Type.Literal("episode"), Type.Literal("event")]),

  /** ID of the cause (fact ID, episode ID, or event description) */
  causeId: Type.String(),

  /** Human-readable description of the cause */
  causeDescription: Type.String(),

  /** Type of effect: a fact, an episode, or an external event */
  effectType: Type.Union([Type.Literal("fact"), Type.Literal("episode"), Type.Literal("event")]),

  /** ID of the effect (fact ID, episode ID, or event description) */
  effectId: Type.String(),

  /** Human-readable description of the effect */
  effectDescription: Type.String(),

  /**
   * The mechanism - HOW the cause led to the effect
   * This is the key insight for causal reasoning
   */
  mechanism: Type.String(),

  /** Confidence in this causal relationship (0-1) */
  confidence: Type.Number(),

  /** Episode IDs that provide evidence for this causal link */
  evidence: Type.Array(Type.String()),

  /** Time between cause and effect (e.g., "1h", "2d", "immediate") */
  temporalDelay: Type.Optional(Type.String()),

  /**
   * Is this a direct cause or contributing factor?
   * - "direct": A caused B
   * - "contributing": A contributed to B (with other factors)
   */
  causalStrength: Type.Union([Type.Literal("direct"), Type.Literal("contributing")]),

  /** When this record was created */
  createdAt: Type.String(),

  /** When this record was last updated */
  updatedAt: Type.String(),
});

export type CausalLink = Static<typeof CausalLinkSchema>;

// =============================================================================
// PROCEDURE - "How to do things"
// =============================================================================

/**
 * A Procedure represents a behavioral pattern - how the user likes things done.
 * This is "procedural memory" - knowing how to do something.
 *
 * Example:
 * - trigger: "when debugging TypeScript"
 * - action: "use verbose output and step through code"
 * - successRate: 0.85 (works 85% of the time)
 */
export const ProcedureSchema = Type.Object({
  /** Unique procedure identifier (e.g., "proc-<uuid>") */
  id: Type.String(),

  /** What triggers this procedure (situation/context) */
  trigger: Type.String(),

  /** The action or approach to take */
  action: Type.String(),

  /** Optional: expected outcome when this procedure is followed */
  expectedOutcome: Type.Optional(Type.String()),

  /** Episode IDs where this procedure was observed */
  examples: Type.Array(Type.String()),

  /**
   * Success rate (0-1)
   * Calculated as timesSucceeded / timesUsed
   */
  successRate: Type.Number(),

  /** Number of times this procedure was followed */
  timesUsed: Type.Number(),

  /** Number of times following this procedure led to success */
  timesSucceeded: Type.Number(),

  /** Tags for categorization */
  tags: Type.Array(Type.String()),

  /** When this record was created */
  createdAt: Type.String(),

  /** When this record was last updated */
  updatedAt: Type.String(),
});

export type Procedure = Static<typeof ProcedureSchema>;

// =============================================================================
// FORESIGHT - Predictive Memory (Inspired by EverMemOS)
// =============================================================================

/**
 * A Foresight tracks time-bounded predictions/intentions from conversations.
 * Examples: "User plans to buy a Mac Studio this month"
 *           "User will travel to Istanbul next week"
 */
export const ForesightSchema = Type.Object({
  /** Unique identifier */
  id: Type.String(),
  /** What is predicted to happen (max 200 chars) */
  description: Type.String(),
  /** Evidence from conversation supporting this prediction */
  evidence: Type.String(),
  /** When this prediction becomes relevant */
  startTime: Type.String(),
  /** When this prediction expires (null = indefinite) */
  endTime: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  /** Duration in days (null = indefinite) */
  durationDays: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  /** Confidence score 0-1 */
  confidence: Type.Number(),
  /** Source episode ID */
  sourceEpisodeId: Type.Optional(Type.String()),
  /** User this foresight belongs to */
  userId: Type.String(),
  /** Whether this foresight is still active/valid */
  isActive: Type.Boolean(),
  /** When this foresight was created */
  createdAt: Type.String(),
});

export type Foresight = Static<typeof ForesightSchema>;

// =============================================================================
// MEMORY CHANGE - Differential Encoding
// =============================================================================

/**
 * A MemoryChange tracks what changed in memory over time.
 * This enables:
 * - Point-in-time queries ("What did I believe on Jan 15?")
 * - Auditing ("Why did this fact change?")
 * - Differential encoding (store changes, not duplicates)
 */
export const MemoryChangeSchema = Type.Object({
  /** Unique change identifier */
  id: Type.String(),

  /** Type of change */
  changeType: Type.Union([
    Type.Literal("add"), // New memory added
    Type.Literal("modify"), // Existing memory modified
    Type.Literal("retract"), // Memory retracted (marked inactive)
    Type.Literal("strengthen"), // Confidence increased
    Type.Literal("weaken"), // Confidence decreased
    Type.Literal("merge"), // Two memories merged
  ]),

  /** Type of memory that changed */
  targetType: Type.Union([
    Type.Literal("episode"),
    Type.Literal("fact"),
    Type.Literal("causal_link"),
    Type.Literal("procedure"),
  ]),

  /** ID of the changed memory */
  targetId: Type.String(),

  /** Previous state (JSON stringified, for modify/retract/strengthen/weaken) */
  previousValue: Type.Optional(Type.String()),

  /** New state (JSON stringified) */
  newValue: Type.String(),

  /** Human-readable reason for the change */
  reason: Type.String(),

  /** Episode ID that triggered this change (if any) */
  triggerEpisodeId: Type.Optional(Type.String()),

  /** Consolidation run ID that made this change (if any) */
  consolidationRunId: Type.Optional(Type.String()),

  /** When this change occurred */
  createdAt: Type.String({ format: "date-time" }),
});

export type MemoryChange = Static<typeof MemoryChangeSchema>;

// =============================================================================
// CONSOLIDATION RUN - Sleep Cycle Tracking
// =============================================================================

/**
 * A ConsolidationRun tracks when "sleep" consolidation happened.
 * This is the core of SHEEP AI - periodic memory processing.
 */
export const ConsolidationRunSchema = Type.Object({
  /** Unique run identifier */
  id: Type.String(),

  /** When consolidation started */
  startedAt: Type.String(),

  /** When consolidation completed (null if still running) */
  completedAt: Type.Optional(Type.String()),

  /** Current status */
  status: Type.Union([
    Type.Literal("running"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("cancelled"),
  ]),

  /** Time range processed: start */
  processedFrom: Type.String(),

  /** Time range processed: end */
  processedTo: Type.String(),

  /** Number of raw sessions processed */
  sessionsProcessed: Type.Number(),

  /** Number of episodes extracted */
  episodesExtracted: Type.Number(),

  /** Number of facts extracted */
  factsExtracted: Type.Number(),

  /** Number of causal links extracted */
  causalLinksExtracted: Type.Number(),

  /** Number of procedures extracted */
  proceduresExtracted: Type.Number(),

  /** Number of contradictions detected and resolved */
  contradictionsResolved: Type.Number(),

  /** Number of memories pruned (forgotten) */
  memoriesPruned: Type.Number(),

  /** Duration in milliseconds */
  durationMs: Type.Optional(Type.Number()),

  /** Error message if failed */
  errorMessage: Type.Optional(Type.String()),

  /** Detailed log of what happened */
  log: Type.Optional(Type.Array(Type.String())),
});

export type ConsolidationRun = Static<typeof ConsolidationRunSchema>;

// =============================================================================
// MEMORY QUERY TYPES
// =============================================================================

/**
 * Types of memory queries for the prefetch router
 */
/**
 * Intent type for memory classification
 */
export const IntentTypeSchema = Type.Union([
  Type.Literal("question"), // Asking a question
  Type.Literal("command"), // Requesting an action
  Type.Literal("reference"), // Referencing past conversations
  Type.Literal("social"), // Social interaction
  Type.Literal("creative"), // Creative request
]);

export type IntentType = Static<typeof IntentTypeSchema>;

/**
 * Memory intent - classified user intent with entities and temporal hints
 */
export const MemoryIntentSchema = Type.Object({
  /** Type of intent */
  intentType: IntentTypeSchema,

  /** Entities mentioned */
  entities: Type.Array(Type.String()),

  /** Temporal hints (e.g., "yesterday", "last week") */
  temporalHints: Type.Array(Type.String()),

  /** Context requirements */
  contextRequirements: Type.Array(Type.String()),
});

export type MemoryIntent = Static<typeof MemoryIntentSchema>;

/**
 * Prefetch prediction - what memories will likely be needed
 */
export const PrefetchPredictionSchema = Type.Object({
  /** Predicted intent of the query */
  intent: MemoryIntentSchema,

  /** Predicted memory needs */
  predictedNeeds: Type.Array(Type.String()),

  /** Confidence in this prediction (0-1) */
  confidence: Type.Number(),

  /** Suggested queries to run */
  suggestedQueries: Type.Array(Type.String()),
});

export type PrefetchPrediction = Static<typeof PrefetchPredictionSchema>;

// =============================================================================
// RETENTION SCORING
// =============================================================================

/**
 * Retention score for active forgetting decisions
 */
export const RetentionScoreSchema = Type.Object({
  /** ID of the memory being scored */
  memoryId: Type.String(),

  /** Type of memory */
  memoryType: Type.Union([
    Type.Literal("episode"),
    Type.Literal("fact"),
    Type.Literal("causal_link"),
    Type.Literal("procedure"),
  ]),

  /** Access frequency component (20% weight) */
  accessFrequency: Type.Number({ minimum: 0, maximum: 1 }),

  /** Emotional salience component (15% weight) */
  emotionalSalience: Type.Number({ minimum: 0, maximum: 1 }),

  /** Causal importance - is this part of causal chains? (25% weight) */
  causalImportance: Type.Number({ minimum: 0, maximum: 1 }),

  /** Recency component (15% weight) */
  recency: Type.Number({ minimum: 0, maximum: 1 }),

  /** Uniqueness - is this information stored elsewhere? (15% weight) */
  uniqueness: Type.Number({ minimum: 0, maximum: 1 }),

  /** Was this explicitly marked important by user? (10% weight) */
  userMarked: Type.Boolean(),

  /** Final weighted score (0-1) */
  totalScore: Type.Number({ minimum: 0, maximum: 1 }),

  /** Recommendation: keep, demote, or forget */
  recommendation: Type.Union([
    Type.Literal("keep"),
    Type.Literal("demote"),
    Type.Literal("forget"),
  ]),
});

export type RetentionScore = Static<typeof RetentionScoreSchema>;

// =============================================================================
// MEMORY STATISTICS
// =============================================================================

/**
 * Statistics about the memory system
 */
export const MemoryStatsSchema = Type.Object({
  /** Agent ID */
  agentId: Type.String(),

  /** Total episodes stored */
  totalEpisodes: Type.Number({ minimum: 0 }),

  /** Total active facts */
  totalFacts: Type.Number({ minimum: 0 }),

  /** Total causal links */
  totalCausalLinks: Type.Number({ minimum: 0 }),

  /** Total procedures */
  totalProcedures: Type.Number({ minimum: 0 }),

  /** Total user profiles */
  totalUserProfiles: Type.Number({ minimum: 0 }),

  /** Total preferences */
  totalPreferences: Type.Number({ minimum: 0 }),

  /** Total relationships */
  totalRelationships: Type.Number({ minimum: 0 }),

  /** Total core memories */
  totalCoreMemories: Type.Number({ minimum: 0 }),

  /** Approximate size in bytes */
  totalSizeBytes: Type.Number({ minimum: 0 }),

  /** When last consolidation ran */
  lastConsolidation: Type.Optional(Type.String({ format: "date-time" })),

  /** When oldest memory was created */
  oldestMemory: Type.Optional(Type.String({ format: "date-time" })),

  /** When newest memory was created */
  newestMemory: Type.Optional(Type.String({ format: "date-time" })),

  /** Average fact confidence */
  averageFactConfidence: Type.Number({ minimum: 0, maximum: 1 }),

  /** Total memories pruned all time */
  totalPruned: Type.Number({ minimum: 0 }),
});

export type MemoryStats = Static<typeof MemoryStatsSchema>;

// =============================================================================
// UTILITY TYPES
// =============================================================================

export type MemoryType = "episode" | "fact" | "causal_link" | "procedure";

export type AnyMemory = Episode | Fact | CausalLink | Procedure;

/**
 * Helper to generate IDs
 */
export function generateId(
  prefix: "ep" | "fact" | "cl" | "proc" | "mc" | "cr" | "up" | "pref" | "rel" | "cm",
): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Helper to get current ISO timestamp
 */
export function now(): string {
  return new Date().toISOString();
}

// =============================================================================
// USER PROFILE - "Who the user is"
// =============================================================================

/**
 * UserProfile represents structured information about a user.
 * Extracted from conversations to build a comprehensive user model.
 */
export const UserProfileSchema = Type.Object({
  /** Unique profile identifier */
  id: Type.String(),

  /** User identifier (e.g., "user", "alice", etc.) */
  userId: Type.String(),

  /** Structured attributes about the user */
  attributes: Type.Object({
    name: Type.Optional(Type.String()),
    age: Type.Optional(Type.Number()),
    location: Type.Optional(Type.String()),
    occupation: Type.Optional(Type.String()),
    interests: Type.Optional(Type.Array(Type.String())),
    personality: Type.Optional(Type.Array(Type.String())),
  }),

  /** Confidence in this profile information (0-1) */
  confidence: Type.Number(),

  /** When this profile was created */
  createdAt: Type.String(),

  /** When this profile was last updated */
  updatedAt: Type.String(),
});

export type UserProfile = Static<typeof UserProfileSchema>;

// =============================================================================
// PREFERENCE - "What the user likes/dislikes"
// =============================================================================

/**
 * Preference represents a user's preference in a specific category.
 * Extracted from conversations to understand user preferences.
 */
export const PreferenceSchema = Type.Object({
  /** Unique preference identifier */
  id: Type.String(),

  /** User identifier */
  userId: Type.String(),

  /** Category of preference (e.g., "food", "music", "work", "technology") */
  category: Type.String(),

  /** The preference value */
  preference: Type.String(),

  /** Sentiment: positive (likes), negative (dislikes), neutral */
  sentiment: Type.Union([
    Type.Literal("positive"),
    Type.Literal("negative"),
    Type.Literal("neutral"),
  ]),

  /** Confidence in this preference (0-1) */
  confidence: Type.Number(),

  /** Source episode ID where this preference was extracted */
  source: Type.String(),

  /** When this preference was created */
  createdAt: Type.String(),
});

export type Preference = Static<typeof PreferenceSchema>;

// =============================================================================
// RELATIONSHIP - "Who knows whom"
// =============================================================================

/**
 * Relationship represents a relationship between two entities (people).
 * Extracted from conversations to understand social connections.
 */
export const RelationshipSchema = Type.Object({
  /** Unique relationship identifier */
  id: Type.String(),

  /** First person in the relationship */
  person1: Type.String(),

  /** Second person in the relationship */
  person2: Type.String(),

  /** Type of relationship (e.g., "friend", "colleague", "family", "acquaintance") */
  relationshipType: Type.String(),

  /** Relationship strength (0-1, higher = stronger relationship) */
  strength: Type.Number(),

  /** Episode IDs that provide evidence for this relationship */
  evidence: Type.Array(Type.String()),

  /** When this relationship was first identified */
  createdAt: Type.String(),

  /** When this relationship was last updated */
  updatedAt: Type.String(),
});

export type Relationship = Static<typeof RelationshipSchema>;

// =============================================================================
// CORE MEMORY - "Never forget this"
// =============================================================================

/**
 * CoreMemory represents a highly important memory that should never be forgotten.
 * These are significant events, achievements, losses, or milestones.
 */
export const CoreMemorySchema = Type.Object({
  /** Unique core memory identifier */
  id: Type.String(),

  /** The memory content/description */
  content: Type.String(),

  /** Importance score (0-1, higher = never forget) */
  importance: Type.Number(),

  /** Emotional weight/impact (0-1) */
  emotionalWeight: Type.Number(),

  /** Category of core memory */
  category: Type.Union([
    Type.Literal("achievement"),
    Type.Literal("loss"),
    Type.Literal("relationship"),
    Type.Literal("decision"),
    Type.Literal("milestone"),
  ]),

  /** When this core memory was created */
  createdAt: Type.String(),
});

export type CoreMemory = Static<typeof CoreMemorySchema>;

// =============================================================================
// EXPORTS
// =============================================================================

export const schemas = {
  Episode: EpisodeSchema,
  Fact: FactSchema,
  CausalLink: CausalLinkSchema,
  Procedure: ProcedureSchema,
  MemoryChange: MemoryChangeSchema,
  ConsolidationRun: ConsolidationRunSchema,
  MemoryIntent: MemoryIntentSchema,
  PrefetchPrediction: PrefetchPredictionSchema,
  RetentionScore: RetentionScoreSchema,
  MemoryStats: MemoryStatsSchema,
  UserProfile: UserProfileSchema,
  Preference: PreferenceSchema,
  Relationship: RelationshipSchema,
  CoreMemory: CoreMemorySchema,
};
