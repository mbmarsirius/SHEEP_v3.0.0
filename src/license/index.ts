/**
 * SHEEP AI - License Key Validation & Feature Gating
 *
 * Controls which features are available based on subscription tier.
 * Phase 1: Offline JWT validation (signed tokens)
 * Phase 2: Online validation via sheep.ai API
 *
 * (c) 2026 Marsirius AI Labs. All rights reserved.
 */

import crypto from "node:crypto";
import { createSubsystemLogger } from "../stubs/logging.js";

const log = createSubsystemLogger("license");

// =============================================================================
// TYPES
// =============================================================================

export type LicenseTier = "free" | "personal" | "pro" | "team";

export type BrainFeature =
  // Free tier (no key needed)
  | "basic_recall"
  | "keyword_search"
  | "manual_store"
  | "basic_episodes"
  // Personal tier ($9/mo)
  | "sleep_consolidation"
  | "causal_reasoning"
  | "foresight"
  | "hybrid_search"
  | "profile_discrimination"
  | "active_forgetting"
  // Pro tier ($19/mo)
  | "multi_agent"
  | "api_access"
  | "priority_processing"
  | "advanced_analytics"
  | "agentic_retrieval"
  // Team tier ($49/seat/mo)
  | "federation"
  | "shared_memory"
  | "admin_dashboard"
  | "hipaa_baa";

export type LicenseInfo = {
  tier: LicenseTier;
  userId: string;
  email?: string;
  features: BrainFeature[];
  expiresAt: string;
  isValid: boolean;
};

// =============================================================================
// FEATURE MAPPING
// =============================================================================

const TIER_FEATURES: Record<LicenseTier, BrainFeature[]> = {
  free: [
    "basic_recall",
    "keyword_search",
    "manual_store",
    "basic_episodes",
  ],
  personal: [
    // Includes all free features
    "basic_recall", "keyword_search", "manual_store", "basic_episodes",
    // Plus:
    "sleep_consolidation",
    "causal_reasoning",
    "foresight",
    "hybrid_search",
    "profile_discrimination",
    "active_forgetting",
  ],
  pro: [
    // Includes all personal features
    "basic_recall", "keyword_search", "manual_store", "basic_episodes",
    "sleep_consolidation", "causal_reasoning", "foresight", "hybrid_search",
    "profile_discrimination", "active_forgetting",
    // Plus:
    "multi_agent",
    "api_access",
    "priority_processing",
    "advanced_analytics",
    "agentic_retrieval",
  ],
  team: [
    // Includes all pro features
    "basic_recall", "keyword_search", "manual_store", "basic_episodes",
    "sleep_consolidation", "causal_reasoning", "foresight", "hybrid_search",
    "profile_discrimination", "active_forgetting",
    "multi_agent", "api_access", "priority_processing", "advanced_analytics",
    "agentic_retrieval",
    // Plus:
    "federation",
    "shared_memory",
    "admin_dashboard",
    "hipaa_baa",
  ],
};

// =============================================================================
// VALIDATION
// =============================================================================

/** The current license (cached after first validation) */
let _currentLicense: LicenseInfo | null = null;

/**
 * Validate a license key.
 * Phase 1: Offline validation using signed JWT-like tokens.
 * Phase 2: Online validation via sheep.ai API.
 */
export async function validateLicense(key?: string): Promise<LicenseInfo> {
  // If no key provided, check env
  const licenseKey = key ?? process.env.SHEEP_LICENSE_KEY;

  if (!licenseKey) {
    // No key = free tier (fully functional for basic features)
    const freeLicense: LicenseInfo = {
      tier: "free",
      userId: "local",
      features: TIER_FEATURES.free,
      expiresAt: "2099-12-31",
      isValid: true,
    };
    _currentLicense = freeLicense;
    log.info("No license key - running in free tier");
    return freeLicense;
  }

  // Phase 1: Decode the key (format: tier.userId.expiry.signature)
  try {
    const parts = licenseKey.split(".");
    if (parts.length < 4) {
      throw new Error("Invalid key format");
    }

    const [tierStr, userId, expiryB64, signature] = parts;
    const tier = tierStr as LicenseTier;
    const expiresAt = Buffer.from(expiryB64, "base64").toString("utf-8");

    // Check tier is valid
    if (!TIER_FEATURES[tier]) {
      throw new Error(`Unknown tier: ${tier}`);
    }

    // Check expiry
    if (new Date(expiresAt) < new Date()) {
      throw new Error("License expired");
    }

    // Phase 1: Accept any well-formed key (signature verification in Phase 2)
    // In production, we'll verify against sheep.ai signing key
    const license: LicenseInfo = {
      tier,
      userId,
      features: TIER_FEATURES[tier],
      expiresAt,
      isValid: true,
    };

    _currentLicense = license;
    log.info("License validated", { tier, userId, features: license.features.length });
    return license;
  } catch (err) {
    log.warn("License validation failed", { error: String(err) });
    // Fall back to free tier
    const freeLicense: LicenseInfo = {
      tier: "free",
      userId: "local",
      features: TIER_FEATURES.free,
      expiresAt: "2099-12-31",
      isValid: true,
    };
    _currentLicense = freeLicense;
    return freeLicense;
  }
}

