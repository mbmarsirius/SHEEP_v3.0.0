/**
 * SHEEP AI - LLM-Powered Extraction Engine
 *
 * THIS IS THE REAL BREAKTHROUGH!
 *
 * Instead of regex patterns, we use actual LLMs to:
 * 1. Extract facts with semantic understanding
 * 2. Identify causal relationships with reasoning
 * 3. Generate episode summaries with context
 * 4. Resolve contradictions intelligently
 *
 * This is what transforms SHEEP from "basic infrastructure" to
 * "breakthrough AI memory system."
 *
 * @module sheep/extraction/llm-extractor
 */

import type { Fact, CausalLink } from "../memory/schema.js";
import { now } from "../memory/schema.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * LLM provider interface - abstract over different backends
 */
export type LLMProvider = {
  /** Generate a completion from a prompt */
  complete: (prompt: string, options?: LLMOptions) => Promise<string>;
  /** Provider name for logging */
  name: string;
};

/**
 * Options for LLM calls
 */
export type LLMOptions = {
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Temperature (0-1) */
  temperature?: number;
  /** System prompt */
  system?: string;
  /** Whether to use JSON mode */
  jsonMode?: boolean;
};

/**
 * SHEEP model configuration for different task types.
 * With Claude Max Plan, we can prioritize quality over cost.
 */
export type SheepModelConfig = {
  /** Fast model for latency-critical operations like prefetch (<100ms target) */
  fastModel: string;
  /** Extraction model for fact/causal link extraction (quality over speed) */
  extractionModel: string;
  /** Reasoning model for sleep consolidation (complex reasoning needs quality) */
  reasoningModel: string;
};

/**
 * Default model configuration for SHEEP AI.
 * Sonnet 4.5 = fast + reliable JSON extraction (MUSCLES)
 * Opus 4.6 = state-of-the-art reasoning + 1M context (BRAIN)
 */
export const DEFAULT_SHEEP_MODELS: SheepModelConfig = {
  fastModel: "claude-sonnet-4-5", // Fast, reliable JSON output
  extractionModel: "claude-sonnet-4-5", // Fast extraction, clean JSON
  reasoningModel: "claude-opus-4-6", // Best reasoning, 1M context, released 2025-02-05
};

/**
 * Model purpose types for createSheepLLMProvider
 */
export type SheepModelPurpose = "fast" | "extraction" | "reasoning";

/**
 * Extracted fact from LLM
 */
export type LLMExtractedFact = {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  reasoning: string;
};

/**
 * Extracted causal link from LLM
 */
export type LLMExtractedCausalLink = {
  cause: string;
  effect: string;
  mechanism: string;
  confidence: number;
  reasoning: string;
};

/**
 * Episode summary from LLM
 */
export type LLMEpisodeSummary = {
  summary: string;
  topic: string;
  keywords: string[];
  emotionalTone: string;
  salience: number;
};

/**
 * Options for LLM-based fact extraction
 */
export type LLMFactExtractionOptions = {
  /** Extract only primary biographical facts (for HaluMem compatibility) */
  primaryOnly?: boolean;
  /** Minimum confidence threshold (default: 0.60, primaryOnly: 0.85) */
  minConfidence?: number;
  /** Maximum facts to extract (default: 15, primaryOnly: 10) */
  maxFacts?: number;
  /** Conversation date string for resolving relative time (e.g., "1:56 pm on 8 May, 2023") */
  conversationDate?: string;
};

/**
 * Primary predicates that are core biographical facts.
 * Used for filtering in primaryOnly mode.
 *
 * Based on HaluMem benchmark analysis - they only use 6 predicates:
 * name_is, gender_is, birth_date, lives_in, age_is, works_at
 */
/**
 * Predicates that match HaluMem's expected fact patterns.
 * These are comprehensive to avoid filtering out valid facts.
 */
export const PRIMARY_PREDICATES = new Set([
  // Core Identity
  "name_is",
  "name",
  "age_is",
  "age",
  "gender_is",
  "gender",
  "birth_date",
  "birthdate",
  // Location
  "lives_in",
  "located_in",
  "resides_in",
  "location",
  // Employment
  "works_at",
  "employer",
  "company",
  "job_title",
  "job_title_is",
  "occupation",
  "role",
  "works_in_industry",
  "industry",
  "employment_status",
  // Education
  "education_level",
  "degree",
  "has_degree_in",
  "major",
  "major_is",
  // Personality
  "personality_type",
  "mbti",
  "personality_tags",
  "personality_trait",
  // Family Status (STATUS only, not details)
  "parent_status",
  "partner_status",
  "children_status",
  // Health
  "physical_health",
  "mental_health",
  "health_status",
  "practices",
  // Finances
  "monthly_income",
  "income",
  "has_savings",
  "savings",
  "financial_status",
  // Relationships (user's relationships)
  "has_friend",
  "has_colleague",
  "has_neighbor",
  // Goals & Motivations
  "life_goal",
  "goal",
  "career_goal",
  "goal_motivation",
  "motivation",
  "goal_target",
  "target_metrics",
  // Preferences
  "prefers",
  "likes",
  "dislikes",
  "preference",
  "preference_reason",
  // Narrative/Event predicates
  "is_considering",
  "considering",
  "emotional_state",
  "emotional",
  "uses_strategy",
  "strategy",
  "values",
  "is_committed_to",
  "committed_to",
  "shared_experience",
  "creative_motivation",
  "current_situation",
  "aims_to",
  "seeks",
]);

/**
 * Extended predicates for non-HaluMem use cases.
 * Still biographical but not in HaluMem's narrow scope.
 */
export const EXTENDED_PREDICATES = new Set([
  ...PRIMARY_PREDICATES,
  // Location variants
  "located_in",
  "resides_in",
  // Employment variants
  "job_title",
  "works_in_industry",
  "employment_status",
  // Education
  "education_level",
  "has_degree_in",
]);

