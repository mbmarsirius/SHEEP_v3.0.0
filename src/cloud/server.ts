#!/usr/bin/env node
/**
 * SHEEP Cloud Server - The Proprietary Brain
 *
 * Express API that exposes SHEEP's cognitive memory as a REST service.
 * Designed for Railway deployment.
 *
 * Endpoints:
 *   GET  /health          -- Public health check
 *   POST /v1/remember     -- Store a fact
 *   POST /v1/recall       -- Search memory
 *   POST /v1/why          -- Causal reasoning (personal+)
 *   GET  /v1/facts        -- List facts
 *   POST /v1/forget       -- Forget facts
 *   POST /v1/consolidate  -- Sleep consolidation (personal+)
 *   GET  /v1/status       -- Memory stats
 *
 * Auth: API key via Authorization: Bearer sk-sheep-...
 * Rate limiting: Per-key, per-tier
 *
 * Run locally:  npx tsx src/cloud/server.ts
 * Run prod:     node dist/cloud/server.js
 */

import express from "express";
import { loadApiKeys, apiKeyAuth } from "./middleware/api-key-auth.js";
import { rateLimiter } from "./middleware/rate-limiter.js";
import memoryRoutes from "./routes/memory.js";
import consolidateRoutes from "./routes/consolidate.js";
import { healthRouter, statusRouter } from "./routes/health.js";

// =============================================================================
// BOOTSTRAP
// =============================================================================

const app = express();
const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Load API keys from environment
loadApiKeys();

// =============================================================================
// GLOBAL MIDDLEWARE
// =============================================================================

// JSON body parsing
app.use(express.json({ limit: "1mb" }));

// CORS -- allow all origins for API access (clients are server-side or MCP)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// Request logging
app.use((req, _res, next) => {
  const start = Date.now();
  _res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[cloud] ${req.method} ${req.path} ${_res.statusCode} ${duration}ms`,
    );
  });
  next();
});

// =============================================================================
// PUBLIC ROUTES (no auth)
// =============================================================================

app.use(healthRouter);

// =============================================================================
// AUTHENTICATED ROUTES
// =============================================================================

// All /v1/* routes require API key auth + rate limiting
app.use("/v1", apiKeyAuth as express.RequestHandler, rateLimiter as express.RequestHandler);

// Memory operations
app.use("/v1", memoryRoutes);

// Consolidation
app.use("/v1", consolidateRoutes);

// Status (authenticated, under /v1)
app.use("/v1", statusRouter);

// =============================================================================
// 404 HANDLER
// =============================================================================

app.use((_req, res) => {
  res.status(404).json({
    error: "not_found",
    message: `No route for ${_req.method} ${_req.path}`,
    docs: "https://sheep.ai/docs",
  });
});

// =============================================================================
// ERROR HANDLER
// =============================================================================

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[cloud] Unhandled error:", err);
  res.status(500).json({
    error: "internal",
    message: process.env.NODE_ENV === "production" ? "Internal server error" : String(err),
  });
});

// =============================================================================
// START
// =============================================================================

app.listen(PORT, () => {
  console.log("");
  console.log("=== SHEEP Cloud Server ===");
  console.log(`  Port:    ${PORT}`);
  console.log(`  Env:     ${process.env.NODE_ENV ?? "development"}`);
  console.log(`  Health:  http://localhost:${PORT}/health`);
  console.log(`  API:     http://localhost:${PORT}/v1/`);
  console.log("");
});

export default app;
