/**
 * SHEEP AI - Causal Reasoning Engine
 *
 * Extracts cause-effect-mechanism relationships from episodes and facts.
 * This enables "why" queries - understanding causality, not just correlation.
 *
 * Key capabilities:
 * - Extract causal links from episode text
 * - Build causal chains (A caused B which caused C)
 * - Detect causal contradictions
 * - Answer "why did X happen?" queries
 *
 * @module sheep/causal/causal-extractor
 */

import type { LLMProvider } from "../extraction/llm-extractor.js";
import type { Episode, Fact, CausalLink } from "../memory/schema.js";
import { generateId } from "../memory/schema.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A candidate causal relationship before confidence scoring
 */
export type CausalCandidate = {
  causeDescription: string;
  effectDescription: string;
  mechanism: string;
  pattern: string; // Which pattern matched
  rawText: string;
};

/**
 * Options for causal extraction
 */
export type CausalExtractionOptions = {
  /** Minimum confidence to keep a causal link (default: 0.4) */
  minConfidence?: number;
  /** Whether to use LLM for better extraction (default: false) */
  useLLM?: boolean;
};

/**
 * Result of a causal chain query
 */
export type CausalChainResult = {
  /** The original effect we're explaining */
  targetEffect: string;
  /** Chain of causes leading to the effect */
  chain: CausalLink[];
  /** Total confidence (product of individual confidences) */
  totalConfidence: number;
  /** Human-readable explanation */
  explanation: string;
};

// =============================================================================
// CAUSAL PATTERNS
// =============================================================================

/**
 * Patterns for extracting causal relationships from text
 * Each pattern captures: cause, effect, and mechanism indicators
 */
