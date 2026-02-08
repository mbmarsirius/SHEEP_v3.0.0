/**
 * SHEEP AI - Dynamic User Profile Discriminator (V3 Spec)
 *
 * Separates stable traits from transient states.
 * Inspired by EverMemOS profile_manager/discriminator.py
 *
 * Discrimination logic:
 * - Seen 3+ times over 7+ days → stable
 * - Seen 1-2 times or recent only → transient
 * - Has explicit time reference → transient with expiry
 *
 * @module sheep/extraction/profile-discriminator
 */

import type { Fact } from "../memory/schema.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/** Stability classification for a profile fact */
export type StabilityClass = "stable" | "transient";

/** A profile fact with stability classification */
export type ProfileFact = {
  /** The original fact */
  fact: Fact;
  /** Stability classification */
  stability: StabilityClass;
  /** How many times this fact has been confirmed */
  confirmationCount: number;
  /** Days between first and last seen */
  spanDays: number;
  /** If transient, when does it expire? */
  validUntil?: string;
  /** Category: trait, preference, state, plan */
  category: "trait" | "preference" | "state" | "plan";
};

/** Structured dynamic user profile */
export type DynamicUserProfile = {
  /** User ID */
  userId: string;
  /** Stable traits (e.g., "Developer", "Lives in Cyprus") */
  stableTraits: ProfileFact[];
  /** Transient states (e.g., "Working on benchmarks", "Buying Mac Studio") */
  transientStates: ProfileFact[];
  /** Preferences (e.g., "Prefers local models") */
  preferences: ProfileFact[];
  /** Active plans/intentions */
  activePlans: ProfileFact[];
  /** Summary statistics */
  stats: {
    totalFacts: number;
    stableCount: number;
    transientCount: number;
    preferenceCount: number;
    planCount: number;
    averageConfidence: number;
  };
};

// =============================================================================
// DISCRIMINATION CONSTANTS
// =============================================================================

/** Minimum confirmations for stable classification */
const STABLE_MIN_CONFIRMATIONS = 3;

/** Minimum span in days for stable classification */
const STABLE_MIN_SPAN_DAYS = 7;

/** Predicates that indicate preferences */
const PREFERENCE_PREDICATES = new Set([
  "prefers",
  "likes",
  "dislikes",
  "hates",
  "loves",
  "favors",
  "avoids",
  "values",
  "enjoys",
]);

/** Predicates that indicate traits */
const TRAIT_PREDICATES = new Set([
  "is_a",
  "has_name",
  "works_at",
  "lives_in",
  "from",
  "speaks",
  "nationality",
  "role",
  "occupation",
  "age",
]);

/** Predicates that indicate transient states */
const STATE_PREDICATES = new Set([
  "working_on",
  "planning",
  "considering",
  "trying",
  "testing",
  "buying",
  "waiting_for",
  "debugging",
  "building",
]);

/** Predicates that indicate plans/intentions */
const PLAN_PREDICATES = new Set([
  "will",
  "plans_to",
  "intends_to",
  "wants_to",
  "going_to",
  "scheduled",
  "deadline",
]);

// =============================================================================
// CLASSIFICATION LOGIC
// =============================================================================

/**
 * Classify a fact's category based on its predicate.
 */
function classifyCategory(fact: Fact): ProfileFact["category"] {
  const pred = fact.predicate.toLowerCase();

  if (PREFERENCE_PREDICATES.has(pred)) return "preference";
  if (TRAIT_PREDICATES.has(pred)) return "trait";
  if (PLAN_PREDICATES.has(pred)) return "plan";
  if (STATE_PREDICATES.has(pred)) return "state";

  // Heuristic: if it mentions a time or deadline, it's a plan
  if (fact.object.match(/\b(week|month|day|tomorrow|soon|later|next)\b/i)) {
    return "plan";
  }

  // Default to trait if high confidence + old, else state
  return "trait";
}

/**
 * Calculate the span in days between two ISO timestamps.
 */
function daysBetween(first: string, last: string): number {
  const a = new Date(first).getTime();
  const b = new Date(last).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.abs(b - a) / (1000 * 60 * 60 * 24);
}

/**
 * Determine stability of a fact.
 *
 * Rules (from EverMemOS):
 * - Seen 3+ times over 7+ days → stable
 * - Seen 1-2 times or recent only → transient
 * - Has explicit time reference → transient with expiry
 */
function classifyStability(fact: Fact): {
  stability: StabilityClass;
  confirmationCount: number;
  spanDays: number;
  validUntil?: string;
} {
  const confirmationCount = fact.evidence.length;
  const spanDays = daysBetween(fact.firstSeen, fact.lastConfirmed);

  // Plans and states are always transient
  const category = classifyCategory(fact);
  if (category === "plan" || category === "state") {
    // Try to infer expiry from the object text
    const validUntil = inferExpiry(fact.object);
    return {
      stability: "transient",
      confirmationCount,
      spanDays,
      validUntil,
    };
  }

  // Stable: 3+ confirmations over 7+ days
  if (confirmationCount >= STABLE_MIN_CONFIRMATIONS && spanDays >= STABLE_MIN_SPAN_DAYS) {
    return { stability: "stable", confirmationCount, spanDays };
  }

  // Everything else is transient
  return { stability: "transient", confirmationCount, spanDays };
}