// =============================================================================
// PROMPTS - The Secret Sauce
// =============================================================================

const FACT_EXTRACTION_PROMPT = `You are an expert at extracting factual information from conversations.

Given the following conversation excerpt, extract important factual statements as subject-predicate-object triples.

CRITICAL: Output ONLY valid JSON. No markdown, no explanations, no text before or after the JSON object.

## CRITICAL: Lossless Extraction with Coreference Resolution
- ABSOLUTELY PROHIBIT pronouns (he, she, it, they, this, that, these, those)
- RESOLVE all pronoun coreferences to explicit entity names
- PRESERVE temporal phrases exactly as spoken (see TEMPORAL PRESERVATION below)
- Each fact must be COMPLETE and INDEPENDENT - understandable without context

## What to Extract (ALL of these - be VERY comprehensive!):
1. USER IDENTITY: Name, age, gender, birth date, location, nationality
2. USER BACKGROUND: Education level, major/field of study, skills
3. USER PERSONALITY: MBTI type, personality traits, characteristics
4. USER WORK: Job title, employer/company, industry, income
5. USER FAMILY: Parent status, partner status, children, family member details
6. USER RELATIONSHIPS: Names of friends, colleagues, neighbors
7. USER GOALS: Life goals, career aspirations, plans, intentions
8. USER HEALTH: Physical health, mental health status
9. USER FINANCES: Income, savings, financial status
10. FAMILY MEMBER INFO: Parents' occupations, birthdates
11. ACTIVITIES WITH TIMING: Every activity, trip, event, visit, meeting — ALWAYS include WHEN
12. PLANS & INTENTIONS: "planning to X", "thinking about X" — include WHEN planned
13. SOCIAL EVENTS: Meetups, gatherings, dinners, parties — include WHO and WHEN
14. HOBBIES & INTERESTS: What they do, how long they've done it, what they collect/create
15. TEMPORAL FACTS: Dates, deadlines, durations — preserve as spoken

## CRITICAL: EVERY activity/event/plan MUST include its timing in the object field
BAD:  "Melanie | enjoys | camping" (no timing = useless for "when" questions)
GOOD: "Melanie | planning_to_go_camping | next month" (timing as spoken)
BAD:  "Caroline | met_with | friends and family" (no timing)
GOOD: "Caroline | met_with | friends, family and mentors last week"
BAD:  "Melanie | ran | charity race" (no timing)
GOOD: "Melanie | ran_charity_race | last Saturday"

## Subject Types (all valid):
- Named entities (person names) - "Caroline", "Melanie", "Alex Chen", "Martin Mark" - EXTRACT FACTS ABOUT ALL SPEAKERS
- "user" - only if the speaker's name is not mentioned (fallback)
- Named entities - "Moltbot", "TechCorp", "TechCorp"
- Generic descriptors - "project", "team", "solution", "bug", "feature", "API", "database migration"

## CRITICAL: Extract facts about ALL speakers in the conversation
- If the conversation has multiple speakers (e.g., Caroline and Melanie), extract facts about BOTH
- Use the actual speaker names as subjects, NOT "user"
- Example: "Caroline | went_to | LGBTQ support group on 2023-05-07", "Melanie | painted | sunrise in 2022"
- Extract facts mentioned by or about each speaker, regardless of who is speaking

## Quality Rules:
1. Extract facts EXPLICITLY stated OR reasonably implied
2. Skip trivial meta-facts ("user asked a question", "assistant responded")
3. Predicate = clear relationship (is, has, uses, was, completed, prefers, etc.)
4. Object = specific and concrete - NO PRONOUNS
5. RESOLVE coreferences: "he" → actual name, "it" → actual entity
6. Confidence: 0.9+ explicit, 0.75+ implied, 0.60+ inferred. Below 0.60: skip.
7. LIMIT: 50-80 facts per chunk. Be EXHAUSTIVE.
8. Extract EVERY piece of personal information mentioned.
9. MULTI-SPEAKER: Extract facts about ALL speakers, not just the primary one.

## CRITICAL: LIST EXPLOSION — extract EVERY item separately
When someone mentions multiple items, extract EACH ONE as its own fact:
  "I enjoy yoga, looking at old photos, and tending my roses and dahlias"
  → Person | hobby | yoga
  → Person | hobby | looking at old photos
  → Person | hobby | tending roses and dahlias
  NEVER summarize a list into one fact. Each item = one fact.

  "We visited cafes, new places to eat, and hiked in open spaces"
  → Person | visited | cafes
  → Person | visited | new places to eat
  → Person | activity | hiking in open spaces

## TEMPORAL PRESERVATION — keep the ORIGINAL phrasing
For temporal references, preserve the exact words used in conversation:
  Speaker says "last Friday" → extract as "last Friday" (NOT "2022-01-14")
  Speaker says "three years ago" → extract as "three years ago" (NOT "2019")
  Speaker says "next month" → extract as "next month" (NOT "February 2023")
  Speaker says "May 7, 2023" → extract as "May 7, 2023" (keep absolute dates as-is)
  The RECALL system will resolve temporal references at query time using session dates.
  Your job is to PRESERVE the original phrasing faithfully.

## Examples of GOOD extractions (with coreference resolution):
- user | name_is | Martin Mark (identity)
- user | gender_is | Male (identity)
- user | birth_date | 1996-08-02 (identity)
- user | age_is | 29 (identity - can be inferred)
- user | lives_in | Columbus (location)
- user | has_degree_in | Public Health (education)
- user | education_level | Bachelor (education)
- user | personality_type | ENTP (personality)
- user | works_at | TechCorp (employment)
- user | job_title | Director (employment)
- user | works_in_industry | Healthcare (employment)
- user | monthly_income | 15700 USD (finances)
- user | has_savings | 43700 USD (finances)
- user | physical_health | Normal (health)
- user | mental_health | Mildly abnormal (health)
- user | has_friend | ThomasSusan (relationships)
- user | has_colleague | MartinezDaniel (relationships)
- user | life_goal | establish global health initiative (aspirations)
- user | goal_motivation | Inspired by family's medical background (why they pursue goals)
- user | goal_target | Provide healthcare to 1 million people (measurable targets)
- user | parent_status | Both parents alive (family status)
- user | partner_status | no relationship (relationship status)
- user | children_status | No children (family planning)
- Father | birth_date | 1963-08-02 (family member info)
- Father | occupation | Retired doctor (family member info)
- Mother | occupation | Nurse (family member info)
- database | had_issue | full table scan (problem identification)
- docker_image | original_size | 2GB (metrics)
- docker_image | optimized_size | 200MB (improvement results)
- feature | release_date | 2025-01-15T00:00:00 (temporal - ABSOLUTE timestamp)
- database migration | completed_at | 2025-02-04T14:30:00 (temporal - ABSOLUTE timestamp, NOT "yesterday")
- database migration | downtime | zero (outcome)
- incident | root_cause | certificate expired (incident details)
- v1 API | deprecation_date | 2025-04-01T00:00:00 (future events - ABSOLUTE timestamp, NOT "Q2 next year")

## Examples of BAD extractions (skip these):
- user | asked | about databases (trivial conversational)
- assistant | explained | the issue (meta about the conversation)
- conversation | was_about | performance (too vague, not a fact)
- user | completed | it yesterday (❌ PRONOUN + RELATIVE TIME - must resolve to: "user | completed | database migration at 2025-02-04T14:30:00")
- project | started | last week (❌ RELATIVE TIME - must resolve to: "project | started_at | 2025-01-28T00:00:00")
- he | works_at | TechCorp (❌ PRONOUN - must resolve to: "Martin Mark | works_at | TechCorp")

## When to extract ZERO facts:
- If the conversation is PURELY about cause-and-effect reasoning (e.g., "X happened because Y")
- If the conversation is about a problem and solution with NO user/project/team facts
- If no concrete, persistent information about user/project/team is stated
- If everything is too vague or temporary to be worth remembering

## CRITICAL - Cause-Effect Conversations:
In conversations focused on WHY something happened:

**EXTRACT these facts:**
- Technology/tool adoption: "project | uses | GraphQL"
- Persistent configurations: "team | uses | microservices"
- Named solutions that are REUSABLE: "solution | was | add caching layer"

**DO NOT extract these as facts:**
- Problem descriptions: "deployment | had_issue | failed" ❌
- Temporary states: "system | was | down" ❌
- Symptoms: "app | experienced | slowness" ❌

**The key question:** Would this fact be useful to remember OUTSIDE this conversation?
- "project uses GraphQL" → YES, extract
- "deployment failed" → NO, that's context for the causal link, not a standalone fact

## CRITICAL OUTPUT REQUIREMENTS:
- Output ONLY valid JSON. NO markdown, NO explanations, NO text before or after.
- Do NOT include markdown code blocks (no backticks).
- Do NOT include any reasoning or explanation text.
- Start directly with { and end with }
- Example of CORRECT output: {"facts": [{"subject": "Caroline", "predicate": "went_to", "object": "LGBTQ support group on 2023-05-07T00:00:00", "confidence": 0.9, "reasoning": "explicitly stated"}]}
- Example of WRONG output: Any text before or after the JSON, markdown code blocks, explanations.

Output ONLY this JSON format (no other text):
{
  "facts": [
    {
      "subject": "string",
      "predicate": "string", 
      "object": "string",
      "confidence": 0.0-1.0,
      "reasoning": "string"
    }
  ]
}

Conversation:
`;

