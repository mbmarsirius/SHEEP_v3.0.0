/**
 * Tier Definitions
 */

export interface TierLimits {
  name: string;
  maxRequestsPerMinute: number;
  maxTemplatesPerDay: number;
  canContribute: boolean;
  canUseP2P: boolean;
  priceMonthly?: number;
  priceYearly?: number;
}

export const TIERS: Record<"free" | "pro" | "enterprise", TierLimits> = {
  free: {
    name: "Free",
    maxRequestsPerMinute: 100,
    maxTemplatesPerDay: 10,
    canContribute: false,
    canUseP2P: false,
  },
  pro: {
    name: "Pro",
    maxRequestsPerMinute: 1000,
    maxTemplatesPerDay: 100,
    canContribute: true,
    canUseP2P: true,
    priceMonthly: 19,
    priceYearly: 190,
  },
  enterprise: {
    name: "Enterprise",
    maxRequestsPerMinute: 10000,
    maxTemplatesPerDay: -1, // Unlimited
    canContribute: true,
    canUseP2P: true,
    priceMonthly: 99,
    priceYearly: 990,
  },
};

export function getTierLimits(tier: "free" | "pro" | "enterprise"): TierLimits {
  return TIERS[tier];
}