const CAUSAL_PATTERNS: Array<{
  regex: RegExp;
  causeGroup: number;
  effectGroup: number;
  mechanismHint: string;
  confidence: number;
}> = [
  // "X because Y" - effect because cause
  {
    regex: /(.+?)\s+because\s+(.+?)(?:\.|$)/gi,
    causeGroup: 2,
    effectGroup: 1,
    mechanismHint: "direct causation",
    confidence: 0.8,
  },
  // "due to X, Y" - cause then effect
  {
    regex: /due\s+to\s+(.+?),?\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "attributed cause",
    confidence: 0.75,
  },
  // "X led to Y" - cause led to effect
  {
    regex: /(.+?)\s+led\s+to\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "progressive causation",
    confidence: 0.8,
  },
  // "X caused Y" - explicit causation
  {
    regex: /(.+?)\s+caused\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "direct causation",
    confidence: 0.9,
  },
  // "X resulted in Y"
  {
    regex: /(.+?)\s+resulted\s+in\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "outcome relationship",
    confidence: 0.8,
  },
  // "as a result of X, Y"
  {
    regex: /as\s+a\s+result\s+of\s+(.+?),?\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "consequence",
    confidence: 0.8,
  },
  // "X so Y" / "X, so Y"
  {
    regex: /(.+?),?\s+so\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "logical consequence",
    confidence: 0.65,
  },
  // "X therefore Y"
  {
    regex: /(.+?),?\s+therefore\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "logical deduction",
    confidence: 0.7,
  },
  // "since X, Y"
  {
    regex: /since\s+(.+?),?\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "temporal/causal connection",
    confidence: 0.7,
  },
  // "X made Y happen" / "X made me Y"
  {
    regex: /(.+?)\s+made\s+(?:me\s+)?(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "forced outcome",
    confidence: 0.75,
  },
  // "after X, Y" (temporal causation)
  {
    regex: /after\s+(.+?),?\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "temporal sequence",
    confidence: 0.5, // Lower - temporal != causal
  },
  // "X triggered Y"
  {
    regex: /(.+?)\s+triggered\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "trigger mechanism",
    confidence: 0.85,
  },
  // "if X then Y" / "when X, Y" (conditional causation)
  {
    regex: /(?:if|when)\s+(.+?),?\s+(?:then\s+)?(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "conditional relationship",
    confidence: 0.6,
  },
  // "X enabled Y" / "X allowed Y"
  {
    regex: /(.+?)\s+(?:enabled|allowed)\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "enabling condition",
    confidence: 0.7,
  },
  // "X prevented Y" (negative causation)
  {
    regex: /(.+?)\s+prevented\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "prevention mechanism",
    confidence: 0.8,
  },
  // "that's why X" - explaining effect
  {
    regex: /that'?s\s+why\s+(.+?)(?:\.|$)/gi,
    causeGroup: 0, // Need to look at previous context
    effectGroup: 1,
    mechanismHint: "explanation",
    confidence: 0.7,
  },
  // "X is why Y"
  {
    regex: /(.+?)\s+is\s+why\s+(.+?)(?:\.|$)/gi,
    causeGroup: 1,
    effectGroup: 2,
    mechanismHint: "explicit explanation",
    confidence: 0.85,
  },
];

// =============================================================================
// CAUSAL EXTRACTION
// =============================================================================

/**
 * Clean extracted causal text
 */
function cleanCausalText(text: string): string {
  return text
    .trim()
    .replace(/^(i|we|they|he|she|it)\s+/i, "") // Remove pronouns at start
    .replace(/['"]/g, "") // Remove quotes
    .replace(/\s+/g, " ") // Normalize whitespace
    .substring(0, 200); // Cap length
}

/**
 * Extract causal candidates from text using pattern matching
 */
function extractCausalCandidates(text: string): CausalCandidate[] {
  const candidates: CausalCandidate[] = [];

  for (const pattern of CAUSAL_PATTERNS) {
    // Reset regex state
    pattern.regex.lastIndex = 0;

    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const cause =
        pattern.causeGroup === 0 ? "[context]" : cleanCausalText(match[pattern.causeGroup] || "");
      const effect = cleanCausalText(match[pattern.effectGroup] || "");

      // Filter out low-quality matches
      if (cause.length < 3 || effect.length < 3) continue;
      if (cause === effect) continue;

      candidates.push({
        causeDescription: cause,
        effectDescription: effect,
        mechanism: pattern.mechanismHint,
        pattern: pattern.regex.source.substring(0, 30),
        rawText: match[0],
      });
    }
  }

  return candidates;
}

/**
 * Infer causal relationships from fact changes
 */
function inferCausalFromFactChanges(facts: Fact[]): CausalCandidate[] {
  const candidates: CausalCandidate[] = [];

  // Group facts by subject
  const factsBySubject = new Map<string, Fact[]>();
  for (const fact of facts) {
    const existing = factsBySubject.get(fact.subject) || [];
    existing.push(fact);
    factsBySubject.set(fact.subject, existing);
  }

  // Look for preference changes (old fact retracted, new fact added)
  for (const [subject, subjectFacts] of factsBySubject) {
    const prefersFacts = subjectFacts.filter(
      (f) => f.predicate === "prefers" || f.predicate === "uses" || f.predicate === "works_at",
    );

    // If there's an inactive and active fact for same predicate, infer change
    const inactive = prefersFacts.filter((f) => !f.isActive);
    const active = prefersFacts.filter((f) => f.isActive);

    for (const oldFact of inactive) {
      for (const newFact of active) {
        if (oldFact.predicate === newFact.predicate && oldFact.object !== newFact.object) {
          candidates.push({
            causeDescription: oldFact.retractedReason || `changed from ${oldFact.object}`,
            effectDescription: `${subject} now ${newFact.predicate} ${newFact.object}`,
            mechanism: "preference change",
            pattern: "fact_change_inference",
            rawText: `${subject}: ${oldFact.object} → ${newFact.object}`,
          });
        }
      }
    }
  }

  return candidates;
}

/**
 * Calculate confidence for a causal candidate
 */
function calculateCausalConfidence(candidate: CausalCandidate, episodeSalience: number): number {
  let confidence = 0.5; // Base confidence

  // Pattern-based adjustment
  if (candidate.pattern.includes("caused") || candidate.pattern.includes("triggered")) {
    confidence += 0.2;
  } else if (candidate.pattern.includes("because") || candidate.pattern.includes("led")) {
    confidence += 0.15;
  } else if (candidate.pattern.includes("after") || candidate.pattern.includes("if")) {
    confidence += 0.05; // Temporal/conditional is weaker
  }

  // Mechanism quality
  if (candidate.mechanism.includes("direct") || candidate.mechanism.includes("explicit")) {
    confidence += 0.1;
  }

  // Episode salience
  confidence += episodeSalience * 0.1;

  // Length-based (very short descriptions are less reliable)
  if (candidate.causeDescription.length < 10 || candidate.effectDescription.length < 10) {
    confidence -= 0.15;
  }

  // Inference-based
  if (candidate.pattern === "fact_change_inference") {
    confidence += 0.15; // Inference from actual data is reliable
  }

  return Math.max(0.1, Math.min(1, confidence));
}

/**
 * Deduplicate similar causal candidates
 */
function deduplicateCausalCandidates(candidates: CausalCandidate[]): CausalCandidate[] {
  const seen = new Map<string, CausalCandidate>();

  for (const candidate of candidates) {
    // Create a normalized key
    const key = `${candidate.causeDescription.toLowerCase().substring(0, 50)}:${candidate.effectDescription.toLowerCase().substring(0, 50)}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, candidate);
    }
    // Keep the one with more specific mechanism
  }

  return [...seen.values()];
}

// =============================================================================
// MAIN EXTRACTION FUNCTIONS
// =============================================================================

/**
 * Extract causal links from an episode
 */
// =============================================================================
// LLM-BASED CAUSAL EXTRACTION
// =============================================================================

const LLM_CAUSAL_PROMPT = `You are a causal reasoning analyst. Given the following text, extract cause-effect relationships.

For each relationship provide a JSON object with:
- "cause": What happened first or what triggered the effect (max 50 words)
- "effect": What resulted from the cause (max 50 words)  
- "mechanism": How the cause led to the effect (max 30 words)
- "confidence": 0.0-1.0 (how certain is this causal relationship)

Only extract relationships where causation is clearly implied or stated. Do NOT infer weak correlations.

Text:
"""
{TEXT}
"""

Respond with a JSON array only. If no causal relationships found, respond with [].`;

/**
 * Extract causal links using LLM for deeper understanding
 */
export async function extractCausalLinksWithLLM(
  episode: Episode,
  llm: LLMProvider,
  options: CausalExtractionOptions = {},
): Promise<Omit<CausalLink, "id" | "createdAt" | "updatedAt">[]> {
  const minConfidence = options.minConfidence ?? 0.4;
  const text = episode.summary;

  if (!text || text.length < 20) return [];

  try {
    const prompt = LLM_CAUSAL_PROMPT.replace("{TEXT}", text);
    const response = await llm.complete(prompt, {
      temperature: 0.1,
      maxTokens: 2000,
      jsonMode: true,
    });

    // Parse JSON response
    let parsed: Array<{
      cause: string;
      effect: string;
      mechanism: string;
      confidence: number;
    }>;

    try {
      const cleaned = response
        .trim()
        .replace(/^```json?\n?/, "")
        .replace(/\n?```$/, "");
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) parsed = [];
    } catch {
      // Fallback to regex extraction
      return extractCausalLinksFromEpisodeRegex(episode, options);
    }

    const links: Omit<CausalLink, "id" | "createdAt" | "updatedAt">[] = [];

    for (const item of parsed) {
      const confidence = Math.min(Math.max(item.confidence ?? 0.5, 0), 1);
      if (confidence < minConfidence) continue;

      links.push({
        causeType: "episode",
        causeId: episode.id,
        causeDescription: item.cause?.slice(0, 200) ?? "",
        effectType: "episode",
        effectId: episode.id,
        effectDescription: item.effect?.slice(0, 200) ?? "",
        mechanism: item.mechanism?.slice(0, 200) ?? "LLM-inferred causation",
        confidence,
        evidence: [episode.id],
        temporalDelay: undefined,
        causalStrength: confidence > 0.7 ? "direct" : "contributing",
      });
    }

    return links;
  } catch (err) {
    // On LLM failure, fallback to regex
    return extractCausalLinksFromEpisodeRegex(episode, options);
  }
}

/**
 * Original regex-based extraction (kept as fallback)
 */
export function extractCausalLinksFromEpisodeRegex(
  episode: Episode,
  options: CausalExtractionOptions = {},
): Omit<CausalLink, "id" | "createdAt" | "updatedAt">[] {
  const minConfidence = options.minConfidence ?? 0.4;
  const text = episode.summary;

  const candidates = extractCausalCandidates(text);
  const unique = deduplicateCausalCandidates(candidates);
  const links: Omit<CausalLink, "id" | "createdAt" | "updatedAt">[] = [];

  for (const candidate of unique) {
    const confidence = calculateCausalConfidence(candidate, episode.emotionalSalience);
    if (confidence >= minConfidence) {
      links.push({
        causeType: "episode",
        causeId: episode.id,
        causeDescription: candidate.causeDescription,
        effectType: "episode",
        effectId: episode.id,
        effectDescription: candidate.effectDescription,
        mechanism: candidate.mechanism,
        confidence,
        evidence: [episode.id],
        temporalDelay: undefined,
        causalStrength: confidence > 0.7 ? "direct" : "contributing",
      });
    }
  }

  return links;
}

/**
 * Extract causal links from an episode — uses LLM if provided, regex fallback
 */
export function extractCausalLinksFromEpisode(
  episode: Episode,
  options: CausalExtractionOptions = {},
): Omit<CausalLink, "id" | "createdAt" | "updatedAt">[] {
  // Sync version always uses regex (for backward compat)
  return extractCausalLinksFromEpisodeRegex(episode, options);
}

/**
 * Extract causal links from facts (detect preference/state changes)
 */
export function extractCausalLinksFromFacts(
  facts: Fact[],
  options: CausalExtractionOptions = {},
): Omit<CausalLink, "id" | "createdAt" | "updatedAt">[] {
  const minConfidence = options.minConfidence ?? 0.4;

  // Infer causal relationships from fact changes
  const candidates = inferCausalFromFactChanges(facts);

  // Convert to causal links
  const links: Omit<CausalLink, "id" | "createdAt" | "updatedAt">[] = [];

  for (const candidate of candidates) {
    const confidence = calculateCausalConfidence(candidate, 0.5);

    if (confidence >= minConfidence) {
      links.push({
        causeType: "event",
        causeId: generateId("cl"), // Use causal link prefix for event-based causes
        causeDescription: candidate.causeDescription,
        effectType: "fact",
        effectId: generateId("fact"),
        effectDescription: candidate.effectDescription,
        mechanism: candidate.mechanism,
        confidence,
        evidence: [],
        temporalDelay: undefined,
        causalStrength: "contributing",
      });
    }
  }

  return links;
}

/**
 * Extract causal links from multiple episodes (sync, regex-only)
 */
export function extractCausalLinksFromEpisodes(
  episodes: Episode[],
  options: CausalExtractionOptions = {},
): Omit<CausalLink, "id" | "createdAt" | "updatedAt">[] {
  const allLinks: Omit<CausalLink, "id" | "createdAt" | "updatedAt">[] = [];

  for (const episode of episodes) {
    const episodeLinks = extractCausalLinksFromEpisode(episode, options);
    allLinks.push(...episodeLinks);
  }

  return mergeCausalLinks(allLinks);
}

/**
 * Extract causal links from multiple episodes using LLM (async)
 * Falls back to regex if LLM is not provided or fails
 */
export async function extractCausalLinksFromEpisodesWithLLM(
  episodes: Episode[],
  llm: LLMProvider,
  options: CausalExtractionOptions = {},
): Promise<Omit<CausalLink, "id" | "createdAt" | "updatedAt">[]> {
  const allLinks: Omit<CausalLink, "id" | "createdAt" | "updatedAt">[] = [];

  for (const episode of episodes) {
    const episodeLinks = await extractCausalLinksWithLLM(episode, llm, options);
    allLinks.push(...episodeLinks);
  }

  return mergeCausalLinks(allLinks);
}

/**
 * Merge similar causal links, increasing confidence
 */
function mergeCausalLinks(
  links: Omit<CausalLink, "id" | "createdAt" | "updatedAt">[],
): Omit<CausalLink, "id" | "createdAt" | "updatedAt">[] {
  const merged = new Map<string, Omit<CausalLink, "id" | "createdAt" | "updatedAt">>();

  for (const link of links) {
    const key = `${link.causeDescription.substring(0, 30)}:${link.effectDescription.substring(0, 30)}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...link });
    } else {
      // Merge evidence and boost confidence
      const mergedEvidence = [...new Set([...existing.evidence, ...link.evidence])];
      const boostedConfidence = Math.min(1, existing.confidence + 0.1);

      merged.set(key, {
        ...existing,
        confidence: boostedConfidence,
        evidence: mergedEvidence,
      });
    }
  }

  return [...merged.values()];
}

