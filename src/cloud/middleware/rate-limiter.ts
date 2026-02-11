/**
 * SHEEP Cloud - Per-Key Rate Limiter
 *
 * In-memory sliding window rate limiter.
 * Limits are per API key, based on subscription tier.
 */

import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./api-key-auth.js";
import type { LicenseTier } from "../../license/index.js";

// =============================================================================
// CONFIG
// =============================================================================

const RATE_LIMITS: Record<LicenseTier, number> = {
  free: 10,       // 10 requests/min
  personal: 60,   // 60 requests/min
  pro: 300,       // 300 requests/min
  team: 1000,     // 1000 requests/min
};

const WINDOW_MS = 60_000; // 1 minute

// =============================================================================
// STATE
// =============================================================================

interface RateEntry {
  timestamps: number[];
}

const buckets = new Map<string, RateEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [key, entry] of buckets) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) buckets.delete(key);
  }
}, 300_000);

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Rate limiting middleware. Must run after apiKeyAuth.
 */
export function rateLimiter(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const key = req.apiKey ?? req.ip ?? "unknown";
  const tier = req.tier ?? "free";
  const limit = RATE_LIMITS[tier] ?? RATE_LIMITS.free;
  const now = Date.now();

  let entry = buckets.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    buckets.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > now - WINDOW_MS);

  if (entry.timestamps.length >= limit) {
    const retryAfter = Math.ceil((entry.timestamps[0] + WINDOW_MS - now) / 1000);
    res.status(429).json({
      error: "rate_limited",
      message: `Rate limit exceeded (${limit} req/min for ${tier} tier). Retry after ${retryAfter}s.`,
      retryAfterSeconds: retryAfter,
      limit,
      tier,
    });
    return;
  }

  entry.timestamps.push(now);

  // Set rate limit headers
  res.setHeader("X-RateLimit-Limit", limit);
  res.setHeader("X-RateLimit-Remaining", limit - entry.timestamps.length);
  res.setHeader("X-RateLimit-Reset", Math.ceil((now + WINDOW_MS) / 1000));

  next();
}
