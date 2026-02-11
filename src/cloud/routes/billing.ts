/**
 * SHEEP Cloud - Billing Routes (Stripe Checkout)
 *
 * POST /v1/billing/checkout  -- Create a Stripe Checkout session
 * GET  /v1/billing/prices    -- List available pricing tiers
 *
 * For now, tier upgrades are manual (you verify payment in Stripe dashboard
 * and update SHEEP_API_KEYS on Railway). Webhooks come in a later phase.
 */

import Stripe from "stripe";
import { Router, type Router as IRouter } from "express";
import type { AuthenticatedRequest } from "../middleware/api-key-auth.js";

const router: IRouter = Router();

// =============================================================================
// STRIPE SETUP
// =============================================================================

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

// Product price IDs (set via env vars after creating products in Stripe)
function getPriceIds() {
  return {
    personal_monthly: process.env.STRIPE_PRICE_PERSONAL_MONTHLY ?? "",
    personal_yearly: process.env.STRIPE_PRICE_PERSONAL_YEARLY ?? "",
    pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? "",
    pro_yearly: process.env.STRIPE_PRICE_PRO_YEARLY ?? "",
    team_monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY ?? "",
    team_yearly: process.env.STRIPE_PRICE_TEAM_YEARLY ?? "",
  };
}

// =============================================================================
// GET /v1/billing/prices -- Public pricing info
// =============================================================================

router.get("/billing/prices", (_req, res) => {
  res.json({
    ok: true,
    tiers: [
      {
        id: "free",
        name: "Free",
        price: 0,
        features: ["Basic recall", "Keyword search", "Manual store", "Basic episodes"],
      },
      {
        id: "personal",
        name: "Personal",
        price: 9,
        interval: "month",
        features: [
          "Everything in Free",
          "Sleep consolidation",
          "Causal reasoning",
          "Foresight signals",
          "Hybrid search",
          "Active forgetting",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: 19,
        interval: "month",
        features: [
          "Everything in Personal",
          "Multi-agent support",
          "Full API access",
          "Priority processing",
          "Advanced analytics",
          "Agentic retrieval",
        ],
      },
      {
        id: "team",
        name: "Team",
        price: 49,
        interval: "month",
        perSeat: true,
        features: [
          "Everything in Pro",
          "Federation",
          "Shared memory",
          "Admin dashboard",
          "HIPAA BAA",
        ],
      },
    ],
  });
});

// =============================================================================
// POST /v1/billing/checkout -- Create Stripe Checkout session
// =============================================================================

router.post("/billing/checkout", async (req: AuthenticatedRequest, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      res.status(503).json({
        error: "billing_unavailable",
        message: "Billing is not configured. Contact mb@marsirius.ai for API keys.",
      });
      return;
    }

    const { tier, interval } = req.body;
    const billingInterval = interval === "yearly" ? "yearly" : "monthly";

    // Map tier + interval to a Stripe Price ID
    const prices = getPriceIds();
    const priceKey = `${tier}_${billingInterval}` as keyof ReturnType<typeof getPriceIds>;
    const priceId = prices[priceKey];

    if (!priceId) {
      res.status(400).json({
        error: "invalid_tier",
        message: `No price configured for ${tier} (${billingInterval}). Available: personal, pro, team.`,
      });
      return;
    }

    const successUrl = (req.body.successUrl as string) ?? "https://sheep.ai/welcome?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl = (req.body.cancelUrl as string) ?? "https://sheep.ai/pricing";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: req.userId ?? "unknown",
        tier,
        interval: billingInterval,
      },
    });

    res.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error("[cloud/billing] checkout error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "checkout_failed", message: msg });
  }
});

export default router;
