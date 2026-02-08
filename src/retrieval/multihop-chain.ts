/**
 * SHEEP AI - Multi-hop Chain Reasoning (V3 Spec)
 *
 * Enables answering questions that require chaining multiple facts together.
 * Example: "Why did I switch from Jira?" requires:
 *   1. Fact: "user dislikes Jira" + causal: "Jira slow → switched to Linear"
 *   2. Chain: dissatisfaction → evaluation → switch
 *
 * This supplements agentic-retrieval.ts with explicit causal chain traversal.
 *
 * @module sheep/retrieval/multihop-chain
 */

import type { SheepDatabase } from "../memory/database.js";
import type { Fact, CausalLink } from "../memory/schema.js";
import { createSubsystemLogger } from "../stubs/logging.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/** A single link in a reasoning chain */
export type ChainLink = {
  type: "fact" | "causal";
  id: string;
  description: string;
  confidence: number;
};

/** A complete multi-hop reasoning chain */
export type ReasoningChain = {
  /** The original query that triggered this chain */
  query: string;
  /** Ordered links in the chain */
  links: ChainLink[];
  /** Overall chain confidence (product of link confidences) */
  chainConfidence: number;
  /** Number of hops in this chain */
  hops: number;
  /** Human-readable narrative */
  narrative: string;
};

/** Options for chain discovery */
export type ChainOptions = {
  /** Maximum chain length (default: 5) */
  maxHops?: number;
  /** Minimum confidence for a link to be included (default: 0.3) */
  minLinkConfidence?: number;
  /** Maximum chains to return (default: 3) */
  maxChains?: number;
};

// =============================================================================
// CHAIN DISCOVERY
// =============================================================================

/**
 * Discover causal chains starting from a set of seed facts.
 *
 * Algorithm:
 * 1. Start with seed facts (from initial retrieval)
 * 2. For each seed, find causal links where it's the cause or effect
 * 3. Follow links to connected facts/episodes
 * 4. Build chains up to maxHops depth
 * 5. Score chains by cumulative confidence
 */
export function discoverCausalChains(
  seedFacts: Fact[],
  db: SheepDatabase,
  options: ChainOptions = {},
): ReasoningChain[] {
  const maxHops = options.maxHops ?? 5;
  const minLinkConfidence = options.minLinkConfidence ?? 0.3;
  const maxChains = options.maxChains ?? 3;

  const allChains: ReasoningChain[] = [];
  const visited = new Set<string>();

  for (const seed of seedFacts) {
    const chains = buildChainsFromSeed(seed, db, maxHops, minLinkConfidence, visited);
    allChains.push(...chains);
  }

  // Sort by chain confidence (highest first) and limit
  allChains.sort((a, b) => b.chainConfidence - a.chainConfidence);
  const topChains = allChains.slice(0, maxChains);

  log.debug("Discovered causal chains", {
    seedFacts: seedFacts.length,
    totalChains: allChains.length,
    returnedChains: topChains.length,
  });

  return topChains;
}

/**
 * Build chains from a single seed fact by following causal links.
 */
