/**
 * SHEEP Cloud - Memory API Routes
 *
 * Endpoints:
 *   POST /v1/remember   -- Store a fact
 *   POST /v1/recall     -- Search memory
 *   POST /v1/why        -- Causal reasoning
 *   GET  /v1/facts      -- List recent facts
 *   POST /v1/forget     -- Forget facts
 */

import { Router } from "express";
import type { AuthenticatedRequest } from "../middleware/api-key-auth.js";
import { requireTier } from "../middleware/tier-gate.js";
import { getUserDatabase } from "../db-manager.js";
import { now } from "../../memory/schema.js";

const router = Router();

// =============================================================================
// POST /v1/remember -- Store a fact
// =============================================================================

router.post("/remember", (req: AuthenticatedRequest, res) => {
  try {
    const { subject, predicate, object, confidence } = req.body;

    if (!subject || !predicate || !object) {
      res.status(400).json({
        error: "missing_fields",
        message: "subject, predicate, and object are required.",
      });
      return;
    }

    const db = getUserDatabase(req.userId!);
    const timestamp = now();
    const fact = db.insertFact({
      subject: String(subject),
      predicate: String(predicate),
      object: String(object),
      confidence: typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0.9,
      evidence: ["api/remember"],
      firstSeen: timestamp,
      lastConfirmed: timestamp,
      userAffirmed: true,
    });

    res.status(201).json({
      ok: true,
      fact: {
        id: fact.id,
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        confidence: fact.confidence,
      },
    });
  } catch (err) {
    console.error("[cloud/memory] remember error:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});

// =============================================================================
// POST /v1/recall -- Search memory
// =============================================================================

router.post("/recall", (req: AuthenticatedRequest, res) => {
  try {
    const { query, type, limit } = req.body;

    if (!query) {
      res.status(400).json({
        error: "missing_fields",
        message: "query is required.",
      });
      return;
    }

    const maxResults = Math.min(typeof limit === "number" ? limit : 10, 50);
    const searchType = type ?? "all"; // "facts" | "episodes" | "all"
    const db = getUserDatabase(req.userId!);

    const results: { facts?: unknown[]; episodes?: unknown[] } = {};

    if (searchType === "facts" || searchType === "all") {
      const allFacts = db.findFacts({ activeOnly: true });
      const queryWords = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const matching = allFacts
        .filter((f) => {
          const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
          return queryWords.some((w) => text.includes(w));
        })
        .slice(0, maxResults);

      results.facts = matching.map((f) => ({
        id: f.id,
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        confidence: f.confidence,
      }));
    }

    // Note: Episode search requires semantic/embedding search (future enhancement).
    // For now, recall searches facts only. Episodes are accessed via consolidation.

    res.json({
      ok: true,
      query,
      type: searchType,
      ...results,
    });
  } catch (err) {
    console.error("[cloud/memory] recall error:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});

// =============================================================================
// POST /v1/why -- Causal reasoning (personal+ tier)
// =============================================================================

router.post("/why", requireTier("causal_reasoning"), (req: AuthenticatedRequest, res) => {
  try {
    const { effect, maxDepth } = req.body;

    if (!effect) {
      res.status(400).json({
        error: "missing_fields",
        message: "effect is required.",
      });
      return;
    }

    const db = getUserDatabase(req.userId!);
    const causalLinks = db.findCausalLinks({});

    if (causalLinks.length === 0) {
      res.json({
        ok: true,
        effect,
        chain: [],
        message: "No causal knowledge yet. Store more conversations and run consolidation.",
      });
      return;
    }

    // Simple keyword matching for relevant causal links
    const queryWords = String(effect).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const relevant = causalLinks.filter((l) => {
      const text = `${l.causeDescription} ${l.effectDescription} ${l.mechanism}`.toLowerCase();
      return queryWords.some((w) => text.includes(w));
    }).slice(0, maxDepth ?? 10);

    res.json({
      ok: true,
      effect,
      chain: relevant.map((l) => ({
        cause: l.causeDescription,
        effect: l.effectDescription,
        mechanism: l.mechanism,
        confidence: l.confidence,
      })),
    });
  } catch (err) {
    console.error("[cloud/memory] why error:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});

// =============================================================================
// GET /v1/facts -- List recent facts
// =============================================================================

router.get("/facts", (req: AuthenticatedRequest, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const activeOnly = req.query.active !== "false";
    const db = getUserDatabase(req.userId!);

    const facts = db.findFacts({ activeOnly });
    const limited = facts.slice(0, limit);

    res.json({
      ok: true,
      count: limited.length,
      total: facts.length,
      facts: limited.map((f) => ({
        id: f.id,
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        confidence: f.confidence,
        isActive: f.isActive,
        createdAt: f.createdAt,
      })),
    });
  } catch (err) {
    console.error("[cloud/memory] facts error:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});

// =============================================================================
// POST /v1/forget -- Forget facts
// =============================================================================

router.post("/forget", (req: AuthenticatedRequest, res) => {
  try {
    const { topic, factId } = req.body;

    if (!topic && !factId) {
      res.status(400).json({
        error: "missing_fields",
        message: "topic or factId is required.",
      });
      return;
    }

    const db = getUserDatabase(req.userId!);
    let forgotten = 0;

    if (factId) {
      db.retractFact(String(factId), "API /forget by factId");
      forgotten = 1;
    } else if (topic) {
      const facts = db.findFacts({ activeOnly: true });
      const topicLower = String(topic).toLowerCase();
      const matching = facts.filter((f) => {
        const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
        return text.includes(topicLower);
      });

      for (const fact of matching) {
        db.retractFact(fact.id, `API /forget topic: ${topic}`);
        forgotten++;
      }
    }

    res.json({
      ok: true,
      forgotten,
    });
  } catch (err) {
    console.error("[cloud/memory] forget error:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});

export default router;
