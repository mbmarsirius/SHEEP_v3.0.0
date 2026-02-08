/**
 * Tier-based Rate Limiting
 */

import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";

export interface RateLimitConfig {
  free: { requests: number; windowMs: number };
  pro: { requests: number; windowMs: number };
  enterprise: { requests: number; windowMs: number };
}

const DEFAULT_CONFIG: RateLimitConfig = {
  free: { requests: 100, windowMs: 60 * 1000 }, // 100/min
  pro: { requests: 1000, windowMs: 60 * 1000 }, // 1000/min
  enterprise: { requests: 10000, windowMs: 60 * 1000 }, // 10000/min
};

interface RateLimitState {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitState>();

/**
 * Rate limiter middleware factory
 */
export function rateLimiter(endpoint?: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const tier = req.tier ?? "free";
    const agentId = req.agentId ?? "anonymous";
    const key = `${agentId}:${endpoint ?? "default"}`;

    const config = DEFAULT_CONFIG[tier];
    const now = Date.now();

    let state = rateLimitStore.get(key);

    // Reset if window expired
    if (!state || state.resetAt < now) {
      state = {
        count: 0,
        resetAt: now + config.windowMs,
      };
    }

    state.count++;
    rateLimitStore.set(key, state);

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", String(config.requests));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, config.requests - state.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(state.resetAt / 1000)));

    if (state.count > config.requests) {
      res.status(429).json({
        error: "Rate limit exceeded",
        retryAfter: Math.ceil((state.resetAt - now) / 1000),
      });
      return;
    }

    next();
  };
}
