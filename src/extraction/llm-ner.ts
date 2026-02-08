/**
 * SHEEP AI - LLM-Based Named Entity Recognition
 *
 * Uses Claude to extract named entities with types.
 * This supplements the pattern-based extraction with semantic understanding.
 *
 * Entity types supported:
 * - PERSON: Names of people
 * - ORGANIZATION: Companies, teams, groups
 * - LOCATION: Places, cities, countries
 * - PROJECT: Software projects, products
 * - TECHNOLOGY: Languages, frameworks, tools, models
 * - DATE: Specific dates or relative references
 * - DURATION: Time periods
 * - QUANTITY: Numbers with meaning
 * - CONCEPT: Preferences, values, abstract ideas
 * - OTHER: Entities that don't fit other categories
 *
 * @module sheep/extraction/llm-ner
 */

import type { LLMProvider } from "./llm-extractor.js";

// =============================================================================
// TYPES
// =============================================================================

export type EntityType =
  | "PERSON"
  | "ORGANIZATION"
  | "LOCATION"
  | "PROJECT"
  | "TECHNOLOGY"
  | "DATE"
  | "DURATION"
  | "QUANTITY"
  | "CONCEPT"
  | "OTHER";

export type ExtractedNamedEntity = {
  text: string;
  type: EntityType;
  confidence: number;
  context: string;
};

export type NERResult = {
  entities: ExtractedNamedEntity[];
  extractionTimeMs: number;
};

// =============================================================================
// NER PROMPT
// =============================================================================

const NER_PROMPT = `You are an expert at Named Entity Recognition.

Extract all named entities from the following text. For each entity, provide:
1. The exact text of the entity
2. The entity type (PERSON, ORGANIZATION, LOCATION, PROJECT, TECHNOLOGY, DATE, DURATION, QUANTITY, CONCEPT, OTHER)
3. Your confidence (0.0-1.0)
4. Brief context (why you identified this entity)

Entity types:
- PERSON: Names of people (e.g., "Alex Chen", "my manager John")
- ORGANIZATION: Companies, teams, institutions (e.g., "TechCorp", "the DevOps team")
- LOCATION: Places, cities, countries (e.g., "San Francisco", "the office")
- PROJECT: Software projects, products (e.g., "Moltbot", "the API redesign")
- TECHNOLOGY: Languages, frameworks, tools, models (e.g., "TypeScript", "PostgreSQL", "Claude")
- DATE: Specific dates or relative references (e.g., "January 15", "yesterday")
- DURATION: Time periods (e.g., "3 years", "about 2 hours")
- QUANTITY: Numbers with meaning (e.g., "60%", "$500")
- CONCEPT: Preferences, values, abstract ideas (e.g., "type safety", "performance")
- OTHER: Entities that don't fit other categories

Output ONLY valid JSON:
{
  "entities": [
    {
      "text": "string",
      "type": "PERSON|ORGANIZATION|LOCATION|PROJECT|TECHNOLOGY|DATE|DURATION|QUANTITY|CONCEPT|OTHER",
      "confidence": 0.0-1.0,
      "context": "brief explanation"
    }
  ]
}

Text to analyze:
`;

// =============================================================================
// NER EXTRACTION
// =============================================================================

/**
 * Parse JSON from LLM response
 */