/**
 * Try to infer an expiry date from a fact's object text.
 * Looks for patterns like "next week", "this month", "by Friday".
 */
function inferExpiry(text: string): string | undefined {
  const lower = text.toLowerCase();
  const now = new Date();

  if (lower.includes("today")) {
    const d = new Date(now);
    d.setHours(23, 59, 59);
    return d.toISOString();
  }
  if (lower.includes("tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 59);
    return d.toISOString();
  }
  if (lower.includes("this week") || lower.includes("next week")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d.toISOString();
  }
  if (lower.includes("this month") || lower.includes("next month")) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  }
  if (lower.includes("this year") || lower.includes("next year")) {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString();
  }

  return undefined;
}

// =============================================================================
// MAIN API
// =============================================================================

/**
 * Build a dynamic user profile from facts.
 *
 * Classifies each user-related fact as stable/transient and organizes
 * them into a structured profile.
 *
 * @param facts - All facts about the user
 * @param userId - The user identifier (default: "user")
 */
export function buildDynamicProfile(facts: Fact[], userId: string = "user"): DynamicUserProfile {
  // Filter to user-relevant facts
  const userFacts = facts.filter(
    (f) =>
      f.isActive &&
      (f.subject.toLowerCase() === userId.toLowerCase() ||
        f.subject.toLowerCase() === "user" ||
        f.subject.toLowerCase() === "mus"),
  );

  const stableTraits: ProfileFact[] = [];
  const transientStates: ProfileFact[] = [];
  const preferences: ProfileFact[] = [];
  const activePlans: ProfileFact[] = [];

  for (const fact of userFacts) {
    const category = classifyCategory(fact);
    const { stability, confirmationCount, spanDays, validUntil } = classifyStability(fact);

    // Skip expired transient facts
    if (validUntil && new Date(validUntil) < new Date()) {
      continue;
    }

    const profileFact: ProfileFact = {
      fact,
      stability,
      confirmationCount,
      spanDays,
      validUntil,
      category,
    };

    switch (category) {
      case "trait":
        if (stability === "stable") {
          stableTraits.push(profileFact);
        } else {
          transientStates.push(profileFact);
        }
        break;
      case "preference":
        preferences.push(profileFact);
        break;
      case "plan":
        activePlans.push(profileFact);
        break;
      case "state":
        transientStates.push(profileFact);
        break;
    }
  }

  // Sort each category by confidence
  const byConfidence = (a: ProfileFact, b: ProfileFact) => b.fact.confidence - a.fact.confidence;
  stableTraits.sort(byConfidence);
  transientStates.sort(byConfidence);
  preferences.sort(byConfidence);
  activePlans.sort(byConfidence);

  const allProfileFacts = [...stableTraits, ...transientStates, ...preferences, ...activePlans];
  const avgConfidence =
    allProfileFacts.length > 0
      ? allProfileFacts.reduce((sum, pf) => sum + pf.fact.confidence, 0) / allProfileFacts.length
      : 0;

  log.debug("Built dynamic user profile", {
    userId,
    stable: stableTraits.length,
    transient: transientStates.length,
    preferences: preferences.length,
    plans: activePlans.length,
  });

  return {
    userId,
    stableTraits,
    transientStates,
    preferences,
    activePlans,
    stats: {
      totalFacts: allProfileFacts.length,
      stableCount: stableTraits.length,
      transientCount: transientStates.length,
      preferenceCount: preferences.length,
      planCount: activePlans.length,
      averageConfidence: avgConfidence,
    },
  };
}

/**
 * Format a dynamic profile for LLM context injection.
 *
 * Produces a concise text summary suitable for system prompts.
 */
export function formatProfileForContext(profile: DynamicUserProfile): string {
  const lines: string[] = [];

  if (profile.stableTraits.length > 0) {
    lines.push("**Stable traits:**");
    for (const pf of profile.stableTraits.slice(0, 10)) {
      lines.push(`- ${pf.fact.subject} ${pf.fact.predicate} ${pf.fact.object}`);
    }
  }

  if (profile.preferences.length > 0) {
    lines.push("**Preferences:**");
    for (const pf of profile.preferences.slice(0, 10)) {
      lines.push(`- ${pf.fact.subject} ${pf.fact.predicate} ${pf.fact.object}`);
    }
  }

  if (profile.transientStates.length > 0) {
    lines.push("**Current states:**");
    for (const pf of profile.transientStates.slice(0, 5)) {
      const expiry = pf.validUntil ? ` (until ${pf.validUntil.split("T")[0]})` : "";
      lines.push(`- ${pf.fact.subject} ${pf.fact.predicate} ${pf.fact.object}${expiry}`);
    }
  }

  if (profile.activePlans.length > 0) {
    lines.push("**Active plans:**");
    for (const pf of profile.activePlans.slice(0, 5)) {
      const expiry = pf.validUntil ? ` (by ${pf.validUntil.split("T")[0]})` : "";
      lines.push(`- ${pf.fact.subject} ${pf.fact.predicate} ${pf.fact.object}${expiry}`);
    }
  }

  return lines.join("\n");
}
