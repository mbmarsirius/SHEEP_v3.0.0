/**
 * SHEEP Cloud - Health & Status Routes
 *
 * GET /health     -- Unauthenticated health check (healthRouter)
 * GET /v1/status  -- Authenticated memory stats (statusRouter, mounted under /v1)
 */

import { Router } from "express";
import type { AuthenticatedRequest } from "../middleware/api-key-auth.js";
import { getUserDatabase, getActiveDbCount } from "../db-manager.js";

const startedAt = new Date().toISOString();

// =============================================================================
// Public health check (mounted at app root)
// =============================================================================

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "sheep.ai",
    version: "0.3.0",
    startedAt,
    activeConnections: getActiveDbCount(),
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// Authenticated status (mounted under /v1, after auth middleware)
// =============================================================================

export const statusRouter = Router();

statusRouter.get("/status", (req: AuthenticatedRequest, res) => {
  try {
    const db = getUserDatabase(req.userId!);
    const stats = db.getStats();

    res.json({
      ok: true,
      userId: req.userId,
      tier: req.tier,
      memory: {
        episodes: stats.totalEpisodes,
        facts: stats.totalFacts,
        causalLinks: stats.totalCausalLinks,
        procedures: stats.totalProcedures,
        avgConfidence: stats.averageFactConfidence,
        lastConsolidation: stats.lastConsolidation,
      },
    });
  } catch (err) {
    console.error("[cloud/status] error:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});
