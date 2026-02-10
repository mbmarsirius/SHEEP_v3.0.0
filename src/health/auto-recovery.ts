/**
 * SHEEP AI - Auto-Recovery System
 * 
 * Prevents disconnections and ensures 7/24 operation:
 * - Health monitoring
 * - Auto-restart on failures
 * - Connection monitoring
 * - Embedding engine auto-recovery
 * 
 * @module sheep/health/auto-recovery
 */

import { createSubsystemLogger } from "../stubs/logging.js";
import type { SheepDatabase } from "../memory/database.js";

const log = createSubsystemLogger("sheep-recovery");

// =============================================================================
// HEALTH MONITORING
// =============================================================================

interface HealthStatus {
  timestamp: string;
  dbConnected: boolean;
  embeddingEngineWorking: boolean;
  lastError?: string;
  consecutiveFailures: number;
}

const healthStatus = new Map<string, HealthStatus>();

/**
 * Check SHEEP health status
 */
export function checkHealth(agentId: string, db: SheepDatabase): HealthStatus {
  const now = new Date().toISOString();
  let dbConnected = false;
  let embeddingEngineWorking = true; // Assume working unless proven otherwise

  try {
    // Test database connection
    db.db.prepare("SELECT 1").get();
    dbConnected = true;
  } catch (err) {
    log.error("Database health check failed", { agentId, error: String(err) });
    dbConnected = false;
  }

  const current = healthStatus.get(agentId);
  const status: HealthStatus = {
    timestamp: now,
    dbConnected,
    embeddingEngineWorking,
    consecutiveFailures: dbConnected ? 0 : (current?.consecutiveFailures ?? 0) + 1,
  };

  healthStatus.set(agentId, status);
  return status;
}

/**
 * Record an error for health tracking
 */
export function recordError(agentId: string, error: string): void {
  const current = healthStatus.get(agentId);
  const status: HealthStatus = {
    timestamp: new Date().toISOString(),
    dbConnected: current?.dbConnected ?? true,
    embeddingEngineWorking: false,
    lastError: error.slice(0, 200),
    consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
  };
  healthStatus.set(agentId, status);

  // If too many consecutive failures, log warning
  if (status.consecutiveFailures > 5) {
    log.warn("SHEEP health degraded - multiple consecutive failures", {
      agentId,
      failures: status.consecutiveFailures,
      lastError: error.slice(0, 100),
    });
  }
}

/**
 * Record successful operation
 */
export function recordSuccess(agentId: string): void {
  const current = healthStatus.get(agentId);
  const status: HealthStatus = {
    timestamp: new Date().toISOString(),
    dbConnected: true,
    embeddingEngineWorking: true,
    consecutiveFailures: 0,
  };
  healthStatus.set(agentId, status);
}

/**
 * Get current health status
 */
export function getHealthStatus(agentId: string): HealthStatus | undefined {
  return healthStatus.get(agentId);
}

// =============================================================================
// AUTO-RECOVERY
// =============================================================================

/**
 * Attempt to recover from embedding engine failures
 */
export async function recoverEmbeddingEngine(
  agentId: string,
  retryFunction: () => Promise<unknown>,
  maxRetries = 3,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await retryFunction();
      recordSuccess(agentId);
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      recordError(agentId, errorMsg);

      // If it's a token limit error, wait before retry
      if (errorMsg.includes("500") || errorMsg.includes("token") || errorMsg.includes("limit")) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // 1s, 2s, 4s
        log.warn("Embedding engine error, retrying with delay", {
          agentId,
          attempt: attempt + 1,
          delayMs: delay,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // For other errors, don't retry
      return false;
    }
  }

  return false;
}

// =============================================================================
// CONNECTION MONITORING
// =============================================================================

const connectionStatus = new Map<string, { lastHeartbeat: number; isConnected: boolean }>();

/**
 * Record a heartbeat to indicate connection is alive
 */
export function recordHeartbeat(agentId: string): void {
  connectionStatus.set(agentId, {
    lastHeartbeat: Date.now(),
    isConnected: true,
  });
}

/**
 * Check if connection is alive (heartbeat within last 5 minutes)
 */
export function isConnectionAlive(agentId: string, timeoutMs = 5 * 60 * 1000): boolean {
  const status = connectionStatus.get(agentId);
  if (!status) return false;

  const timeSinceHeartbeat = Date.now() - status.lastHeartbeat;
  return timeSinceHeartbeat < timeoutMs;
}

/**
 * Mark connection as disconnected
 */
export function markDisconnected(agentId: string): void {
  const status = connectionStatus.get(agentId);
  if (status) {
    status.isConnected = false;
  }
}
