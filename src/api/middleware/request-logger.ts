/**
 * Request Logger Middleware
 *
 * Logs requests for analytics.
 */

import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { createSubsystemLogger, type SubsystemLogger } from "../../../logging/subsystem.js";

const logger = createSubsystemLogger("API");

/**
 * Request logging middleware
 */
export function requestLogger(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info("API request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      agentId: req.agentId,
      tier: req.tier,
    });
  });

  next();
}
