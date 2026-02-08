/**
 * Billing Check Middleware
 *
 * Verifies subscription is active for Pro/Enterprise endpoints.
 */

import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";

// In production, this would check a database
const activeSubscriptions = new Map<string, { tier: "pro" | "enterprise"; expiresAt: number }>();

export function setSubscriptionActive(
  agentId: string,
  tier: "pro" | "enterprise",
  expiresAt: number,
): void {
  activeSubscriptions.set(agentId, { tier, expiresAt });
}

export function isSubscriptionActive(agentId: string): boolean {
  const sub = activeSubscriptions.get(agentId);
  if (!sub) return false;
  return sub.expiresAt > Date.now();
}

/**
 * Require specific tier(s)
 */
export function requireTier(...allowedTiers: ("pro" | "enterprise")[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const tier = req.tier;

    if (!tier || !allowedTiers.includes(tier as "pro" | "enterprise")) {
      res.status(403).json({
        error: "Tier required",
        required: allowedTiers,
        current: tier ?? "free",
      });
      return;
    }

    // Check subscription is active (tier is guaranteed to be pro or enterprise here)
    const requiredTier = tier as "pro" | "enterprise";
    if (req.agentId) {
      if (!isSubscriptionActive(req.agentId)) {
        res.status(402).json({
          error: "Subscription required",
          tier: requiredTier,
        });
        return;
      }
    }

    next();
  };
}