function buildChainsFromSeed(
  seed: Fact,
  db: SheepDatabase,
  maxHops: number,
  minConfidence: number,
  globalVisited: Set<string>,
): ReasoningChain[] {
  const chains: ReasoningChain[] = [];

  // BFS/DFS to find chains
  type QueueItem = {
    currentId: string;
    currentType: "fact" | "causal";
    path: ChainLink[];
    visited: Set<string>;
  };

  const queue: QueueItem[] = [
    {
      currentId: seed.id,
      currentType: "fact",
      path: [
        {
          type: "fact",
          id: seed.id,
          description: `${seed.subject} ${seed.predicate} ${seed.object}`,
          confidence: seed.confidence,
        },
      ],
      visited: new Set([seed.id]),
    },
  ];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;

    // Max depth reached; save chain if it has multiple hops
    if (item.path.length > maxHops || item.path.length > 1) {
      if (item.path.length >= 2) {
        const chainConfidence = item.path.reduce((acc, link) => acc * link.confidence, 1);
        chains.push({
          query: "",
          links: [...item.path],
          chainConfidence,
          hops: item.path.length - 1,
          narrative: buildNarrative(item.path),
        });
      }
      if (item.path.length > maxHops) continue;
    }

    // Find connected causal links
    const causalLinks = findConnectedCausalLinks(item.currentId, db);

    for (const cl of causalLinks) {
      if (cl.confidence < minConfidence) continue;
      if (item.visited.has(cl.id)) continue;
      if (globalVisited.has(cl.id)) continue;

      const newVisited = new Set(item.visited);
      newVisited.add(cl.id);
      globalVisited.add(cl.id);

      // Determine which end to follow
      const isForward = cl.causeId === item.currentId;
      const nextId = isForward ? cl.effectId : cl.causeId;
      const nextDescription = isForward ? cl.effectDescription : cl.causeDescription;

      const newPath: ChainLink[] = [
        ...item.path,
        {
          type: "causal",
          id: cl.id,
          description: `${cl.causeDescription} → ${cl.effectDescription}`,
          confidence: cl.confidence,
        },
      ];

      // Try to find the connected fact
      if (!newVisited.has(nextId)) {
        newVisited.add(nextId);

        // Add the connected entity as a fact link
        newPath.push({
          type: "fact",
          id: nextId,
          description: nextDescription,
          confidence: cl.confidence,
        });

        queue.push({
          currentId: nextId,
          currentType: "fact",
          path: newPath,
          visited: newVisited,
        });
      }
    }
  }

  return chains;
}

/**
 * Find causal links connected to a given fact/entity ID.
 */
function findConnectedCausalLinks(entityId: string, db: SheepDatabase): CausalLink[] {
  try {
    // Search for causal links where this entity is either cause or effect
    const asCause = db.db
      .prepare("SELECT * FROM sheep_causal_links WHERE cause_id = ?")
      .all(entityId) as Record<string, unknown>[];

    const asEffect = db.db
      .prepare("SELECT * FROM sheep_causal_links WHERE effect_id = ?")
      .all(entityId) as Record<string, unknown>[];

    const all = [...asCause, ...asEffect];
    return all.map(rowToCausalLink);
  } catch {
    return [];
  }
}

/**
 * Convert a database row to a CausalLink object.
 */
function rowToCausalLink(row: Record<string, unknown>): CausalLink {
  return {
    id: String(row.id ?? ""),
    causeType: String(row.cause_type ?? "event") as CausalLink["causeType"],
    causeId: String(row.cause_id ?? ""),
    causeDescription: String(row.cause_description ?? ""),
    effectType: String(row.effect_type ?? "event") as CausalLink["effectType"],
    effectId: String(row.effect_id ?? ""),
    effectDescription: String(row.effect_description ?? ""),
    mechanism: String(row.mechanism ?? ""),
    confidence: Number(row.confidence ?? 0.5),
    evidence: safeParseArray(row.evidence),
    temporalDelay: row.temporal_delay ? String(row.temporal_delay) : undefined,
    causalStrength: String(row.causal_strength ?? "contributing") as CausalLink["causalStrength"],
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function safeParseArray(val: unknown): string[] {
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Build a human-readable narrative from a chain of links.
 */
function buildNarrative(links: ChainLink[]): string {
  if (links.length === 0) return "";
  if (links.length === 1) return links[0].description;

  const parts: string[] = [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (link.type === "causal") {
      // Already has arrow notation
      parts.push(link.description);
    } else if (i === 0) {
      parts.push(`Starting from: ${link.description}`);
    } else {
      parts.push(`Leading to: ${link.description}`);
    }
  }

  return parts.join(" | ");
}

/**
 * Format reasoning chains for LLM context injection.
 *
 * Produces concise text showing causal reasoning paths.
 */
export function formatChainsForContext(chains: ReasoningChain[], maxChars: number = 2000): string {
  if (chains.length === 0) return "";

  const lines: string[] = ["## Causal Reasoning Chains"];

  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i];
    const conf = (chain.chainConfidence * 100).toFixed(0);
    lines.push(`\nChain ${i + 1} (${chain.hops} hops, ${conf}% confidence):`);

    for (const link of chain.links) {
      const prefix = link.type === "causal" ? "  →" : "  •";
      lines.push(`${prefix} ${link.description}`);
    }
  }

  const result = lines.join("\n");
  return result.length > maxChars ? result.slice(0, maxChars) + "\n..." : result;
}
