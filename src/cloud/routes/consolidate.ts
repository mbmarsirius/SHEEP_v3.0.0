/**
 * SHEEP Cloud - Consolidation Route
 *
 * POST /v1/consolidate -- Trigger sleep consolidation cycle
 * Requires personal+ tier (sleep_consolidation feature).
 */

import { Router } from "express";
import type { AuthenticatedRequest } from "../middleware/api-key-auth.js";
import { requireTier } from "../middleware/tier-gate.js";
import { getUserDatabase } from "../db-manager.js";

const router = Router();

// =============================================================================
// POST /v1/consolidate
// =============================================================================

router.post(
  "/consolidate",
  requireTier("sleep_consolidation"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const db = getUserDatabase(req.userId!);

      // Import consolidation module dynamically (it's a heavy module)
      const { runConsolidation } = await import("../../consolidation/consolidator.js");

      const result = await runConsolidation({
        agentId: req.userId!,
        useLLMExtraction: true,
        enableLLMSleep: true,
      });

      res.json({
        ok: true,
        result: {
          sessionsProcessed: result.sessionsProcessed,
          episodesExtracted: result.episodesExtracted,
          factsExtracted: result.factsExtracted,
          causalLinksExtracted: result.causalLinksExtracted,
          proceduresExtracted: result.proceduresExtracted,
          memoriesPruned: result.memoriesPruned,
          durationMs: result.durationMs,
        },
      });
    } catch (err) {
      console.error("[cloud/consolidate] error:", err);
      res.status(500).json({ error: "internal", message: String(err) });
    }
  },
);

export default router;
