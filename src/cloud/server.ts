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
import billingRoutes from "./routes/billing.js";
import { healthRouter, statusRouter } from "./routes/health.js";
import { startCloudTelegramBot } from "./telegram-bot.js";
import whatsappRouter from "./channels/whatsapp.js";

// =============================================================================
// BOOTSTRAP
// =============================================================================

const app: express.Express = express();
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
// LANDING PAGE (root /)
// =============================================================================

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Counting Sheep - AI That Remembers You</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center}
h1{font-size:3rem;margin-bottom:0.5rem;background:linear-gradient(135deg,#a78bfa,#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.tagline{font-size:1.3rem;color:#999;margin-bottom:2rem}
.hero{font-size:5rem;margin-bottom:1rem}
.cta{display:inline-block;padding:1rem 2.5rem;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;text-decoration:none;border-radius:12px;font-size:1.2rem;font-weight:600;margin:0.5rem;transition:transform 0.2s}
.cta:hover{transform:scale(1.05)}
.cta.secondary{background:#1a1a2e;border:1px solid #333}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.5rem;max-width:800px;margin:3rem auto}
.feature{background:#111;border:1px solid #222;border-radius:12px;padding:1.5rem}
.feature h3{color:#a78bfa;margin-bottom:0.5rem}
.pricing{margin-top:3rem;max-width:600px}
.pricing h2{margin-bottom:1rem;color:#60a5fa}
.tier{background:#111;border:1px solid #222;border-radius:8px;padding:1rem;margin:0.5rem 0;display:flex;justify-content:space-between;align-items:center}
.tier .name{font-weight:600}
.tier .price{color:#a78bfa}
footer{margin-top:3rem;color:#555;font-size:0.9rem}
footer a{color:#60a5fa;text-decoration:none}
</style>
</head>
<body>
<div class="hero">&#x1F411;</div>
<h1>Counting Sheep</h1>
<p class="tagline">The AI that actually remembers you.</p>
<p style="color:#777;max-width:500px;margin-bottom:2rem">Every other AI forgets you after each chat. Sheep remembers your name, your preferences, your projects, your goals -- across every conversation, forever.</p>
<a class="cta" href="https://t.me/CountingSheep_bot">Try Free on Telegram</a>
<a class="cta secondary" href="/v1/billing/prices">API for Developers</a>
<div class="features">
<div class="feature"><h3>Remembers Everything</h3><p>Facts, preferences, events, relationships -- extracted automatically from conversations.</p></div>
<div class="feature"><h3>Sleep Consolidation</h3><p>Like a real brain, memories are consolidated during idle time -- patterns emerge, contradictions resolve.</p></div>
<div class="feature"><h3>Causal Reasoning</h3><p>Understands WHY things happened. Ask "why did I switch to TypeScript?" and get a real answer.</p></div>
<div class="feature"><h3>Your Data, Your Rules</h3><p>Each user gets isolated storage. Delete anytime. GDPR compliant. We never sell your data.</p></div>
</div>
<div class="pricing">
<h2>Pricing</h2>
<div class="tier"><span class="name">Free</span><span class="price">$0 &middot; 20 msgs/day</span></div>
<div class="tier"><span class="name">Personal</span><span class="price">$9/mo &middot; Unlimited</span></div>
<div class="tier"><span class="name">Pro</span><span class="price">$19/mo &middot; API + Multi-device</span></div>
<div class="tier"><span class="name">Team</span><span class="price">$49/seat/mo &middot; Federation</span></div>
</div>
<footer>
<p>Built by <a href="https://marsirius.ai">Marsirius AI Labs</a> &middot; <a href="mailto:mb@marsirius.ai">mb@marsirius.ai</a></p>
</footer>
</body>
</html>`);
});

// =============================================================================
// PUBLIC ROUTES (no auth)
// =============================================================================

app.use(healthRouter);

// WhatsApp webhook (public -- Meta needs to reach it without API key auth)
app.use(whatsappRouter);

// OpenAPI spec for GPT Store / integrations
app.get("/openapi.yaml", async (_req, res) => {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    // Try multiple locations (dev vs Docker)
    for (const base of [process.cwd(), "/app"]) {
      const specPath = path.join(base, "packages", "openai-gpt", "openapi.yaml");
      if (fs.existsSync(specPath)) {
        res.setHeader("Content-Type", "text/yaml");
        res.send(fs.readFileSync(specPath, "utf-8"));
        return;
      }
    }
    res.status(404).json({ error: "OpenAPI spec not found" });
  } catch { res.status(500).json({ error: "Failed to serve spec" }); }
});

// =============================================================================
// AUTHENTICATED ROUTES
// =============================================================================

// All /v1/* routes require API key auth + rate limiting
app.use("/v1", apiKeyAuth as express.RequestHandler, rateLimiter as express.RequestHandler);

// Memory operations
app.use("/v1", memoryRoutes);

// Consolidation
app.use("/v1", consolidateRoutes);

// Billing
app.use("/v1", billingRoutes);

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

  // Start Telegram bot (if token is set)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const bot = startCloudTelegramBot();
    if (bot) {
      bot.start({
        onStart: (info) => console.log(`  Telegram: @${info.username} (multi-user, cloud)`),
      });
    }
  } else {
    console.log("  Telegram: disabled (TELEGRAM_BOT_TOKEN not set)");
  }
});

export default app;
