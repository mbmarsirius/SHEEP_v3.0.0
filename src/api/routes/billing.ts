/**
 * Billing API Routes
 */

import type { Response } from "express";
import { Router, type Router as ExpressRouter } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticate } from "../middleware/index.js";

const router: ExpressRouter = Router();

/**
 * POST /billing/checkout
 * Create checkout session
 */
router.post("/checkout", authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { tier, interval } = req.body;

  // In production, would use StripeBilling.createCheckout
  res.json({
    checkoutUrl: `https://checkout.stripe.com/placeholder?tier=${tier}&interval=${interval}`,
  });
});

/**
 * GET /billing/subscription
 * Get subscription status
 */
router.get("/subscription", authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const tier = req.tier ?? "free";

  res.json({
    tier,
    status: tier === "free" ? "active" : "active",
  });
});

export default router;
