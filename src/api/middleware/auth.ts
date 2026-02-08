/**
 * Authentication Middleware
 *
 * Supports Moltbook Bearer tokens and API keys.
 */

import type { Request, Response, NextFunction } from "express";
import { MoltbookClient } from "../../federation/moltbook/client.js";

export interface AuthenticatedRequest extends Request {
  agentId?: string;
  tier?: "free" | "pro" | "enterprise";
  sheep?: {
    discovery: any;
    anonymizer: any;
    patternStore: any;
  };
}

export interface AuthConfig {
  moltbookClient?: MoltbookClient;
  apiKeys?: Map<string, { agentId: string; tier: "free" | "pro" | "enterprise" }>;
}

let authConfig: AuthConfig = {};

export function configureAuth(config: AuthConfig): void {
  authConfig = config;
}

/**
 * Authentication middleware
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: "Missing authorization header" });
    return;
  }

  // Check for Bearer token (Moltbook)
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);

    if (authConfig.moltbookClient) {
      try {
        // Verify token and get agent info
        const agent = await authConfig.moltbookClient.getSelf();
        req.agentId = agent.id;
        req.tier = "free"; // Default, would be looked up from database
        return next();
      } catch (e) {
        res.status(401).json({ error: "Invalid Moltbook token" });
        return;
      }
    }
  }

  // Check for API key
  if (authConfig.apiKeys) {
    const apiKey = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;

    const keyInfo = authConfig.apiKeys.get(apiKey);
    if (keyInfo) {
      req.agentId = keyInfo.agentId;
      req.tier = keyInfo.tier;
      return next();
    }
  }

  res.status(401).json({ error: "Invalid credentials" });
}
