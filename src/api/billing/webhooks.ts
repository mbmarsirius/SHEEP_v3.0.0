/**
 * Stripe Webhook Handlers
 */

import type { Request, Response } from "express";
import express, { Router, type Router as ExpressRouter } from "express";
import { setSubscriptionActive } from "../middleware/billing-check.js";
import { StripeBilling } from "./stripe.js";

const router: ExpressRouter = Router();
const stripeBilling = new StripeBilling();

/**
 * POST /billing/webhooks/stripe
 * Stripe webhook endpoint
 */
router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"];

    if (!sig) {
      res.status(400).json({ error: "Missing signature" });
      return;
    }

    // In production, verify webhook signature:
    // const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

    try {
      // For now, parse as JSON (in production, use Stripe's webhook verification)
      const event = JSON.parse(req.body.toString());
      await stripeBilling.handleWebhook(event);

      res.json({ received: true });
    } catch (e) {
      res.status(400).json({ error: "Webhook processing failed" });
    }
  },
);

export default router;