function parseJSON<T>(response: string): T | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    const cleaned = jsonStr.trim().replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    return JSON.parse(cleaned) as T;
  } catch {
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Validate entity type
 */
function validateEntityType(type: string): EntityType {
  const validTypes: EntityType[] = [
    "PERSON",
    "ORGANIZATION",
    "LOCATION",
    "PROJECT",
    "TECHNOLOGY",
    "DATE",
    "DURATION",
    "QUANTITY",
    "CONCEPT",
    "OTHER",
  ];

  const upper = type.toUpperCase();
  return validTypes.includes(upper as EntityType) ? (upper as EntityType) : "OTHER";
}

/**
 * Extract named entities using LLM
 */
export async function extractNamedEntities(llm: LLMProvider, text: string): Promise<NERResult> {
  const startTime = Date.now();

  const prompt = NER_PROMPT + text;

  const response = await llm.complete(prompt, {
    maxTokens: 2000,
    temperature: 0.1,
    jsonMode: true,
  });

  const parsed = parseJSON<{
    entities: Array<{
      text: string;
      type: string;
      confidence: number;
      context: string;
    }>;
  }>(response);

  if (!parsed?.entities) {
    return {
      entities: [],
      extractionTimeMs: Date.now() - startTime,
    };
  }

  const entities: ExtractedNamedEntity[] = parsed.entities.map((e) => ({
    text: e.text,
    type: validateEntityType(e.type),
    confidence: Math.max(0, Math.min(1, e.confidence)),
    context: e.context,
  }));

  return {
    entities,
    extractionTimeMs: Date.now() - startTime,
  };
}

// =============================================================================
// INTEGRATION WITH FACT EXTRACTION
// =============================================================================

/**
 * Fact candidate generated from NER results
 */
export type NERFactCandidate = {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
};

/**
 * Convert NER results to fact candidates
 * Maps entity types to appropriate predicates based on context
 */
export function nerToFactCandidates(
  nerResult: NERResult,
  contextSubject: string = "user",
): NERFactCandidate[] {
  const candidates: NERFactCandidate[] = [];

  for (const entity of nerResult.entities) {
    const contextLower = entity.context.toLowerCase();

    switch (entity.type) {
      case "PERSON":
        // Could be "user has_name X" or "user knows X"
        if (
          contextLower.includes("name") ||
          contextLower.includes("called") ||
          contextLower.includes("i am") ||
          contextLower.includes("my name")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "has_name",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (
          contextLower.includes("colleague") ||
          contextLower.includes("coworker") ||
          contextLower.includes("teammate")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "works_with",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (
          contextLower.includes("manager") ||
          contextLower.includes("boss") ||
          contextLower.includes("lead")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "reports_to",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;

      case "ORGANIZATION":
        if (
          contextLower.includes("work") ||
          contextLower.includes("employ") ||
          contextLower.includes("company")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "works_at",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (contextLower.includes("team")) {
          candidates.push({
            subject: contextSubject,
            predicate: "team",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;

      case "LOCATION":
        if (
          contextLower.includes("live") ||
          contextLower.includes("reside") ||
          contextLower.includes("home")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "lives_in",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (
          contextLower.includes("from") ||
          contextLower.includes("originally") ||
          contextLower.includes("born")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "from",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (contextLower.includes("office") || contextLower.includes("work")) {
          candidates.push({
            subject: contextSubject,
            predicate: "office_location",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;

      case "TECHNOLOGY":
        if (
          contextLower.includes("prefer") ||
          contextLower.includes("like") ||
          contextLower.includes("love") ||
          contextLower.includes("favorite")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "prefers",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (contextLower.includes("use") || contextLower.includes("using")) {
          candidates.push({
            subject: contextSubject,
            predicate: "uses",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (
          contextLower.includes("hate") ||
          contextLower.includes("dislike") ||
          contextLower.includes("avoid")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "dislikes",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (contextLower.includes("learn") || contextLower.includes("study")) {
          candidates.push({
            subject: contextSubject,
            predicate: "learning",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;

      case "PROJECT":
        if (
          contextLower.includes("work") ||
          contextLower.includes("build") ||
          contextLower.includes("develop")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "working_on",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;

      case "DATE":
        if (contextLower.includes("birthday")) {
          candidates.push({
            subject: contextSubject,
            predicate: "birthday",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (contextLower.includes("deadline")) {
          candidates.push({
            subject: "project",
            predicate: "deadline",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;

      case "DURATION":
        if (
          contextLower.includes("tenure") ||
          contextLower.includes("years at") ||
          contextLower.includes("working for")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "tenure",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (contextLower.includes("experience") || contextLower.includes("been doing")) {
          candidates.push({
            subject: contextSubject,
            predicate: "experience_duration",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;

      case "QUANTITY":
        if (contextLower.includes("age") || contextLower.includes("years old")) {
          candidates.push({
            subject: contextSubject,
            predicate: "age",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (contextLower.includes("team size") || contextLower.includes("engineers")) {
          candidates.push({
            subject: contextSubject,
            predicate: "team_size",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;

      case "CONCEPT":
        if (
          contextLower.includes("value") ||
          contextLower.includes("important") ||
          contextLower.includes("prioritize")
        ) {
          candidates.push({
            subject: contextSubject,
            predicate: "values",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;

      default:
        // Skip OTHER entities without clear mappings
        break;
    }
  }

  return candidates;
}

// =============================================================================
// ENHANCED EXTRACTION WITH NER
// =============================================================================

import type { Fact } from "../memory/schema.js";
import { now } from "../memory/schema.js";
import { extractFactsWithLLM } from "./llm-extractor.js";

/**
 * Enhanced fact extraction using both direct extraction and NER.
 * Combines results from:
 * 1. Direct LLM fact extraction
 * 2. NER-based fact candidates
 *
 * Deduplicates and takes highest confidence for each unique fact.
 */
export async function extractFactsWithLLMEnhanced(
  llm: LLMProvider,
  conversationText: string,
  episodeId: string,
): Promise<Omit<Fact, "id" | "createdAt" | "updatedAt">[]> {
  // Run both extractions in parallel for speed
  const [directFacts, nerResult] = await Promise.all([
    extractFactsWithLLM(llm, conversationText, episodeId),
    extractNamedEntities(llm, conversationText),
  ]);

  // Convert NER results to fact candidates
  const nerCandidates = nerToFactCandidates(nerResult);
  const timestamp = now();

  const nerFacts = nerCandidates.map((nf) => ({
    subject: nf.subject,
    predicate: nf.predicate,
    object: nf.object,
    confidence: nf.confidence,
    evidence: [episodeId],
    isActive: true,
    userAffirmed: false,
    accessCount: 0,
    firstSeen: timestamp,
    lastConfirmed: timestamp,
    contradictions: [],
  }));

  // Merge and deduplicate - keep highest confidence for each unique fact
  const allFacts = [...directFacts, ...nerFacts];
  const seen = new Map<string, (typeof allFacts)[0]>();

  for (const fact of allFacts) {
    const key = `${fact.subject.toLowerCase()}:${fact.predicate.toLowerCase()}:${fact.object.toLowerCase()}`;
    const existing = seen.get(key);

    if (!existing || fact.confidence > existing.confidence) {
      seen.set(key, fact);
    }
  }

  return [...seen.values()];
}