// =============================================================================
// CAUSAL CHAIN QUERIES
// =============================================================================

/**
 * Calculate text similarity using multiple approaches for robust matching.
 * Combines word overlap (Jaccard), substring containment, and fuzzy matching.
 * This is a fallback when semantic embeddings aren't available.
 */
function textSimilarity(text1: string, text2: string): number {
  const t1 = text1
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .trim();
  const t2 = text2
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .trim();

  // Check for substring containment (strong signal)
  if (t1.includes(t2) || t2.includes(t1)) {
    return 0.85;
  }

  // Tokenize for word-based matching
  const words1 = new Set(t1.split(/\s+/).filter((w) => w.length > 2));
  const words2 = new Set(t2.split(/\s+/).filter((w) => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  // Jaccard similarity (word overlap)
  const intersection = [...words1].filter((w) => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  // Check for partial word matches (e.g., "switched" vs "switch")
  let partialMatches = 0;
  for (const w1 of words1) {
    for (const w2 of words2) {
      if (w1.includes(w2) || w2.includes(w1)) {
        partialMatches++;
        break;
      }
    }
  }
  const partialScore = words1.size > 0 ? partialMatches / words1.size : 0;

  // Check for key term overlap (nouns/verbs that are semantically important)
  const keyTerms1 = [...words1].filter((w) => w.length > 4); // Longer words tend to be more meaningful
  const keyTerms2 = [...words2].filter((w) => w.length > 4);
  const keyIntersection = keyTerms1.filter((w) => keyTerms2.includes(w)).length;
  const keyScore =
    keyTerms1.length > 0 && keyTerms2.length > 0
      ? keyIntersection / Math.min(keyTerms1.length, keyTerms2.length)
      : 0;

  // Return the best score among different approaches
  return Math.max(jaccard, partialScore * 0.7, keyScore * 0.8);
}

/**
 * Find causal links where the effect is semantically similar to the target.
 * Uses fuzzy text similarity (word overlap + substring + partial matching).
 */
function findSimilarEffects(
  links: CausalLink[],
  targetDescription: string,
  minSimilarity: number = 0.15, // Lowered from 0.35 for better recall
  visited: Set<string>,
): CausalLink[] {
  const results: Array<{ link: CausalLink; similarity: number }> = [];

  for (const link of links) {
    if (visited.has(link.id)) continue;

    const similarity = textSimilarity(link.effectDescription, targetDescription);
    if (similarity >= minSimilarity) {
      results.push({ link, similarity });
    }
  }

  // Sort by similarity (highest first) and return links
  results.sort((a, b) => b.similarity - a.similarity);
  return results.map((r) => r.link);
}

/**
 * Options for building causal chains
 */
export type CausalChainOptions = {
  /** Maximum depth of the causal chain (default: 5) */
  maxDepth?: number;
  /** Minimum similarity threshold for matching (default: 0.15) */
  minSimilarity?: number;
  /** Optional custom similarity function for semantic search */
  similarityFn?: (text1: string, text2: string) => number;
};

/**
 * Build a causal chain explaining why something happened.
 * Uses fuzzy text similarity (word overlap + substring + partial matching)
 * for robust causal chain discovery.
 */
export function buildCausalChain(
  links: CausalLink[],
  targetEffectDescription: string,
  maxDepthOrOptions: number | CausalChainOptions = 5,
): CausalChainResult {
  // Handle both old API (number) and new API (options object)
  const options: CausalChainOptions =
    typeof maxDepthOrOptions === "number" ? { maxDepth: maxDepthOrOptions } : maxDepthOrOptions;

  const maxDepth = options.maxDepth ?? 5;
  const minSimilarity = options.minSimilarity ?? 0.15; // Lowered from 0.35 for better recall
  const similarityFn = options.similarityFn ?? textSimilarity;

  const chain: CausalLink[] = [];
  const visited = new Set<string>();

  // Find links where effect is semantically similar to target (not just substring match)
  const directCauses = findSimilarEffectsWithFn(
    links,
    targetEffectDescription,
    minSimilarity,
    visited,
    similarityFn,
  );

  for (const directCause of directCauses) {
    chain.push(directCause);
    visited.add(directCause.id);
  }

  // Recursively find causes of causes using semantic similarity
  let depth = 0;
  let frontier = directCauses.map((l) => l.causeDescription);

  while (depth < maxDepth && frontier.length > 0) {
    const nextFrontier: string[] = [];

    for (const causeDesc of frontier) {
      // Use semantic similarity for deeper causes too
      const deeperCauses = findSimilarEffectsWithFn(
        links,
        causeDesc,
        minSimilarity,
        visited,
        similarityFn,
      );

      for (const deeperCause of deeperCauses) {
        chain.push(deeperCause);
        visited.add(deeperCause.id);
        nextFrontier.push(deeperCause.causeDescription);
      }
    }

    frontier = nextFrontier;
    depth++;
  }

  // Calculate total confidence
  const totalConfidence =
    chain.length > 0 ? chain.reduce((acc, link) => acc * link.confidence, 1) : 0;

  // Generate explanation
  const explanation = generateCausalExplanation(chain, targetEffectDescription);

  return {
    targetEffect: targetEffectDescription,
    chain,
    totalConfidence,
    explanation,
  };
}

/**
 * Helper to find similar effects with a custom similarity function
 */
function findSimilarEffectsWithFn(
  links: CausalLink[],
  targetDescription: string,
  minSimilarity: number,
  visited: Set<string>,
  similarityFn: (text1: string, text2: string) => number,
): CausalLink[] {
  const results: Array<{ link: CausalLink; similarity: number }> = [];

  for (const link of links) {
    if (visited.has(link.id)) continue;

    const similarity = similarityFn(link.effectDescription, targetDescription);
    if (similarity >= minSimilarity) {
      results.push({ link, similarity });
    }
  }

  // Sort by similarity (highest first) and return links
  results.sort((a, b) => b.similarity - a.similarity);
  return results.map((r) => r.link);
}

/**
 * Generate a human-readable explanation from a causal chain
 */
function generateCausalExplanation(chain: CausalLink[], target: string): string {
  if (chain.length === 0) {
    return `No causal explanation found for: ${target}`;
  }

  const parts: string[] = [`"${target}" happened because:`];

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    const prefix = i === 0 ? "→" : "  →";
    parts.push(
      `${prefix} ${link.causeDescription} (${link.mechanism}, ${(link.confidence * 100).toFixed(0)}% confident)`,
    );
  }

  return parts.join("\n");
}

/**
 * Find all effects caused by a given cause
 */
export function findEffects(links: CausalLink[], causeDescription: string): CausalLink[] {
  return links.filter((link) =>
    link.causeDescription.toLowerCase().includes(causeDescription.toLowerCase()),
  );
}

/**
 * Find all causes of a given effect
 */
export function findCauses(links: CausalLink[], effectDescription: string): CausalLink[] {
  return links.filter((link) =>
    link.effectDescription.toLowerCase().includes(effectDescription.toLowerCase()),
  );
}

// =============================================================================
// CAUSAL CONTRADICTION DETECTION
// =============================================================================

/**
 * Detect contradictions in causal links
 * (same cause leading to opposite effects, or same effect from contradicting causes)
 */
export function detectCausalContradictions(links: CausalLink[]): Array<{
  link1: CausalLink;
  link2: CausalLink;
  type: "same_cause_different_effect" | "same_effect_different_cause";
  description: string;
}> {
  const contradictions: Array<{
    link1: CausalLink;
    link2: CausalLink;
    type: "same_cause_different_effect" | "same_effect_different_cause";
    description: string;
  }> = [];

  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      const link1 = links[i];
      const link2 = links[j];

      // Same cause, different effects (might be contradiction)
      if (
        similarText(link1.causeDescription, link2.causeDescription) &&
        !similarText(link1.effectDescription, link2.effectDescription)
      ) {
        // Check if effects are contradictory (one is negation of other)
        if (isContradictory(link1.effectDescription, link2.effectDescription)) {
          contradictions.push({
            link1,
            link2,
            type: "same_cause_different_effect",
            description: `"${link1.causeDescription}" leads to both "${link1.effectDescription}" and "${link2.effectDescription}"`,
          });
        }
      }

      // Same effect, potentially contradicting causes
      if (
        similarText(link1.effectDescription, link2.effectDescription) &&
        isContradictory(link1.causeDescription, link2.causeDescription)
      ) {
        contradictions.push({
          link1,
          link2,
          type: "same_effect_different_cause",
          description: `"${link1.effectDescription}" is caused by both "${link1.causeDescription}" and "${link2.causeDescription}"`,
        });
      }
    }
  }

  return contradictions;
}

