/**
 * SHEEP AI - Procedure Extraction Pipeline
 *
 * Extracts behavioral patterns (Procedures) from episodes and conversations.
 * A procedure is: trigger condition → action taken → expected outcome
 *
 * This enables "procedural memory" - knowing HOW to do things based on
 * observed patterns.
 *
 * @module sheep/procedures/extractor
 */

import type { Episode, Procedure } from "../memory/schema.js";
import type { LLMProvider } from "../extraction/llm-extractor.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A candidate procedure before confidence scoring
 */
export type ProcedureCandidate = {
  trigger: string;
  action: string;
  expectedOutcome?: string;
  source: "pattern" | "inference" | "llm";
  rawText: string;
  confidence: number;
};

/**
 * Options for procedure extraction
 */
export type ProcedureExtractionOptions = {
  /** Minimum confidence to keep a procedure (default: 0.4) */
  minConfidence?: number;
  /** Whether to use LLM for better extraction (default: false) */
  useLLM?: boolean;
};

// =============================================================================
// PATTERN-BASED EXTRACTION
// =============================================================================

/**
 * Patterns for extracting procedures from text
 * Each pattern captures: trigger, action, and optional outcome
 */
const PROCEDURE_PATTERNS: Array<{
  regex: RegExp;
  triggerGroup: number;
  actionGroup: number;
  outcomeGroup?: number;
  confidence: number;
}> = [
  // "When X, I/you/we do Y"
  {
    regex: /when\s+(.+?),?\s+(?:i|you|we)\s+(?:usually\s+)?(.+?)(?:\.|$)/gi,
    triggerGroup: 1,
    actionGroup: 2,
    confidence: 0.75,
  },
  // "If X, then Y"
  {
    regex: /if\s+(.+?),?\s+(?:then\s+)?(?:i|you|we)\s+(.+?)(?:\.|$)/gi,
    triggerGroup: 1,
    actionGroup: 2,
    confidence: 0.7,
  },
  // "To X, I/you/we Y"
  {
    regex: /to\s+(.+?),?\s+(?:i|you|we)\s+(?:usually\s+)?(.+?)(?:\.|$)/gi,
    triggerGroup: 1,
    actionGroup: 2,
    confidence: 0.7,
  },
  // "I/you/we always X when Y"
  {
    regex: /(?:i|you|we)\s+always\s+(.+?)\s+when\s+(.+?)(?:\.|$)/gi,
    triggerGroup: 2,
    actionGroup: 1,
    confidence: 0.8,
  },
  // "The way to X is to Y"
  {
    regex: /the\s+(?:best\s+)?way\s+to\s+(.+?)\s+is\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
    triggerGroup: 1,
    actionGroup: 2,
    confidence: 0.75,
  },
  // "For X, use Y"
  {
    regex: /for\s+(.+?),?\s+(?:use|try|do)\s+(.+?)(?:\.|$)/gi,
    triggerGroup: 1,
    actionGroup: 2,
    confidence: 0.7,
  },
  // "I prefer to X when Y"
  {
    regex: /(?:i|we)\s+prefer\s+to\s+(.+?)\s+when\s+(.+?)(?:\.|$)/gi,
    triggerGroup: 2,
    actionGroup: 1,
    confidence: 0.75,
  },
  // "Whenever X, Y"
  {
    regex: /whenever\s+(.+?),?\s+(?:i|you|we)\s+(.+?)(?:\.|$)/gi,
    triggerGroup: 1,
    actionGroup: 2,
    confidence: 0.75,
  },
  // "X works best when Y"
  {
    regex: /(.+?)\s+works\s+(?:best|well)\s+when\s+(.+?)(?:\.|$)/gi,
    triggerGroup: 2,
    actionGroup: 1,
    confidence: 0.7,
  },
  // "First X, then Y"
  {
    regex: /first\s+(.+?),?\s+then\s+(.+?)(?:\.|$)/gi,
    triggerGroup: 1,
    actionGroup: 2,
    confidence: 0.65,
  },
  // "Start by X, then Y"
  {
    regex: /start\s+(?:by|with)\s+(.+?),?\s+then\s+(.+?)(?:\.|$)/gi,
    triggerGroup: 1,
    actionGroup: 2,
    confidence: 0.7,
  },
  // "Before X, always Y"
  {
    regex: /before\s+(.+?),?\s+(?:always|usually)\s+(.+?)(?:\.|$)/gi,
    triggerGroup: 1,
    actionGroup: 2,
    confidence: 0.7,
  },
];

/**
 * Clean extracted procedure text
 */