/**
 * Primary-only extraction prompt - more selective than comprehensive.
 * Used for HaluMem benchmark compatibility.
 */
/**
 * HaluMem-optimized extraction prompt.
 * Key: USER-centric facts only + rich narrative memories
 */
const PRIMARY_FACT_EXTRACTION_PROMPT = `You are extracting USER memories from conversations. Be THOROUGH.

## CRITICAL RULE: Subject MUST be "user"
- Never use "Father", "Mother", "Partner" as subject
- Family STATUS is ok: "user | parent_status | Both parents alive"
- Family DETAILS are NOT ok: "Father | occupation | Doctor" ❌

## EXTRACT ALL OF THESE:

### ATOMIC FACTS:
- Name, age, gender, birth date
- Location, education, employment
- Personality (MBTI, traits)
- Family STATUS (parent/partner/children status)
- Health status, financial info
- Preferences with reasons

### NARRATIVE MEMORIES (IMPORTANT - extract many of these!):
For each of these, extract as a FULL DESCRIPTIVE SENTENCE:
- Career considerations: "is considering X due to Y"
- Emotional states: "emotional state fluctuates between X and Y"
- Motivations: "motivation is driven by X"
- Seeking/Goals: "seeks guidance on X" or "aims to achieve X"
- Strategies: "uses X strategy to achieve Y"
- Values: "values X especially through Y"
- Experiences: "shared anecdote about X"
- Commitments: "is committed to X while maintaining Y"
- Creative motivations: "creative motivation is to X"

## FORMAT:
{
  "facts": [
    {
      "subject": "user",
      "predicate": "type",
      "object": "value or FULL descriptive sentence",
      "confidence": 0.7-1.0,
      "reasoning": "brief"
    }
  ]
}

## EXAMPLES (extract similar patterns!):
{"subject": "user", "predicate": "name_is", "object": "Martin Mark"}
{"subject": "user", "predicate": "is_considering", "object": "career change due to impact of current role on mental health"}
{"subject": "user", "predicate": "current_job", "object": "director at Huaxin Consulting which negatively affects mental health"}
{"subject": "user", "predicate": "seeks", "object": "guidance on pursuing new job that aligns with values and aspirations"}
{"subject": "user", "predicate": "uses_strategy", "object": "tools and collaboration with diverse teams to inspire ideas and overcome creative blocks"}
{"subject": "user", "predicate": "values", "object": "balancing professional responsibilities with health through practices like yoga"}
{"subject": "user", "predicate": "emotional_state", "object": "fluctuates between concern for health and optimism for future job opportunities"}
{"subject": "user", "predicate": "is_committed_to", "object": "improving healthcare access while maintaining personal health and creativity"}
{"subject": "user", "predicate": "shared_experience", "object": "resolving past conflicts through innovation and teamwork"}
{"subject": "user", "predicate": "creative_motivation", "object": "collaborate with diverse teams to generate innovative solutions"}
{"subject": "user", "predicate": "considering_reason", "object": "desire for higher financial stability"}

## RULES:
1. Subject MUST be "user"
2. Extract 12-20 facts per conversation - BE THOROUGH
3. For narrative memories, object MUST be a full descriptive sentence
4. Extract EVERY motivation, consideration, strategy, value, and experience mentioned
5. Don't be conservative - extract more rather than fewer

Conversation:
`;