/**
 * Check if two text strings are similar (simple implementation)
 */
function similarText(text1: string, text2: string): boolean {
  const normalized1 = text1.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalized2 = text2.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Simple: check if one contains 80%+ of the other
  const shorter = normalized1.length < normalized2.length ? normalized1 : normalized2;
  const longer = normalized1.length < normalized2.length ? normalized2 : normalized1;

  return longer.includes(shorter) || levenshteinSimilarity(normalized1, normalized2) > 0.8;
}

/**
 * Check if two statements are contradictory
 */
function isContradictory(text1: string, text2: string): boolean {
  const negationWords = [
    "not",
    "no",
    "never",
    "none",
    "neither",
    "without",
    "lack",
    "absent",
    "opposite",
    "contrary",
  ];
  const t1 = text1.toLowerCase();
  const t2 = text2.toLowerCase();

  // Check if one has negation word and other doesn't
  const t1HasNegation = negationWords.some((w) => t1.includes(w));
  const t2HasNegation = negationWords.some((w) => t2.includes(w));

  if (t1HasNegation !== t2HasNegation) {
    // One is negated, check if base content is similar
    const t1Clean = t1.replace(new RegExp(negationWords.join("|"), "g"), "").trim();
    const t2Clean = t2.replace(new RegExp(negationWords.join("|"), "g"), "").trim();
    return similarText(t1Clean, t2Clean);
  }

  return false;
}

/**
 * Simple Levenshtein similarity (0-1)
 */
function levenshteinSimilarity(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;
  const maxLen = Math.max(len1, len2);

  if (maxLen === 0) return 1;

  // Simple character overlap for performance
  const set1 = new Set(s1.split(""));
  const set2 = new Set(s2.split(""));
  const intersection = [...set1].filter((c) => set2.has(c)).length;
  const union = new Set([...set1, ...set2]).size;

  return intersection / union;
}
