/**
 * Stripe Billing Integration (stub)
 *
 * Stripe is an optional dependency. This module provides the interface
 * but requires the `stripe` npm package to be installed for real usage.
 */

export const PRICES = {
  pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? "",
  pro_yearly: process.env.STRIPE_PRICE_PRO_YEARLY ?? "",
  enterprise_monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ?? "",
  enterprise_yearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY ?? "",
};

export class StripeBilling {
  async createCheckout(
    _agentId: string,
    _tier: "pro" | "enterprise",
    _interval: "monthly" | "yearly",
    _successUrl: string,
    _cancelUrl: string,
  ): Promise<string> {
    throw new Error("Stripe not configured. Install 'stripe' package and set STRIPE_SECRET_KEY");
  }

  async handleWebhook(_event: {
    type: string;
    data: { object: Record<string, unknown> };
  }): Promise<void> {
    // No-op without Stripe
  }
}
