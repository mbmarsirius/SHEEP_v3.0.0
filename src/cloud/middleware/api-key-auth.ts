/**
 * SHEEP Cloud - API Key Authentication Middleware
 *
 * MVP: Keys loaded from SHEEP_API_KEYS env var (JSON).
 * Format: { "sk-sheep-abc123": { "userId": "user1", "tier": "personal" } }
 *
 * Later: PostgreSQL key table with hashed keys.
 */

import type { Request, Response, NextFunction } from "express";
import type { LicenseTier } from "../../license/index.js";

// =============================================================================
// TYPES
// =============================================================================

export interface AuthenticatedRequest extends Request {
  userId?: string;
  tier?: LicenseTier;
  apiKey?: string;
}

interface ApiKeyEntry {
  userId: string;
  tier: LicenseTier;
}

// =============================================================================
// KEY STORE
// =============================================================================

let keyStore: Map<string, ApiKeyEntry> = new Map();

/**
 * Load API keys from SHEEP_API_KEYS environment variable.
 * Call once at startup.
 */
export function loadApiKeys(): void {
  const raw = process.env.SHEEP_API_KEYS;
  if (!raw) {
    console.warn("[cloud/auth] SHEEP_API_KEYS not set. No API keys loaded. Only /health will work.");
    return;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, ApiKeyEntry>;
    keyStore = new Map(Object.entries(parsed));
    console.log(`[cloud/auth] Loaded ${keyStore.size} API key(s)`);
  } catch (err) {
    console.error(`[cloud/auth] Failed to parse SHEEP_API_KEYS: ${err}`);
  }
}

/**
 * Programmatically add an API key (for testing or dynamic registration).
 */
export function addApiKey(key: string, entry: ApiKeyEntry): void {
  keyStore.set(key, entry);
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Express middleware that validates the API key from the Authorization header.
 *
 * Sets req.userId, req.tier, req.apiKey on success.
 * Returns 401 on missing/invalid key.
 */
export function apiKeyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: "missing_auth",
      message: "Authorization header required. Use: Authorization: Bearer sk-sheep-...",
    });
    return;
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  const entry = keyStore.get(token);
  if (!entry) {
    res.status(401).json({
      error: "invalid_key",
      message: "Invalid API key. Get one at https://sheep.ai",
    });
    return;
  }

  req.userId = entry.userId;
  req.tier = entry.tier;
  req.apiKey = token;
  next();
}
