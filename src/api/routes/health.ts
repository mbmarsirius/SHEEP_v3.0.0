/**
 * Health Check Route
 * Step 5: Enhanced with introspection (memory stats)
 */

import { Router, type Router as ExpressRouter } from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getHealthStatus, isConnectionAlive } from "../../health/auto-recovery.js";
import { loadConfig } from "../../stubs/config.js";
import { SheepDatabase } from "../../memory/database.js";

const router: ExpressRouter = Router();

// Resolve agent ID (works standalone or in Moltbot)
function getAgentId(): string {
  return process.env.AGENT_ID ?? loadConfig()?.agents?.list?.[0]?.id ?? "default";
}

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, "../../../package.json");
let SHEEP_VERSION = "0.3.0"; // Default fallback

try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  SHEEP_VERSION = packageJson.version || SHEEP_VERSION;
} catch {
  // Fallback to default
}

/**
 * GET /health
 * Health check endpoint with SHEEP status
 */
router.get("/", (_req, res) => {
  const agentId = getAgentId();
  const healthStatus = getHealthStatus(agentId);
  const connectionAlive = isConnectionAlive(agentId);

  // Check database health
  let dbHealth = "unknown";
  try {
    const db = new SheepDatabase(agentId);
    db.db.prepare("SELECT 1").get();
    dbHealth = "healthy";
    db.close();
  } catch {
    dbHealth = "unhealthy";
  }

  res.json({
    status: connectionAlive && dbHealth === "healthy" ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: SHEEP_VERSION,
    name: "SHEEP AI",
    description: "Sleep-based Hierarchical Emergent Entity Protocol - Cognitive Memory System",
    health: {
      connection: connectionAlive ? "alive" : "disconnected",
      database: dbHealth,
      embeddingEngine: healthStatus?.embeddingEngineWorking ? "working" : "degraded",
      consecutiveFailures: healthStatus?.consecutiveFailures ?? 0,
      lastError: healthStatus?.lastError,
    },
    autonomous: true, // Always autonomous mode
    uptime: "7/24", // Always available
  });
});

/**
 * GET /health/status - Step 5: Introspection endpoint
 * Returns detailed memory stats for verification
 */
router.get("/status", (_req, res) => {
  const agentId = getAgentId();

  try {
    const db = new SheepDatabase(agentId);
    const stats = db.getMemoryStats();
    const sampleFacts = db.findFacts({ activeOnly: true, limit: 5 });
    const sampleEpisodes = db.queryEpisodes({ limit: 3 });
    db.close();

    res.json({
      agentId,
      timestamp: new Date().toISOString(),
      version: SHEEP_VERSION,
      memory: {
        totalEpisodes: stats.totalEpisodes,
        totalFacts: stats.totalFacts,
        totalCausalLinks: stats.totalCausalLinks,
        totalProcedures: stats.totalProcedures,
        averageFactConfidence: stats.averageFactConfidence,
        lastConsolidation: stats.lastConsolidation,
        oldestMemory: stats.oldestMemory,
        newestMemory: stats.newestMemory,
      },
      sampleFacts: sampleFacts.map((f) => ({
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        confidence: f.confidence,
      })),
      sampleEpisodes: sampleEpisodes.map((e) => ({
        id: e.id,
        topic: e.topic,
        summary: e.summary?.slice(0, 100) + (e.summary && e.summary.length > 100 ? "..." : ""),
      })),
    });
  } catch (err) {
    res.status(500).json({
      error: String(err),
      agentId,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