/**
 * Check if a specific feature is enabled for the current license.
 */
export function isFeatureEnabled(feature: BrainFeature): boolean {
  if (!_currentLicense) {
    // Not yet validated -- only free features available
    return TIER_FEATURES.free.includes(feature);
  }
  return _currentLicense.features.includes(feature);
}

/**
 * Get the current license info.
 */
export function getCurrentLicense(): LicenseInfo | null {
  return _currentLicense;
}

/**
 * Guard a function call with a feature check.
 * Throws if the feature is not enabled.
 */
export function requireFeature(feature: BrainFeature): void {
  if (!isFeatureEnabled(feature)) {
    const tier = _currentLicense?.tier ?? "free";
    const requiredTier = getRequiredTier(feature);
    throw new Error(
      `Feature "${feature}" requires ${requiredTier} tier (current: ${tier}). ` +
      `Upgrade at https://sheep.ai/pricing`,
    );
  }
}

/**
 * Get the minimum tier required for a feature.
 */
function getRequiredTier(feature: BrainFeature): LicenseTier {
  for (const tier of ["free", "personal", "pro", "team"] as LicenseTier[]) {
    if (TIER_FEATURES[tier].includes(feature)) return tier;
  }
  return "team";
}

/**
 * Generate a development/testing license key.
 * Only for internal use during development.
 */
export function generateDevLicense(tier: LicenseTier = "pro", daysValid: number = 30): string {
  const userId = "dev-" + crypto.randomBytes(4).toString("hex");
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + daysValid);
  const expiryB64 = Buffer.from(expiry.toISOString()).toString("base64");
  const signature = crypto.randomBytes(16).toString("hex"); // placeholder
  return `${tier}.${userId}.${expiryB64}.${signature}`;
}

// =============================================================================
// CODE MANIFEST: What's open source vs proprietary
// =============================================================================

/**
 * Manifest defining which modules are open source vs proprietary.
 * This is the commercial boundary of SHEEP AI.
 */
export const CODE_MANIFEST = {
  openSource: {
    description: "Published on GitHub, MIT license, builds trust",
    modules: [
      "src/memory/schema.ts",        // Types and interfaces
      "src/memory/database.ts",       // SQLite CRUD (basic storage)
      "src/privacy/*",                // ALL privacy modules
      "src/stubs/*",                  // Configuration, logging
      "src/tools/memory-tools.ts",    // MCP tool definitions
      "src/prefetch/prefetch-engine.ts", // Basic intent classification
    ],
  },
  proprietary: {
    description: "Never published as source. The secret sauce.",
    modules: [
      "src/consolidation/*",          // Sleep consolidation engine
      "src/causal/*",                 // Causal reasoning
      "src/extraction/foresight-extractor.ts",  // Foresight extraction
      "src/extraction/llm-extractor.ts",        // LLM-powered extraction
      "src/extraction/profile-discriminator.ts", // Profile discrimination
      "src/extraction/online-synthesis.ts",      // Fact synthesis
      "src/consolidation/llm-sleep.ts",          // LLM sleep consolidation
      "src/consolidation/forgetting.ts",         // Active forgetting
      "src/retrieval/agentic-retrieval.ts",      // Multi-round retrieval
      "src/retrieval/multihop-chain.ts",         // Multi-hop causal chains
      "src/federation/*",                        // Federation protocol
      "src/license/*",                           // License validation
    ],
  },
} as const;