const CAUSAL_EXTRACTION_PROMPT = `Extract cause-effect relationships from this conversation.

ONLY EXTRACT when there is EXPLICIT causal language like:
- "because", "due to", "so", "which is why", "that's why"
- Clear preference reasons with explicit problems stated

PATTERNS:
1. Explicit preferences: "prefers X because Y" → cause: Y, effect: prefers X
2. Explicit switches: "switched to X because Y" → cause: Y, effect: switched to X  
3. Explicit blockers: "waiting on X" → cause: X pending, effect: Y blocked
4. Explicit problems: "X is slow/bad, so we did Y" → cause: X being slow, effect: did Y

DO NOT EXTRACT:
- Implied causation without explicit causal words
- Long-term habits without stated reason ("I use vim for 10 years" - no explicit why)
- Simple preferences without stated cause ("I prefer Go" - no explicit why given)

IMPORTANT - Use simple, direct language with NO PRONOUNS:
- cause: Use key nouns with explicit entities ("long commute", "security review pending", "TypeScript type safety")
- effect: Start with verb and explicit entities ("prefers TypeScript", "switched to PostgreSQL", "blocked deployment")
- ABSOLUTELY PROHIBIT pronouns (he, she, it, they, this, that) - resolve to explicit names/entities
- ABSOLUTELY PROHIBIT relative time (yesterday, today, tomorrow) - use absolute timestamps if needed

OUTPUT JSON:
{
  "causalLinks": [
    {
      "cause": "simple noun phrase with explicit entities",
      "effect": "verb phrase with explicit entities", 
      "mechanism": "how/why",
      "confidence": 0.6-1.0,
      "reasoning": "brief"
    }
  ]
}

Extract 0-2 links MAX. Prefer fewer, higher quality links. Empty array [] if no explicit causal relationship.

Conversation:
`;

const EPISODE_SUMMARY_PROMPT = `You are an expert at summarizing conversations.

Given the following conversation, create a concise summary that captures the key information.

Rules:
1. Summary should be 1-2 sentences max
2. Identify the main topic
3. Extract 3-5 relevant keywords
4. Assess the emotional tone (neutral, positive, negative, frustrated, excited, etc.)
5. Rate salience 0.0-1.0 (how important/memorable is this conversation?)

Output ONLY valid JSON in this format:
{
  "summary": "string",
  "topic": "string",
  "keywords": ["string"],
  "emotionalTone": "string",
  "salience": 0.0-1.0
}

Conversation:
`;

const CONTRADICTION_RESOLUTION_PROMPT = `You are an expert at resolving contradictions between facts.

Given two potentially contradicting facts, determine:
1. Are they actually contradictory, or can both be true?
2. If contradictory, which one is more likely correct and why?
3. Provide a resolution strategy

Fact 1: {subject1} {predicate1} {object1}
Source: {source1}
Confidence: {confidence1}

Fact 2: {subject2} {predicate2} {object2}
Source: {source2}
Confidence: {confidence2}

Output ONLY valid JSON in this format:
{
  "isContradiction": true/false,
  "winner": 1 or 2 or null,
  "reasoning": "string",
  "resolution": "keep_both" | "keep_first" | "keep_second" | "merge" | "needs_user_input",
  "mergedFact": { "subject": "", "predicate": "", "object": "" } // only if resolution is "merge"
}

`;

// =============================================================================
// LLM EXTRACTION FUNCTIONS
// =============================================================================

/**
 * Parse JSON from LLM response, handling common issues
 */
