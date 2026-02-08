/**
 * SHEEP AI - Fact Extraction Pipeline
 *
 * Extracts subject-predicate-object triples (Facts) from Episodes.
 * Uses pattern matching and heuristics for local extraction,
 * with optional LLM enhancement for better accuracy.
 *
 * @module sheep/extraction/fact-extractor
 */

import type { Episode, Fact } from "../memory/schema.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A candidate fact before confidence scoring
 */
export type FactCandidate = {
  subject: string;
  predicate: string;
  object: string;
  source: "pattern" | "inference" | "llm";
  rawText: string;
};

/**
 * Options for fact extraction
 */
export type FactExtractionOptions = {
  /** Minimum confidence to keep a fact (default: 0.3) */
  minConfidence?: number;
  /** Whether to use LLM for better extraction (default: false) */
  useLLM?: boolean;
};

// =============================================================================
// PATTERN-BASED EXTRACTION
// =============================================================================

/**
 * Common patterns for extracting facts from text
 * Each pattern has: regex, subject group, predicate, object group
 */
const FACT_PATTERNS: Array<{
  regex: RegExp;
  subjectGroup: number;
  predicate: string;
  objectGroup: number;
  confidence: number;
}> = [
  // "X is Y" patterns
  {
    regex: /(?:my|the)\s+(\w+(?:\s+\w+)?)\s+is\s+([^,.!?]+)/gi,
    subjectGroup: 1,
    predicate: "is",
    objectGroup: 2,
    confidence: 0.7,
  },
  // "I am X" patterns
  {
    regex: /\bi\s+am\s+(?:a\s+)?(\w+(?:\s+\w+)?)/gi,
    subjectGroup: 0,
    predicate: "is_a",
    objectGroup: 1,
    confidence: 0.8,
  },
  // "I work at/for X"
  {
    regex: /\bi\s+work\s+(?:at|for)\s+([^,.!?]+)/gi,
    subjectGroup: 0,
    predicate: "works_at",
    objectGroup: 1,
    confidence: 0.9,
  },
  // "I live in X"
  {
    regex: /\bi\s+live\s+in\s+([^,.!?]+)/gi,
    subjectGroup: 0,
    predicate: "lives_in",
    objectGroup: 1,
    confidence: 0.9,
  },
  // "I prefer/like X" (with optional adverbs like "really", "actually")
  {
    regex: /\bi\s+(?:really\s+|actually\s+)?(?:prefer|like|love)\s+([^,.!?]+)/gi,
    subjectGroup: 0,
    predicate: "prefers",
    objectGroup: 1,
    confidence: 0.75,
  },
  // "I use X"
  {
    regex: /\bi\s+(?:use|am using)\s+([^,.!?]+)/gi,
    subjectGroup: 0,
    predicate: "uses",
    objectGroup: 1,
    confidence: 0.7,
  },
  // "My name is X"
  {
    regex: /my\s+name\s+is\s+(\w+(?:\s+\w+)?)/gi,
    subjectGroup: 0,
    predicate: "has_name",
    objectGroup: 1,
    confidence: 0.95,
  },
  // "I'm called X"
  {
    regex: /(?:i'm|i\s+am)\s+called\s+(\w+(?:\s+\w+)?)/gi,
    subjectGroup: 0,
    predicate: "has_name",
    objectGroup: 1,
    confidence: 0.9,
  },
  // "X is my favorite"
  {
    regex: /(\w+(?:\s+\w+)?)\s+is\s+my\s+favorite/gi,
    subjectGroup: 0,
    predicate: "favorite",
    objectGroup: 1,
    confidence: 0.8,
  },
  // "I need X"
  {
    regex: /\bi\s+need\s+([^,.!?]+)/gi,
    subjectGroup: 0,
    predicate: "needs",
    objectGroup: 1,
    confidence: 0.6,
  },
  // "I want X"
  {
    regex: /\bi\s+want\s+([^,.!?]+)/gi,
    subjectGroup: 0,
    predicate: "wants",
    objectGroup: 1,
    confidence: 0.5,
  },
  // "The project uses X"
  {
    regex: /(?:the\s+)?project\s+(?:uses|is using)\s+([^,.!?]+)/gi,
    subjectGroup: 0,
    predicate: "uses",
    objectGroup: 1,
    confidence: 0.75,
  },
  // "We're building X"
  {
    regex: /(?:we're|we\s+are)\s+building\s+([^,.!?]+)/gi,
    subjectGroup: 0,
    predicate: "is_building",
    objectGroup: 1,
    confidence: 0.7,
  },
  // "I'm working on X" / "I'm currently working on X"
  {
    regex:
      /\bi(?:'m|'m|\s+am)\s+(?:currently\s+)?working\s+on\s+(?:a\s+)?(?:project\s+)?(?:called\s+)?([^,.!?]+)/gi,
    subjectGroup: 0,
    predicate: "working_on",
    objectGroup: 1,
    confidence: 0.85,
  },
  // "It's about X" (project description)
  {
    regex: /it(?:'s|'s|\s+is)\s+about\s+([^,.!?]+)/gi,
    subjectGroup: 0,
    predicate: "is_about",
    objectGroup: 1,
    confidence: 0.6,
  },
  // "started X ago" / "about X months"
  {
    regex:
      /(?:started|been\s+working)\s+(?:on\s+(?:this|it)\s+)?(?:about\s+)?(\d+\s+(?:months?|weeks?|days?|years?))/gi,
    subjectGroup: 0,
    predicate: "project_duration",
    objectGroup: 1,
    confidence: 0.7,
  },
  // Timezone patterns
  {
    regex: /(?:my|i'm in|i am in)\s+(?:the\s+)?(\w+)\s+timezone/gi,
    subjectGroup: 0,
    predicate: "timezone",
    objectGroup: 1,
    confidence: 0.85,
  },
  // Language patterns
  {
    regex: /\bi\s+speak\s+(\w+)/gi,
    subjectGroup: 0,
    predicate: "speaks",
    objectGroup: 1,
    confidence: 0.85,
  },
];

/**
 * Extract facts using pattern matching
 */
function extractFactsFromPatterns(text: string): FactCandidate[] {
  const candidates: FactCandidate[] = [];

  for (const pattern of FACT_PATTERNS) {
    const matches = text.matchAll(pattern.regex);
    for (const match of matches) {
      const subject =
        pattern.subjectGroup === 0 ? "user" : cleanExtractedText(match[pattern.subjectGroup] || "");
      const object = cleanExtractedText(match[pattern.objectGroup] || "");

      if (subject && object && object.length > 1) {
        candidates.push({
          subject,
          predicate: pattern.predicate,
          object,
          source: "pattern",
          rawText: match[0],
        });
      }
    }
  }

  return candidates;
}

/**
 * Clean extracted text
 */
function cleanExtractedText(text: string): string {
  return text
    .trim()
    .replace(/^(a|an|the)\s+/i, "") // Remove articles
    .replace(/['"]/g, "") // Remove quotes
    .replace(/\s+/g, " ") // Normalize whitespace
    .toLowerCase();
}

// =============================================================================
// INFERENCE-BASED EXTRACTION
// =============================================================================

/**
 * Infer facts from conversation context
 */
function inferFactsFromContext(text: string): FactCandidate[] {
  const candidates: FactCandidate[] = [];
  const lowerText = text.toLowerCase();

  // Technology preferences from code blocks
  if (/```typescript|\.ts\b/.test(text)) {
    candidates.push({
      subject: "user",
      predicate: "uses",
      object: "typescript",
      source: "inference",
      rawText: "Code contains TypeScript",
    });
  }

  if (/```python|\.py\b/.test(text)) {
    candidates.push({
      subject: "user",
      predicate: "uses",
      object: "python",
      source: "inference",
      rawText: "Code contains Python",
    });
  }

  if (/```javascript|\.js\b/.test(text)) {
    candidates.push({
      subject: "user",
      predicate: "uses",
      object: "javascript",
      source: "inference",
      rawText: "Code contains JavaScript",
    });
  }

  // Framework detection
  if (/\breact\b/i.test(lowerText)) {
    candidates.push({
      subject: "project",
      predicate: "uses",
      object: "react",
      source: "inference",
      rawText: "Mentions React",
    });
  }

  if (/\bnext\.?js\b/i.test(lowerText)) {
    candidates.push({
      subject: "project",
      predicate: "uses",
      object: "nextjs",
      source: "inference",
      rawText: "Mentions Next.js",
    });
  }

  if (/\bvue\b/i.test(lowerText)) {
    candidates.push({
      subject: "project",
      predicate: "uses",
      object: "vue",
      source: "inference",
      rawText: "Mentions Vue",
    });
  }

  // Database detection
  if (/\bpostgres(?:ql)?\b/i.test(lowerText)) {
    candidates.push({
      subject: "project",
      predicate: "uses",
      object: "postgresql",
      source: "inference",
      rawText: "Mentions PostgreSQL",
    });
  }

  if (/\bmongodb?\b/i.test(lowerText)) {
    candidates.push({
      subject: "project",
      predicate: "uses",
      object: "mongodb",
      source: "inference",
      rawText: "Mentions MongoDB",
    });
  }

  if (/\bsqlite\b/i.test(lowerText)) {
    candidates.push({
      subject: "project",
      predicate: "uses",
      object: "sqlite",
      source: "inference",
      rawText: "Mentions SQLite",
    });
  }

  // Model preferences
  if (/\b(?:claude|opus|sonnet)\b/i.test(lowerText)) {
    if (/prefer|like|love|use|using/.test(lowerText)) {
      const model = lowerText.match(/\b(claude|opus|sonnet)\b/i)?.[1]?.toLowerCase();
      if (model) {
        candidates.push({
          subject: "user",
          predicate: "prefers",
          object: model,
          source: "inference",
          rawText: `Mentions ${model}`,
        });
      }
    }
  }

  if (/\b(?:gpt-?4|chatgpt|openai)\b/i.test(lowerText)) {
    if (/prefer|like|love|use|using/.test(lowerText)) {
      candidates.push({
        subject: "user",
        predicate: "uses",
        object: "openai",
        source: "inference",
        rawText: "Mentions OpenAI/GPT",
      });
    }
  }

  return candidates;
}

// =============================================================================
// CONFIDENCE SCORING
// =============================================================================

/**
 * Calculate confidence score for a fact candidate
 */
function calculateFactConfidence(candidate: FactCandidate, episodeSalience: number): number {
  let confidence = 0.5; // Base confidence

  // Source-based adjustment
  switch (candidate.source) {
    case "pattern":
      confidence += 0.2;
      break;
    case "inference":
      confidence += 0.1;
      break;
    case "llm":
      confidence += 0.3;
      break;
  }

  // High-confidence predicates
  if (["has_name", "works_at", "lives_in", "timezone", "speaks"].includes(candidate.predicate)) {
    confidence += 0.15;
  }

  // Episode salience adjustment
  confidence += episodeSalience * 0.1;

  // Length-based adjustment (very short objects are less reliable)
  if (candidate.object.length < 3) {
    confidence -= 0.2;
  }

  // Cap between 0 and 1
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Deduplicate and merge similar facts
 */
function deduplicateFacts(candidates: FactCandidate[]): FactCandidate[] {
  const seen = new Map<string, FactCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.subject}:${candidate.predicate}:${candidate.object}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, candidate);
    } else if (candidate.source === "pattern" && existing.source === "inference") {
      // Pattern-based is more reliable
      seen.set(key, candidate);
    }
  }

  return [...seen.values()];
}

// =============================================================================
// MAIN EXTRACTION FUNCTION
// =============================================================================

/**
 * Extract facts from an episode
 */
export function extractFactsFromEpisode(
  episode: Episode,
  options: FactExtractionOptions = {},
): Omit<Fact, "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions">[] {
  const minConfidence = options.minConfidence ?? 0.3;

  // Combine all text from the episode
  const text = episode.summary;

  // Extract candidates from multiple sources
  const patternCandidates = extractFactsFromPatterns(text);
  const inferenceCandidates = inferFactsFromContext(text);

  // Combine and deduplicate
  const allCandidates = deduplicateFacts([...patternCandidates, ...inferenceCandidates]);

  // Convert to facts with confidence scoring
  const facts: Omit<
    Fact,
    "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions"
  >[] = [];

  for (const candidate of allCandidates) {
    const confidence = calculateFactConfidence(candidate, episode.emotionalSalience);

    if (confidence >= minConfidence) {
      facts.push({
        subject: candidate.subject,
        predicate: candidate.predicate,
        object: candidate.object,
        confidence,
        evidence: [episode.id],
        firstSeen: episode.timestamp,
        lastConfirmed: episode.timestamp,
        userAffirmed: false,
        retractedReason: undefined,
      });
    }
  }

  return facts;
}

/**
 * Extract facts from multiple episodes
 */
export function extractFactsFromEpisodes(
  episodes: Episode[],
  options: FactExtractionOptions = {},
): Omit<Fact, "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions">[] {
  const allFacts: Omit<
    Fact,
    "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions"
  >[] = [];

  for (const episode of episodes) {
    const episodeFacts = extractFactsFromEpisode(episode, options);
    allFacts.push(...episodeFacts);
  }

  // Merge facts with same SPO triple
  return mergeFacts(allFacts);
}

/**
 * Merge facts with the same subject-predicate-object
 */
function mergeFacts(
  facts: Omit<
    Fact,
    "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions"
  >[],
): Omit<Fact, "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions">[] {
  const merged = new Map<
    string,
    Omit<Fact, "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions">
  >();

  for (const fact of facts) {
    const key = `${fact.subject}:${fact.predicate}:${fact.object}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...fact });
    } else {
      // Merge evidence and update confidence
      const mergedEvidence = [...new Set([...existing.evidence, ...fact.evidence])];
      const mergedConfidence = Math.min(1, existing.confidence + 0.1); // Increase confidence with more evidence

      merged.set(key, {
        ...existing,
        confidence: mergedConfidence,
        evidence: mergedEvidence,
        lastConfirmed:
          fact.lastConfirmed > existing.lastConfirmed ? fact.lastConfirmed : existing.lastConfirmed,
      });
    }
  }

  return [...merged.values()];
}

/**
 * Detect contradictions between facts
 */
export function detectContradictions(newFact: Fact, existingFacts: Fact[]): Fact[] {
  const contradicting: Fact[] = [];

  for (const existing of existingFacts) {
    // Same subject and predicate but different object = potential contradiction
    if (
      existing.subject === newFact.subject &&
      existing.predicate === newFact.predicate &&
      existing.object !== newFact.object &&
      existing.isActive
    ) {
      // Check if this is a "singular" predicate (can only have one value)
      const singularPredicates = ["has_name", "works_at", "lives_in", "timezone", "is_a"];
      if (singularPredicates.includes(newFact.predicate)) {
        contradicting.push(existing);
      }
    }
  }

  return contradicting;
}

/**
 * Resolve contradiction between two facts
 * Returns which fact should be kept active
 */
export function resolveContradiction(
  factA: Fact,
  factB: Fact,
): { keep: Fact; retract: Fact; reason: string } {
  // User-affirmed facts always win
  if (factA.userAffirmed && !factB.userAffirmed) {
    return { keep: factA, retract: factB, reason: "User affirmed fact A" };
  }
  if (factB.userAffirmed && !factA.userAffirmed) {
    return { keep: factB, retract: factA, reason: "User affirmed fact B" };
  }

  // More recent fact wins (information may have changed)
  if (factA.lastConfirmed > factB.lastConfirmed) {
    return { keep: factA, retract: factB, reason: "Fact A is more recent" };
  }
  if (factB.lastConfirmed > factA.lastConfirmed) {
    return { keep: factB, retract: factA, reason: "Fact B is more recent" };
  }

  // Higher confidence wins
  if (factA.confidence > factB.confidence) {
    return { keep: factA, retract: factB, reason: "Fact A has higher confidence" };
  }
  if (factB.confidence > factA.confidence) {
    return { keep: factB, retract: factA, reason: "Fact B has higher confidence" };
  }

  // More evidence wins
  if (factA.evidence.length > factB.evidence.length) {
    return { keep: factA, retract: factB, reason: "Fact A has more evidence" };
  }

  // Default to keeping the newer fact
  return { keep: factA, retract: factB, reason: "Default to fact A" };
}
