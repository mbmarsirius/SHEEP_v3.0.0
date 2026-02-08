/**
 * Health Check Route
 */

import { Router, type Router as ExpressRouter } from "express";

const router: ExpressRouter = Router();

/**
 * GET /health
 * Health check endpoint
 */
router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0",
  });
});

export default router;