function cleanProcedureText(text: string): string {
  return text
    .trim()
    .replace(/^(i|we|they|he|she|it|you)\s+/i, "") // Remove pronouns at start
    .replace(/['"]/g, "") // Remove quotes
    .replace(/\s+/g, " ") // Normalize whitespace
    .substring(0, 200); // Cap length
}

/**
 * Extract procedures using pattern matching
 */
function extractProceduresFromPatterns(text: string): ProcedureCandidate[] {
  const candidates: ProcedureCandidate[] = [];

  for (const pattern of PROCEDURE_PATTERNS) {
    // Reset regex state
    pattern.regex.lastIndex = 0;

    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const trigger = cleanProcedureText(match[pattern.triggerGroup] || "");
      const action = cleanProcedureText(match[pattern.actionGroup] || "");
      const outcome = pattern.outcomeGroup
        ? cleanProcedureText(match[pattern.outcomeGroup] || "")
        : undefined;

      // Filter out low-quality matches
      if (trigger.length < 3 || action.length < 3) continue;
      if (trigger === action) continue;

      candidates.push({
        trigger,
        action,
        expectedOutcome: outcome,
        source: "pattern",
        rawText: match[0],
        confidence: pattern.confidence,
      });
    }
  }

  return candidates;
}

// =============================================================================
// INFERENCE-BASED EXTRACTION
// =============================================================================

/**
 * Infer procedures from common development patterns
 */
function inferProceduresFromContext(text: string): ProcedureCandidate[] {
  const candidates: ProcedureCandidate[] = [];
  const lowerText = text.toLowerCase();

  // Debugging patterns
  if (/\bdebug|error|fix|issue\b/i.test(lowerText)) {
    if (/verbose|log|console|print/.test(lowerText)) {
      candidates.push({
        trigger: "when debugging",
        action: "use verbose logging",
        expectedOutcome: "identify the issue location",
        source: "inference",
        rawText: "Debugging with verbose output",
        confidence: 0.6,
      });
    }
  }

  // Testing patterns
  if (/\btest|spec|check\b/i.test(lowerText)) {
    if (/before|first|initially/.test(lowerText)) {
      candidates.push({
        trigger: "before deploying changes",
        action: "run tests",
        expectedOutcome: "ensure nothing is broken",
        source: "inference",
        rawText: "Testing before deployment",
        confidence: 0.65,
      });
    }
  }

  // Code review patterns
  if (/\breview|pr|pull request|merge\b/i.test(lowerText)) {
    candidates.push({
      trigger: "when submitting code",
      action: "create a pull request for review",
      expectedOutcome: "get feedback before merging",
      source: "inference",
      rawText: "Code review via PR",
      confidence: 0.6,
    });
  }

  // Git patterns
  if (/\bgit|commit|push|branch\b/i.test(lowerText)) {
    if (/message|describe|explain/.test(lowerText)) {
      candidates.push({
        trigger: "when committing changes",
        action: "write descriptive commit messages",
        expectedOutcome: "maintain clear history",
        source: "inference",
        rawText: "Descriptive git commits",
        confidence: 0.6,
      });
    }
  }

  return candidates;
}

/**
 * Deduplicate similar procedure candidates
 */
function deduplicateProcedures(candidates: ProcedureCandidate[]): ProcedureCandidate[] {
  const seen = new Map<string, ProcedureCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.trigger.toLowerCase().substring(0, 30)}:${candidate.action.toLowerCase().substring(0, 30)}`;

    const existing = seen.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      seen.set(key, candidate);
    }
  }

  return [...seen.values()];
}

// =============================================================================
// LLM-BASED EXTRACTION
// =============================================================================

const PROCEDURE_EXTRACTION_PROMPT = `You are an expert at identifying behavioral patterns and procedures from conversations.

Given the following conversation, extract any procedures (behavioral patterns) that show how the user prefers to do things.

A procedure has:
1. trigger: The situation/condition that triggers the behavior
2. action: What action is taken
3. expectedOutcome: (optional) What result is expected

Rules:
1. Only extract clear patterns, not one-time events
2. Focus on reusable procedures
3. Rate confidence 0.0-1.0
4. Include reasoning

Output ONLY valid JSON:
{
  "procedures": [
    {
      "trigger": "when/if [situation]",
      "action": "[what to do]",
      "expectedOutcome": "[result]",
      "confidence": 0.0-1.0,
      "reasoning": "why this is a pattern"
    }
  ]
}

Conversation:
`;

/**
 * Extract procedures using LLM
 */
export async function extractProceduresWithLLM(
  llm: LLMProvider,
  conversationText: string,
  episodeId: string,
): Promise<
  Omit<
    Procedure,
    "id" | "createdAt" | "updatedAt" | "timesUsed" | "timesSucceeded" | "successRate"
  >[]
> {
  const prompt = PROCEDURE_EXTRACTION_PROMPT + conversationText;

  const response = await llm.complete(prompt, {
    maxTokens: 1500,
    temperature: 0.2,
  });

  // Parse JSON from response
  let parsed: {
    procedures: Array<{
      trigger: string;
      action: string;
      expectedOutcome?: string;
      confidence: number;
    }>;
  } | null = null;
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    const cleaned = jsonStr.trim().replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    parsed = JSON.parse(cleaned);
  } catch {
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        parsed = JSON.parse(objectMatch[0]);
      } catch {
        return [];
      }
    }
  }

  if (!parsed?.procedures) {
    return [];
  }

  return parsed.procedures.map((p) => ({
    trigger: p.trigger,
    action: p.action,
    expectedOutcome: p.expectedOutcome,
    examples: [episodeId],
    tags: [],
  }));
}

// =============================================================================
// MAIN EXTRACTION FUNCTIONS
// =============================================================================

/**
 * Extract procedures from an episode
 */
export function extractProceduresFromEpisode(
  episode: Episode,
  options: ProcedureExtractionOptions = {},
): Omit<
  Procedure,
  "id" | "createdAt" | "updatedAt" | "timesUsed" | "timesSucceeded" | "successRate"
>[] {
  const minConfidence = options.minConfidence ?? 0.4;
  const text = episode.summary;

  // Extract candidates from multiple sources
  const patternCandidates = extractProceduresFromPatterns(text);
  const inferenceCandidates = inferProceduresFromContext(text);

  // Combine and deduplicate
  const allCandidates = deduplicateProcedures([...patternCandidates, ...inferenceCandidates]);

  // Filter by confidence and convert to procedures
  const procedures: Omit<
    Procedure,
    "id" | "createdAt" | "updatedAt" | "timesUsed" | "timesSucceeded" | "successRate"
  >[] = [];

  for (const candidate of allCandidates) {
    if (candidate.confidence >= minConfidence) {
      procedures.push({
        trigger: candidate.trigger,
        action: candidate.action,
        expectedOutcome: candidate.expectedOutcome,
        examples: [episode.id],
        tags: inferTags(candidate),
      });
    }
  }

  return procedures;
}

/**
 * Infer tags for a procedure based on its content
 */
function inferTags(candidate: ProcedureCandidate): string[] {
  const tags: string[] = [];
  const combined = `${candidate.trigger} ${candidate.action}`.toLowerCase();

  if (/debug|error|fix|issue/.test(combined)) tags.push("debugging");
  if (/test|spec|assert/.test(combined)) tags.push("testing");
  if (/deploy|release|ship/.test(combined)) tags.push("deployment");
  if (/commit|push|merge|pr|branch/.test(combined)) tags.push("git");
  if (/code|function|class|method/.test(combined)) tags.push("coding");
  if (/review|feedback|check/.test(combined)) tags.push("review");
  if (/document|readme|comment/.test(combined)) tags.push("documentation");
  if (/build|compile|package/.test(combined)) tags.push("build");

  return tags;
}

/**
 * Extract procedures from multiple episodes
 */
export function extractProceduresFromEpisodes(
  episodes: Episode[],
  options: ProcedureExtractionOptions = {},
): Omit<
  Procedure,
  "id" | "createdAt" | "updatedAt" | "timesUsed" | "timesSucceeded" | "successRate"
>[] {
  const allProcedures: Omit<
    Procedure,
    "id" | "createdAt" | "updatedAt" | "timesUsed" | "timesSucceeded" | "successRate"
  >[] = [];

  for (const episode of episodes) {
    const episodeProcedures = extractProceduresFromEpisode(episode, options);
    allProcedures.push(...episodeProcedures);
  }

  // Merge similar procedures
  return mergeProcedures(allProcedures);
}

/**
 * Merge similar procedures, combining examples
 */
function mergeProcedures(
  procedures: Omit<
    Procedure,
    "id" | "createdAt" | "updatedAt" | "timesUsed" | "timesSucceeded" | "successRate"
  >[],
): Omit<
  Procedure,
  "id" | "createdAt" | "updatedAt" | "timesUsed" | "timesSucceeded" | "successRate"
>[] {
  const merged = new Map<
    string,
    Omit<
      Procedure,
      "id" | "createdAt" | "updatedAt" | "timesUsed" | "timesSucceeded" | "successRate"
    >
  >();

  for (const proc of procedures) {
    const key = `${proc.trigger.toLowerCase().substring(0, 30)}:${proc.action.toLowerCase().substring(0, 30)}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...proc });
    } else {
      // Merge examples and tags
      const mergedExamples = [...new Set([...existing.examples, ...proc.examples])];
      const mergedTags = [...new Set([...existing.tags, ...proc.tags])];

      merged.set(key, {
        ...existing,
        examples: mergedExamples,
        tags: mergedTags,
      });
    }
  }

  return [...merged.values()];
}
