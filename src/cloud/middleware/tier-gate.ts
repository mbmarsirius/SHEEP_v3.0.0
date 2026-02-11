/**
 * SHEEP Cloud - Tier-Based Feature Gating Middleware
 *
 * Uses the existing license/index.ts TIER_FEATURES mapping to gate
 * endpoints based on the authenticated user's subscription tier.
 */

import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./api-key-auth.js";
import type { LicenseTier, BrainFeature } from "../../license/index.js";

// =============================================================================
// TIER FEATURES (mirrors src/license/index.ts but inlined for cloud)
// =============================================================================

const TIER_FEATURES: Record<LicenseTier, Set<BrainFeature>> = {
  free: new Set([
    "basic_recall",
    "keyword_search",
    "manual_store",
    "basic_episodes",
  ]),
  personal: new Set([
    "basic_recall", "keyword_search", "manual_store", "basic_episodes",
    "sleep_consolidation", "causal_reasoning", "foresight",
    "hybrid_search", "profile_discrimination", "active_forgetting",
  ]),
  pro: new Set([
    "basic_recall", "keyword_search", "manual_store", "basic_episodes",
    "sleep_consolidation", "causal_reasoning", "foresight",
    "hybrid_search", "profile_discrimination", "active_forgetting",
    "multi_agent", "api_access", "priority_processing",
    "advanced_analytics", "agentic_retrieval",
  ]),
  team: new Set([
    "basic_recall", "keyword_search", "manual_store", "basic_episodes",
    "sleep_consolidation", "causal_reasoning", "foresight",
    "hybrid_search", "profile_discrimination", "active_forgetting",
    "multi_agent", "api_access", "priority_processing",
    "advanced_analytics", "agentic_retrieval",
    "federation", "shared_memory", "admin_dashboard", "hipaa_baa",
  ]),
};

function getMinTier(feature: BrainFeature): LicenseTier {
  for (const tier of ["free", "personal", "pro", "team"] as LicenseTier[]) {
    if (TIER_FEATURES[tier].has(feature)) return tier;
  }
  return "team";
}

// =============================================================================
// MIDDLEWARE FACTORY
// =============================================================================

/**
 * Create middleware that requires a specific feature.
 * Returns 403 with upgrade URL if the user's tier doesn't include the feature.
 *
 * Usage:
 *   router.post("/consolidate", requireTier("sleep_consolidation"), handler);
 */
export function requireTier(feature: BrainFeature) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const tier = req.tier ?? "free";
    const features = TIER_FEATURES[tier];

    if (!features || !features.has(feature)) {
      const requiredTier = getMinTier(feature);
      res.status(403).json({
        error: "feature_locked",
        message: `"${feature}" requires the ${requiredTier} tier (you are on ${tier}).`,
        requiredTier,
        currentTier: tier,
        upgradeUrl: "https://sheep.ai/pricing",
      });
      return;
    }

    next();
  };
}
