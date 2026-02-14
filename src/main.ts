#!/usr/bin/env node
/**
 * SHEEP AI - Main Entry Point (Standalone)
 *
 * Orchestrates all SHEEP systems:
 * 1. Config loading (env + ~/.sheep/config.json)
 * 2. Database initialization
 * 3. LLM providers (4-tier via claude-max-api-proxy + Gemini)
 * 4. Embedding provider (Gemini embedding-001)
 * 5. Consolidation scheduler
 * 6. Telegram bot (grammY, long polling, 24/7)
 * 7. Health API server
 *
 * Run: npx tsx src/main.ts
 * Or:  AGENT_ID=default TELEGRAM_BOT_TOKEN=xxx node dist/main.js
 */

// Load .env file before anything else (Node 22+ built-in not always available via tsx)
import fs from "node:fs";
import path from "node:path";
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

import { createSubsystemLogger } from "./stubs/logging.js";
import { loadConfig } from "./stubs/config.js";
import { SheepDatabase } from "./memory/database.js";
import { createSheepLLMProvider, type LLMProvider } from "./extraction/llm-extractor.js";
import { createEmbeddingProvider } from "./stubs/embeddings.js";
import { initializeAutoConsolidation, shutdownAutoConsolidation } from "./consolidation/scheduler.js";
import { createSheepBot } from "./telegram/bot.js";

const log = createSubsystemLogger("main");

// =============================================================================
// STARTUP
// =============================================================================

async function main(): Promise<void> {
  log.info("=== SHEEP AI v3.0.0 - Standalone ===");
  log.info("Starting up...");

  // 1. Load config
  const config = loadConfig();
  const agentId = process.env.SHEEP_AGENT_ID ?? process.env.AGENT_ID ?? "default";
  log.info("Config loaded", { agentId });

  // 2. Check required env vars
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN ?? config.telegram?.botToken;
  if (!telegramToken) {
    log.error("TELEGRAM_BOT_TOKEN not set. Cannot start bot.");
    log.error("Set it in .env or ~/.sheep/config.json");
    process.exit(1);
  }

  // 3. Check Claude Max API Proxy
  const proxyUrl = process.env.CLAUDE_PROXY_URL ?? "http://localhost:3456/v1";
  try {
    const healthCheck = await fetch(`${proxyUrl.replace("/v1", "")}/health`);
    if (healthCheck.ok) {
      log.info("Claude Max API Proxy: ONLINE", { url: proxyUrl });
    } else {
      log.warn("Claude Max API Proxy: responded but unhealthy. Will try anyway.");
    }
  } catch {
    log.warn("Claude Max API Proxy: OFFLINE. Will use Anthropic API fallback if ANTHROPIC_API_KEY is set.");
    if (!process.env.ANTHROPIC_API_KEY) {
      log.warn("No ANTHROPIC_API_KEY either. LLM calls will fall back to mock provider.");
    }
  }

  // 4. Initialize database
  const db = new SheepDatabase(agentId);
  const stats = db.getStats();
  log.info("Database initialized", {
    episodes: stats.totalEpisodes,
    facts: stats.totalFacts,
    causalLinks: stats.totalCausalLinks,
    procedures: stats.totalProcedures,
  });

  // 5. Initialize embedding provider
  try {
    const embedResult = await createEmbeddingProvider();
    log.info("Embedding provider ready", { source: embedResult.source, dimensions: embedResult.provider.dimensions });
  } catch (err) {
    log.warn("Embedding provider failed to initialize", { error: String(err) });
  }

  // 6. Initialize LLM providers (4-tier)
  let brainLLM: LLMProvider;
  let muscleLLM: LLMProvider;

  try {
    brainLLM = await createSheepLLMProvider("brain");
    log.info("BRAIN LLM ready", { name: brainLLM.name });
  } catch (err) {
    log.error("Failed to create BRAIN LLM", { error: String(err) });
    const { createMockLLMProvider } = await import("./extraction/llm-extractor.js");
    brainLLM = createMockLLMProvider();
  }

  try {
    muscleLLM = await createSheepLLMProvider("muscle");
    log.info("MUSCLE LLM ready", { name: muscleLLM.name });
  } catch (err) {
    log.error("Failed to create MUSCLE LLM", { error: String(err) });
    const { createMockLLMProvider } = await import("./extraction/llm-extractor.js");
    muscleLLM = createMockLLMProvider();
  }

  // 7. Start consolidation scheduler
  try {
    initializeAutoConsolidation(agentId, config);
    log.info("Consolidation scheduler started");
  } catch (err) {
    log.warn("Failed to start consolidation scheduler", { error: String(err) });
  }

  // 8. Create and start Telegram bot (always uses Opus 4.6 / brain)
  const bot = createSheepBot({
    token: telegramToken,
    agentId,
    db,
    brainLLM,
    muscleLLM,
  });

  // Prevent crash on transient errors (network, Telegram API, etc.)
  bot.catch((err) => {
    log.error("Telegram bot error", { error: String(err.error) });
    // Don't call bot.stop() — keep running for transient network errors
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down SHEEP AI...");
    bot.stop();
    shutdownAutoConsolidation();
    log.info("SHEEP AI stopped.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start long polling
  log.info("Starting Telegram bot (long polling)...");
  log.info("=== SHEEP AI is LIVE ===");
  log.info(`Talk to your bot on Telegram!`);

  await bot.start({
    onStart: (botInfo) => {
      log.info(`Bot started as @${botInfo.username}`);
    },
  });
}

// =============================================================================
// RUN
// =============================================================================

main().catch((err) => {
  console.error("Fatal error starting SHEEP AI:", err);
  process.exit(1);
});