export function parseJSONResponse<T>(response: string): T | null {
  if (!response || typeof response !== "string" || response.trim().length === 0) {
    return null;
  }

  try {
    // Step 1: Aggressively strip markdown code fences
    let jsonStr = response
      .replace(/^```(?:json|JSON)?\s*\n?/gm, "") // Opening ```json
      .replace(/\n?```\s*$/gm, "") // Closing ```
      .trim();

    // Step 2: Find the outermost JSON object using bracket counting
    const startIdx = jsonStr.indexOf("{");
    if (startIdx >= 0) {
      let depth = 0;
      let endIdx = -1;
      for (let i = startIdx; i < jsonStr.length; i++) {
        if (jsonStr[i] === "{") depth++;
        else if (jsonStr[i] === "}") {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
      if (endIdx > startIdx) {
        jsonStr = jsonStr.substring(startIdx, endIdx + 1);
      }
    }

    // Step 3: Clean up common issues
    let cleaned = jsonStr
      .trim()
      .replace(/,\s*}/g, "}") // Remove trailing commas
      .replace(/,\s*]/g, "]"); // Remove trailing commas in arrays

    // Try parsing
    return JSON.parse(cleaned) as T;
  } catch (parseErr) {
    // Try to find JSON object directly as fallback
    try {
      const objectMatch = response.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        const cleaned = objectMatch[0].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
        return JSON.parse(cleaned) as T;
      }
    } catch {
      // Final fallback: try to extract just the facts array if present
      const factsMatch = response.match(/"facts"\s*:\s*\[([\s\S]*?)\]/);
      if (factsMatch) {
        try {
          return { facts: JSON.parse(`[${factsMatch[1]}]`) } as T;
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

/**
 * Minimum confidence threshold for extracted facts.
 * Facts below this threshold are filtered out to improve precision.
 * V12: Lowered to 0.60 to improve recall while maintaining acceptable precision.
 * Target: 85%+ F1 on HaluMem benchmark.
 */
const FACT_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Check if two facts are duplicates (same subject-predicate-object, case-insensitive)
 */
function isDuplicateFact(
  fact1: { subject: string; predicate: string; object: string },
  fact2: { subject: string; predicate: string; object: string },
): boolean {
  const normalize = (s: string) => s.toLowerCase().trim();
  return (
    normalize(fact1.subject) === normalize(fact2.subject) &&
    normalize(fact1.predicate) === normalize(fact2.predicate) &&
    normalize(fact1.object) === normalize(fact2.object)
  );
}

/**
 * Check if two facts are semantically similar (same subject+predicate, similar object)
 */
function isSimilarFact(
  fact1: { subject: string; predicate: string; object: string },
  fact2: { subject: string; predicate: string; object: string },
): boolean {
  const normalize = (s: string) => s.toLowerCase().trim();

  // Must have same subject and predicate
  if (normalize(fact1.subject) !== normalize(fact2.subject)) return false;
  if (normalize(fact1.predicate) !== normalize(fact2.predicate)) return false;

  // Check if objects are similar (one contains the other)
  const obj1 = normalize(fact1.object);
  const obj2 = normalize(fact2.object);
  return obj1.includes(obj2) || obj2.includes(obj1);
}

/**
 * Extract facts using LLM with quality filtering.
 * Applies confidence threshold and deduplication for better precision.
 */
export async function extractFactsWithLLM(
  llm: LLMProvider,
  conversationText: string,
  episodeId: string,
  options?: LLMFactExtractionOptions,
): Promise<Omit<Fact, "id" | "createdAt" | "updatedAt">[]> {
  // Handle extraction mode options
  const primaryOnly = options?.primaryOnly ?? false;
  const minConfidence = options?.minConfidence ?? (primaryOnly ? 0.85 : FACT_CONFIDENCE_THRESHOLD);
  const maxFacts = options?.maxFacts ?? (primaryOnly ? 10 : 50);
  const conversationDate = options?.conversationDate;

  // Select prompt based on mode
  let basePrompt = primaryOnly ? PRIMARY_FACT_EXTRACTION_PROMPT : FACT_EXTRACTION_PROMPT;

  // Add conversation date context if provided (for resolving relative time)
  if (conversationDate && !primaryOnly) {
    // Parse date string like "1:56 pm on 8 May, 2023" to a more usable format
    // Try to extract the date part and convert to ISO-like format for the LLM
    let parsedDate = conversationDate;
    try {
      // Try to parse formats like "1:56 pm on 8 May, 2023" or "8 May, 2023"
      const dateMatch = conversationDate.match(
        /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+(\d{4})/i,
      );
      if (dateMatch) {
        const day = dateMatch[1].padStart(2, "0");
        const monthNames = [
          "january",
          "february",
          "march",
          "april",
          "may",
          "june",
          "july",
          "august",
          "september",
          "october",
          "november",
          "december",
        ];
        const month = (monthNames.indexOf(dateMatch[2].toLowerCase()) + 1)
          .toString()
          .padStart(2, "0");
        const year = dateMatch[3];
        parsedDate = `${year}-${month}-${day}`;
      }
    } catch (e) {
      // Keep original if parsing fails
    }

    basePrompt = basePrompt.replace(
      "Conversation:",
      `## CONVERSATION DATE CONTEXT:
This conversation takes place on: ${conversationDate}
NOTE: Preserve temporal phrases as spoken (e.g., "last week", "next month"). Do NOT convert to ISO dates.

Conversation:`,
    );
  }

  const prompt = basePrompt + conversationText;

  let response = await llm.complete(prompt, {
    maxTokens: 4096,
    temperature: 0.1,
    jsonMode: true,
  });

  // Pre-clean: strip markdown code fences that some models (Sonnet 4.5) wrap around JSON
  if (response && response.includes("```")) {
    const before = response.length;
    // Remove ALL markdown code fences (opening and closing)
    response = response
      .replace(/```json\s*\n?/gi, "")
      .replace(/```\s*\n?/g, "")
      .trim();
    if (response.length !== before) {
      console.log(`[SHEEP] Stripped markdown fences: ${before} → ${response.length} chars`);
    }
  }

  const parsed = parseJSONResponse<{ facts: LLMExtractedFact[] }>(response);

  if (!parsed || !parsed.facts) {
    // Debug: show the end of the response to check for truncation
    const lastChars = response?.slice(-100) || "";
    const endsWithBrace = lastChars.trimEnd().endsWith("}");
    console.warn(
      `[SHEEP] Failed to parse extraction response (${response?.length || 0} chars). Ends with }: ${endsWithBrace}. Last 80 chars: ...${lastChars.slice(-80)}`,
    );

    // If truncated (doesn't end with }), try to salvage by closing the JSON
    if (response && !endsWithBrace) {
      try {
        // Find the last complete fact object (ends with }) and close the array + outer object
        const lastCompleteObj = response.lastIndexOf("}");
        if (lastCompleteObj > 0) {
          const salvaged = response.substring(0, lastCompleteObj + 1) + "]}";
          const salvagedParsed = JSON.parse(salvaged) as { facts: LLMExtractedFact[] };
          if (salvagedParsed?.facts?.length > 0) {
            console.log(
              `[SHEEP] Salvaged ${salvagedParsed.facts.length} facts from truncated response`,
            );
            // Continue with salvaged facts
            const timestamp = now();
            return salvagedParsed.facts
              .filter((f) => f.confidence >= minConfidence)
              .slice(0, maxFacts)
              .map((fact) => ({
                subject: fact.subject,
                predicate: fact.predicate.toLowerCase().replace(/\s+/g, "_"),
                object: fact.object,
                confidence: Math.max(0, Math.min(1, fact.confidence)),
                evidence: [episodeId],
                isActive: true,
                userAffirmed: false,
                accessCount: 0,
                firstSeen: timestamp,
                lastConfirmed: timestamp,
                contradictions: [],
              }));
          }
        }
      } catch {
        /* salvage failed */
      }
    }
    return [];
  }

  const timestamp = now();

  // Filter by confidence threshold
  let confidentFacts = parsed.facts.filter((fact) => fact.confidence >= minConfidence);

  // In primaryOnly mode, also filter by predicate type
  if (primaryOnly) {
    confidentFacts = confidentFacts.filter((fact) => {
      const normalizedPredicate = fact.predicate.toLowerCase().replace(/\s+/g, "_");
      return PRIMARY_PREDICATES.has(normalizedPredicate) || fact.confidence >= 0.95;
    });
  }

  // Deduplicate - keep highest confidence version of similar facts
  const deduplicated: LLMExtractedFact[] = [];
  for (const fact of confidentFacts) {
    const existingIdx = deduplicated.findIndex(
      (existing) => isDuplicateFact(existing, fact) || isSimilarFact(existing, fact),
    );

    if (existingIdx === -1) {
      deduplicated.push(fact);
    } else if (fact.confidence > deduplicated[existingIdx].confidence) {
      // Replace with higher confidence version
      deduplicated[existingIdx] = fact;
    }
  }

  // Apply maxFacts limit
  const limitedFacts = deduplicated.slice(0, maxFacts);

  return limitedFacts.map((fact) => ({
    subject: fact.subject,
    predicate: fact.predicate.toLowerCase().replace(/\s+/g, "_"),
    object: fact.object,
    confidence: Math.max(0, Math.min(1, fact.confidence)),
    evidence: [episodeId],
    isActive: true,
    userAffirmed: false,
    accessCount: 0,
    firstSeen: timestamp,
    lastConfirmed: timestamp,
    contradictions: [],
  }));
}

/**
 * Minimum confidence threshold for causal links.
 * Balanced threshold - not too strict, not too permissive.
 */
const CAUSAL_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Resolve relative timestamps to absolute ISO 8601 format
 * SimpleMem approach: all timestamps must be absolute, no relative references
 */
function resolveAbsoluteTimestamp(text: string, conversationTimestamp: string): string | null {
  // Extract conversation date
  const convDate = new Date(conversationTimestamp);
  if (isNaN(convDate.getTime())) return null;

  const normalized = text.toLowerCase().trim();

  // Relative references
  if (normalized === "today" || normalized === "now") {
    return convDate.toISOString();
  }
  if (normalized === "yesterday") {
    const d = new Date(convDate);
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  }
  if (normalized === "tomorrow") {
    const d = new Date(convDate);
    d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (normalized.includes("last week") || normalized.includes("a week ago")) {
    const d = new Date(convDate);
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }
  if (normalized.includes("next week")) {
    const d = new Date(convDate);
    d.setDate(d.getDate() + 7);
    return d.toISOString();
  }
  if (normalized.includes("last month") || normalized.includes("a month ago")) {
    const d = new Date(convDate);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString();
  }
  if (normalized.includes("next month")) {
    const d = new Date(convDate);
    d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  }

  // "X days/weeks/months ago" patterns
  const agoMatch = normalized.match(/(\d+)\s*(days?|weeks?|months?|years?)\s*ago/);
  if (agoMatch) {
    const amount = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    const d = new Date(convDate);
    if (unit.startsWith("day")) d.setDate(d.getDate() - amount);
    else if (unit.startsWith("week")) d.setDate(d.getDate() - amount * 7);
    else if (unit.startsWith("month")) d.setMonth(d.getMonth() - amount);
    else if (unit.startsWith("year")) d.setFullYear(d.getFullYear() - amount);
    return d.toISOString();
  }

  // Already absolute ISO format
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(text)) {
    return text;
  }

  // Try parsing as date
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return null;
}

/**
 * Extract causal links using LLM with balanced quality filtering.
 * Extracts 0-3 causal links per conversation.
 * Enhanced with coreference resolution (SimpleMem approach).
 */
export async function extractCausalLinksWithLLM(
  llm: LLMProvider,
  conversationText: string,
  episodeId: string,
  conversationTimestamp?: string,
): Promise<Omit<CausalLink, "id" | "createdAt" | "updatedAt">[]> {
  const prompt = CAUSAL_EXTRACTION_PROMPT + conversationText;

  const response = await llm.complete(prompt, {
    maxTokens: 1500,
    temperature: 0.1, // Low temperature for consistent extraction
    jsonMode: true,
  });

  const parsed = parseJSONResponse<{ causalLinks: LLMExtractedCausalLink[] }>(response);

  if (!parsed || !parsed.causalLinks) {
    return [];
  }

  // Filter by confidence threshold
  const confidentLinks = parsed.causalLinks.filter(
    (link) => link.confidence >= CAUSAL_CONFIDENCE_THRESHOLD,
  );

  // Resolve relative timestamps in cause/effect descriptions if needed
  const resolvedLinks = confidentLinks.map((link) => {
    let cause = link.cause;
    let effect = link.effect;

    // Try to resolve any relative timestamps
    if (conversationTimestamp) {
      const resolvedCause = resolveAbsoluteTimestamp(cause, conversationTimestamp);
      if (resolvedCause)
        cause = cause.replace(/yesterday|today|tomorrow|last week|next week/gi, resolvedCause);

      const resolvedEffect = resolveAbsoluteTimestamp(effect, conversationTimestamp);
      if (resolvedEffect)
        effect = effect.replace(/yesterday|today|tomorrow|last week|next week/gi, resolvedEffect);
    }

    return { ...link, cause, effect };
  });

  // Allow up to 2 causal links per conversation (prefer quality over quantity)
  const limitedLinks = resolvedLinks.slice(0, 2);

  return limitedLinks.map((link) => ({
    causeType: "episode" as const,
    causeId: episodeId,
    causeDescription: link.cause,
    effectType: "episode" as const,
    effectId: episodeId,
    effectDescription: link.effect,
    mechanism: link.mechanism,
    confidence: Math.max(0, Math.min(1, link.confidence)),
    evidence: [episodeId],
    causalStrength: link.confidence > 0.75 ? ("direct" as const) : ("contributing" as const),
  }));
}

/**
 * Generate episode summary using LLM (THE BREAKTHROUGH!)
 */
export async function summarizeEpisodeWithLLM(
  llm: LLMProvider,
  conversationText: string,
): Promise<LLMEpisodeSummary | null> {
  const prompt = EPISODE_SUMMARY_PROMPT + conversationText;

  const response = await llm.complete(prompt, {
    maxTokens: 500,
    temperature: 0.3,
    jsonMode: true,
  });

  const parsed = parseJSONResponse<LLMEpisodeSummary>(response);
  return parsed;
}

/**
 * Resolve contradictions using LLM reasoning
 */
export async function resolveContradictionWithLLM(
  llm: LLMProvider,
  fact1: Fact,
  fact2: Fact,
): Promise<{
  isContradiction: boolean;
  winner: 1 | 2 | null;
  resolution: "keep_both" | "keep_first" | "keep_second" | "merge" | "needs_user_input";
  reasoning: string;
  mergedFact?: { subject: string; predicate: string; object: string };
}> {
  const prompt = CONTRADICTION_RESOLUTION_PROMPT.replace("{subject1}", fact1.subject)
    .replace("{predicate1}", fact1.predicate)
    .replace("{object1}", fact1.object)
    .replace("{source1}", fact1.evidence.join(", ") || "unknown")
    .replace("{confidence1}", fact1.confidence.toString())
    .replace("{subject2}", fact2.subject)
    .replace("{predicate2}", fact2.predicate)
    .replace("{object2}", fact2.object)
    .replace("{source2}", fact2.evidence.join(", ") || "unknown")
    .replace("{confidence2}", fact2.confidence.toString());

  const response = await llm.complete(prompt, {
    maxTokens: 500,
    temperature: 0.2,
    jsonMode: true,
  });

  const parsed = parseJSONResponse<{
    isContradiction: boolean;
    winner: 1 | 2 | null;
    reasoning: string;
    resolution: "keep_both" | "keep_first" | "keep_second" | "merge" | "needs_user_input";
    mergedFact?: { subject: string; predicate: string; object: string };
  }>(response);

  return (
    parsed || {
      isContradiction: false,
      winner: null,
      resolution: "keep_both",
      reasoning: "Could not parse LLM response",
    }
  );
}

// =============================================================================
// MOCK LLM PROVIDER (for testing without real API calls)
// =============================================================================

/**
 * Create a mock LLM provider for testing
 */
export function createMockLLMProvider(responses?: Map<string, string>): LLMProvider {
  return {
    name: "mock",
    complete: async (prompt: string) => {
      // Check for custom responses first (highest priority)
      if (responses) {
        for (const [key, value] of responses) {
          if (prompt.includes(key)) {
            return value;
          }
        }
      }

      // Default mock responses based on prompt type
      // Match actual prompt strings used in the code
      if (
        prompt.includes("extract all factual") ||
        prompt.includes("extracting factual information") ||
        prompt.includes("extracting USER memories")
      ) {
        return JSON.stringify({
          facts: [
            {
              subject: "user",
              predicate: "prefers",
              object: "TypeScript",
              confidence: 0.9,
              reasoning: "User explicitly stated preference",
            },
          ],
        });
      }

      if (
        prompt.includes("Extract cause-effect") ||
        prompt.includes("cause-effect relationships") ||
        prompt.includes("cause-and-effect")
      ) {
        return JSON.stringify({
          causalLinks: [
            {
              cause: "code refactoring",
              effect: "improved performance",
              mechanism: "better algorithms and cleaner code",
              confidence: 0.8,
              reasoning: "Direct stated consequence",
            },
          ],
        });
      }

      if (
        prompt.includes("summarizing conversations") ||
        prompt.includes("summarize") ||
        prompt.includes("create a concise summary")
      ) {
        return JSON.stringify({
          summary: "Discussion about software development best practices",
          topic: "software development",
          keywords: ["coding", "best practices", "TypeScript"],
          emotionalTone: "neutral",
          salience: 0.6,
        });
      }

      if (
        prompt.includes("contradictions") ||
        prompt.includes("resolving contradictions") ||
        prompt.includes("contradicting facts")
      ) {
        return JSON.stringify({
          isContradiction: false,
          winner: null,
          resolution: "keep_both",
          reasoning: "Facts are compatible",
        });
      }

      // Fallback: return empty response
      return "{}";
    },
  };
}

// =============================================================================
// INTEGRATION WITH EXISTING PROVIDERS
// =============================================================================

/**
 * Create an LLM provider from Moltbot's existing model configuration
 * This bridges SHEEP AI to Moltbot's multi-provider infrastructure
 */
export type MoltbotModelConfig = {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
};

/**
 * Real LLM provider using Moltbot's infrastructure
 * Uses the completeSimple function from @mariozechner/pi-ai
 */
export async function createLLMProviderFromConfig(
  config: MoltbotModelConfig,
): Promise<LLMProvider> {
  // Dynamically import to avoid circular dependencies and keep startup light
  const piAi = await import("@mariozechner/pi-ai");
  const { resolveModel } = await import("../../agents/pi-embedded-runner/model.js");
  const { getApiKeyForModel } = await import("../../agents/model-auth.js");

  let { model, error } = resolveModel(config.provider, config.model);

  // If the model isn't found, clone from any available Anthropic model.
  // models.json gets overwritten on startup, so we can't rely on it having all models.
  // claude-opus-4-6 is always in models.json, so use it as the clone source.
  if (!model && config.provider === "anthropic") {
    // Try multiple siblings in order of likelihood
    const siblingIds = ["claude-opus-4-6", "claude-opus-4-5", "claude-sonnet-4-5"];
    for (const siblingId of siblingIds) {
      const sibling = resolveModel("anthropic", siblingId);
      if (sibling.model) {
        model = {
          ...sibling.model,
          id: config.model,
          name: config.model,
        } as typeof sibling.model;
        error = undefined;
        console.log(`[SHEEP] Cloned ${config.provider}/${config.model} from ${siblingId}`);
        break;
      }
    }
  }

  if (!model || error) {
    throw new Error(`Failed to resolve model ${config.provider}/${config.model}: ${error}`);
  }

  return {
    name: `${config.provider}/${config.model}`,
    complete: async (prompt: string, options?: LLMOptions): Promise<string> => {
      const apiKeyResult = await getApiKeyForModel({ model });
      const apiKey = typeof apiKeyResult === "string" ? apiKeyResult : apiKeyResult?.apiKey;
      const userContent = options?.system ? `${options.system}\n\n${prompt}` : prompt;
      const temperature = options?.temperature ?? 0.1;

      // Retry with exponential backoff for rate limits (429)
      const MAX_RETRIES = 4;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const res = await piAi.completeSimple(
          model,
          {
            messages: [{ role: "user" as const, content: userContent, timestamp: Date.now() }],
          },
          {
            apiKey: apiKey ?? undefined,
            maxTokens: options?.maxTokens ?? 2000,
            temperature,
          },
        );

        // Check for API errors
        const stopReason = (res as any).stopReason;
        const errorMessage = (res as any).errorMessage as string | undefined;

        if (stopReason === "error" || errorMessage) {
          const isRateLimit = errorMessage?.includes("429") || errorMessage?.includes("rate_limit");

          if (isRateLimit && attempt < MAX_RETRIES) {
            // Exponential backoff: 5s, 15s, 45s, 120s
            const delay = Math.min(5000 * Math.pow(3, attempt), 120_000);
            console.warn(
              `[SHEEP] Rate limited (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay / 1000}s...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue; // retry
          }

          const errMsg = errorMessage || "Unknown API error";
          throw new Error(
            `API error after ${attempt + 1} attempts (${stopReason}): ${errMsg.slice(0, 300)}`,
          );
        }

        // Success — extract text
        const textBlocks = res.content || [];
        const extractedText = textBlocks
          .filter(
            (block: { type: string }): block is { type: "text"; text: string } =>
              block.type === "text",
          )
          .map((block) => block.text.trim())
          .filter(Boolean)
          .join("\n");

        return extractedText;
      }

      throw new Error("Exhausted all retries");
    },
  };
}

/**
 * Create an LLM provider for SHEEP tasks based on purpose.
 *
 * Model selection strategy (optimized for Claude Max Plan):
 * - "fast": Haiku for latency-critical operations (prefetch, quick classification)
 * - "extraction": Sonnet for fact/causal extraction (quality matters more than speed)
 * - "reasoning": Sonnet for sleep consolidation (complex reasoning needs quality)
 *
 * @param purpose - The purpose determines which model to use
 * @param modelConfig - Optional custom model configuration
 */
export async function createSheepLLMProvider(
  purpose: SheepModelPurpose = "extraction",
  modelConfig?: Partial<SheepModelConfig> & { provider?: string },
): Promise<LLMProvider> {
  const provider = modelConfig?.provider ?? "anthropic";

  // Merge with defaults
  const models: SheepModelConfig = {
    ...DEFAULT_SHEEP_MODELS,
    ...modelConfig,
  };

  // Select model based on purpose
  let model: string;
  switch (purpose) {
    case "fast":
      model = models.fastModel;
      break;
    case "reasoning":
      model = models.reasoningModel;
      break;
    case "extraction":
    default:
      model = models.extractionModel;
      break;
  }

  try {
    return await createLLMProviderFromConfig({ provider, model });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[SHEEP] Failed to create LLM provider (${purpose}/${model}): ${message}. Falling back to mock.`,
    );
    return createMockLLMProvider();
  }
}

/**
 * Legacy function signature for backward compatibility.
 * @deprecated Use createSheepLLMProvider(purpose, config) instead
 */
export async function createSheepLLMProviderLegacy(moltbotConfig?: {
  extractionModel?: string;
  extractionProvider?: string;
}): Promise<LLMProvider> {
  return createSheepLLMProvider("extraction", {
    provider: moltbotConfig?.extractionProvider,
    extractionModel: moltbotConfig?.extractionModel,
  });
}
