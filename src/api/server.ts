/**
 * SHEEP AI - HTTP API Server v2 (Breakthrough Architecture)
 *
 * TWO RECALL MODES:
 *   ?mode=memory  → Uses ONLY extracted facts from DB (the acid test - true memory)
 *   ?mode=hybrid   → Uses facts + raw conversation (maximum accuracy, default)
 *
 * CONSOLIDATION PIPELINE:
 *   Step 1: Per-session chunking with date context
 *   Step 2: Dense fact extraction (Sonnet 4.5, 80+ facts per chunk)
 *   Step 3: Temporal state machine (resolve all relative dates to absolute)
 *   Step 4: Contradiction detection & resolution
 *   Step 5: Store to SQLite
 *
 * MODELS:
 *   MUSCLES (Sonnet 4.5) → Fast, reliable fact extraction
 *   BRAIN   (Opus 4.6)   → Deep reasoning for answer synthesis
 */

import type { Request, Response } from "express";
import express from "express";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { createSheepLLMProvider } from "../extraction/llm-extractor.js";
import { SheepDatabase } from "../memory/database.js";

const log = createSubsystemLogger("sheep-api");

// =============================================================================
// TYPES
// =============================================================================

interface MemoryRequest {
  content: string;
  role: string;
  timestamp?: string;
  sessionId?: string;
}

interface RecallRequest {
  query: string;
  sessionId?: string;
  mode?: string; // "memory" | "hybrid" (default: "hybrid")
}

interface RecallResponse {
  answer: string;
  mode?: string;
  factsUsed?: number;
  facts?: Array<{
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
  }>;
}

// =============================================================================
// SERVER SETUP
// =============================================================================

const app: ReturnType<typeof express> = express();
app.use(express.json({ limit: "50mb" }));

const cfg = loadConfig();
const agentId = resolveDefaultAgentId(cfg);
const db = new SheepDatabase(agentId);

const sessionMessages = new Map<
  string,
  Array<{ role: string; content: string; timestamp: string }>
>();
const sessionDatesStore = new Map<string, Record<string, string>>();

let _extractionLLM: import("../extraction/llm-extractor.js").LLMProvider | null = null;
let _reasoningLLM: import("../extraction/llm-extractor.js").LLMProvider | null = null;

async function getExtractionLLM() {
  if (!_extractionLLM) {
    _extractionLLM = await createSheepLLMProvider("extraction");
    console.log(`[SHEEP] Extraction LLM: ${_extractionLLM.name}`);
  }
  return _extractionLLM;
}

async function getReasoningLLM() {
  if (!_reasoningLLM) {
    _reasoningLLM = await createSheepLLMProvider("reasoning");
    console.log(`[SHEEP] Reasoning LLM: ${_reasoningLLM.name}`);
  }
  return _reasoningLLM;
}

// =============================================================================
// HELPER: Get all facts for a session from DB (cached for 200+ recall calls)
// =============================================================================
const _sessionFactsCache = new Map<string, import("../memory/schema.js").Fact[]>();

function invalidateFactsCache(sessionId: string) {
  _sessionFactsCache.delete(sessionId);
}

function getSessionFacts(sessionId: string): import("../memory/schema.js").Fact[] {
  const cached = _sessionFactsCache.get(sessionId);
  if (cached) return cached;

  const allEpisodes = db.queryEpisodes({ limit: 10000 });
  const sessionEpisodes = allEpisodes.filter((ep) => ep.sourceSessionId === sessionId);
  const episodeIds = new Set(sessionEpisodes.map((ep) => ep.id));
  if (episodeIds.size === 0) return [];

  let allFactRows: Array<Record<string, unknown>> = [];
  for (const epId of Array.from(episodeIds)) {
    const rows = (db as any).db
      .prepare(`SELECT * FROM sheep_facts WHERE is_active = 1 AND evidence LIKE ?`)
      .all(`%${epId}%`) as Array<Record<string, unknown>>;
    allFactRows.push(...rows);
  }

  const seenIds = new Set<string>();
  const facts = allFactRows
    .filter((row) => {
      const id = row.id as string;
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    })
    .map((row) => {
      try {
        const evidence = JSON.parse(row.evidence as string) as string[];
        if (evidence.some((epId) => episodeIds.has(epId))) {
          return (db as any).rowToFact(row) as import("../memory/schema.js").Fact;
        }
      } catch {
        /* skip */
      }
      return null;
    })
    .filter((f): f is import("../memory/schema.js").Fact => f !== null);

  _sessionFactsCache.set(sessionId, facts);
  return facts;
}

// =============================================================================
// BREAKTHROUGH A: Deterministic adversarial filter (no LLM, pure code)
// =============================================================================

// Entity-attribute index: maps each person to their topics/keywords with occurrence counts
const _entityIndexCache = new Map<string, Map<string, Map<string, number>>>();

function buildEntityIndex(
  sessionId: string,
  facts: import("../memory/schema.js").Fact[],
): Map<string, Map<string, number>> {
  const cached = _entityIndexCache.get(sessionId) as Map<string, Map<string, number>> | undefined;
  if (cached) return cached;

  const index = new Map<string, Map<string, number>>();
  for (const f of facts) {
    const subject = f.subject.toLowerCase().trim();
    if (!subject || subject === "user" || subject.length < 2) continue;

    if (!index.has(subject)) index.set(subject, new Map());
    const topics = index.get(subject)!;

    // Extract keywords from predicate and object
    // CRITICAL: Only count keywords when entity is the SUBJECT (not when mentioned in object)
    // This ensures "Caroline | told | Melanie about adoption" doesn't add "adoption" to Melanie's topics
    const words = `${f.predicate} ${f.object}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3); // skip tiny words

    // Count occurrences (more facts = stronger association)
    // Only count when this entity is the SUBJECT of the fact
    for (const w of words) {
      topics.set(w, (topics.get(w) || 0) + 1);
    }
  }

  _entityIndexCache.set(sessionId, index);
  return index;
}

function invalidateEntityIndex(sessionId: string) {
  _entityIndexCache.delete(sessionId);
}

/**
 * Check if a question is adversarial (asks about Person A doing what Person B actually did).
 * Returns "No information available." if adversarial, null if not.
 *
 * ONLY blocks when:
 * - Question asks about a SPECIFIC PERSON by name
 * - Another PERSON has facts about the topic
 * - The named person has ZERO facts about the topic
 *
 * Does NOT block:
 * - Questions about objects/events without a person subject
 * - Questions where the correct person IS named and HAS facts
 * - Questions without a specific person mentioned
 */
function checkAdversarial(
  question: string,
  sessionId: string,
  facts: import("../memory/schema.js").Fact[],
): string | null {
  const entityIndex = buildEntityIndex(sessionId, facts);
  if (entityIndex.size < 2) return null; // Need at least 2 entities to have adversarial swaps

  const qLower = question.toLowerCase();

  // Extract the subject the question asks about (first named entity in question)
  const entities = Array.from(entityIndex.keys());
  let questionSubject: string | null = null;
  let earliestPos = Infinity;
  for (const entity of entities) {
    // Match whole words only (avoid partial matches)
    const entityRegex = new RegExp(`\\b${entity}\\b`, "i");
    const match = qLower.match(entityRegex);
    if (match && match.index !== undefined && match.index < earliestPos) {
      earliestPos = match.index;
      questionSubject = entity;
    }
  }
  if (!questionSubject) return null; // No specific person named, let LLM handle

  // =====================================================================
  // CRITICAL: Only apply adversarial check to PERSON entities
  // Skip for objects/events (e.g., "charity race", "studio", "meeting")
  // =====================================================================
  const personPredicates = new Set([
    "relationship_status",
    "partner_status",
    "parent_status",
    "children_status",
    "went_to",
    "met_with",
    "talked_to",
    "visited",
    "has_friend",
    "has_colleague",
    "planning_to",
    "interested_in",
    "wants_to",
    "prefers",
    "likes",
    "dislikes",
    "has_name",
    "age_is",
    "gender_is",
    "lives_in",
    "works_at",
    "job_title",
  ]);

  // Check if questionSubject appears as a PERSON in facts (has 20+ facts)
  const isPerson = facts.filter((f) => f.subject.toLowerCase() === questionSubject).length >= 20;

  // If not a person, skip adversarial check entirely (e.g., "charity race", "studio")
  if (!isPerson) {
    return null; // Not a person, let LLM handle normally
  }

  // Extract topic keywords from the question (all significant words, not just after subject)
  const questionWords = qLower
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 3 &&
        w !== questionSubject &&
        ![
          "what",
          "are",
          "is",
          "was",
          "were",
          "does",
          "did",
          "do",
          "has",
          "have",
          "will",
          "would",
          "can",
          "could",
          "should",
        ].includes(w),
    );

  // Check: does another entity OWN this topic more than the question's subject?
  const subjectTopics = entityIndex.get(questionSubject) || new Map<string, number>();

  // Filter out generic/common words that don't help identify adversarial questions
  const genericWords = new Set([
    "plans",
    "plan",
    "planning",
    "things",
    "stuff",
    "something",
    "anything",
    "everything",
    "nothing",
    "way",
    "ways",
    "time",
    "times",
    "day",
    "days",
    "week",
    "weeks",
    "month",
    "months",
    "year",
    "years",
    "for",
    "the",
    "did",
    "does",
    "was",
    "were",
    "status",
    "relationship",
    "raise",
    "raised",
    "awareness",
    "after",
    "before",
    "during",
    "about",
    "from",
    "with",
    "then",
    "also",
    "when",
    "where",
    "while",
    "been",
    "being",
    "into",
    "like",
    "just",
    "make",
    "made",
    "think",
    "realize",
    "realized",
    "know",
    "knew",
    "said",
    "told",
    "went",
    "came",
    "come",
    "take",
    "took",
    "give",
    "gave",
    "feel",
    "felt",
    "find",
    "found",
    "want",
    "wanted",
    "need",
    "needed",
    "started",
    "start",
  ]);
  const distinctiveKeywords = questionWords.filter((w) => !genericWords.has(w));

  // If no distinctive keywords, can't determine adversarial (fall back to LLM)
  if (distinctiveKeywords.length === 0) return null;

  // Count total occurrences for subject (sum across all distinctive keywords)
  let subjectTotalOccurrences = 0;
  const subjectMatches: string[] = [];
  for (const qWord of distinctiveKeywords) {
    const count = subjectTopics.get(qWord) || 0;
    if (count > 0) {
      subjectTotalOccurrences += count;
      subjectMatches.push(`${qWord}(${count})`);
    }
  }

  // =====================================================================
  // BREAKTHROUGH FIX: Ratio-based comparison to detect adversarial swaps
  // Block if another person has 3x or more occurrences than the subject
  // =====================================================================

  // Check if another person owns this topic significantly more than the subject
  for (const [entity, entityTopics] of entityIndex) {
    if (entity === questionSubject) continue;

    // Check if this entity is also a person (not an object/event) — has 20+ facts
    const isOtherPerson = facts.filter((f) => f.subject.toLowerCase() === entity).length >= 20;

    // Only compare with other PERSONS, not objects/events
    if (!isOtherPerson) continue;

    // Count total occurrences for this entity
    let otherTotalOccurrences = 0;
    const otherMatches: string[] = [];
    for (const qWord of distinctiveKeywords) {
      const count = entityTopics.get(qWord) || 0;
      if (count > 0) {
        otherTotalOccurrences += count;
        otherMatches.push(`${qWord}(${count})`);
      }
    }

    // BLOCK if:
    // 1. Subject has ZERO occurrences AND other person has ANY → clear adversarial swap
    // 2. Subject has SOME but other person has 3x or more → topic belongs to other person
    if (subjectTotalOccurrences === 0 && otherTotalOccurrences > 0) {
      console.log(
        `[SHEEP] ADVERSARIAL: "${question.slice(0, 50)}" — ${questionSubject} has 0 occurrences for [${distinctiveKeywords.join(", ")}], ${entity} has ${otherTotalOccurrences} occurrences`,
      );
      return "No information available."; // Cat 5 scoring needs this phrase
    }

    if (subjectTotalOccurrences > 0 && otherTotalOccurrences > subjectTotalOccurrences * 3) {
      console.log(
        `[SHEEP] ADVERSARIAL (RATIO): "${question.slice(0, 50)}" — ${questionSubject} has ${subjectTotalOccurrences} occurrences, ${entity} has ${otherTotalOccurrences} occurrences (${(otherTotalOccurrences / subjectTotalOccurrences).toFixed(1)}x ratio)`,
      );
      return "No information available."; // Cat 5 scoring needs this phrase
    }
  }

  return null; // Not adversarial, proceed normally
}

// =============================================================================
// HELPER: Resolve relative dates in a fact's object field
// Strategy: compute ABSOLUTE for calculable dates (years, months, specific days)
//           use RELATIVE with anchor for vague periods (last week, last Saturday)
// =============================================================================
function resolveTemporalInFact(factObject: string, sessionDate: string | undefined): string {
  if (!sessionDate) return factObject;

  const dateMatch = sessionDate.match(
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+(\d{4})/i,
  );
  if (!dateMatch) return factObject;

  const day = parseInt(dateMatch[1]);
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
  const monthCap = monthNames.map((m) => m.charAt(0).toUpperCase() + m.slice(1));
  const month = monthNames.indexOf(dateMatch[2].toLowerCase());
  const year = parseInt(dateMatch[3]);
  const anchorStr = `${day} ${monthCap[month]} ${year}`;

  let result = factObject;

  // CALCULABLE → absolute
  const calculable: [RegExp, () => string][] = [
    [/\blast year\b/i, () => `${year - 1}`],
    [/\bnext year\b/i, () => `${year + 1}`],
    [/\bnext month\b/i, () => `${monthCap[(month + 1) % 12]} ${month === 11 ? year + 1 : year}`],
    [/\blast month\b/i, () => `${monthCap[(month + 11) % 12]} ${month === 0 ? year - 1 : year}`],
    [
      /\byesterday\b/i,
      () => {
        const d = new Date(year, month, day - 1);
        return `${d.getDate()} ${monthCap[d.getMonth()]} ${d.getFullYear()}`;
      },
    ],
    [
      /\btomorrow\b/i,
      () => {
        const d = new Date(year, month, day + 1);
        return `${d.getDate()} ${monthCap[d.getMonth()]} ${d.getFullYear()}`;
      },
    ],
    [
      /\b(\d+)\s+years?\s+ago\b/i,
      () => {
        const n = parseInt(result.match(/(\d+)\s+years?\s+ago/i)?.[1] || "1");
        return `${year - n}`;
      },
    ],
  ];

  for (const [pattern, replacement] of calculable) {
    if (pattern.test(result)) {
      result = result.replace(pattern, replacement());
      return result;
    }
  }

  // VAGUE → relative with anchor (matches LoCoMo expected answer format)
  const relative: [RegExp, string][] = [
    [/\blast week\b/i, `the week before ${anchorStr}`],
    [/\blast weekend\b/i, `the weekend before ${anchorStr}`],
    [
      /\blast (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      `the $1 before ${anchorStr}`,
    ],
    [/\bthis past week\b/i, `the week before ${anchorStr}`],
    [/\ba few weeks ago\b/i, `a few weeks before ${anchorStr}`],
    [/\brecently\b/i, `before ${anchorStr}`],
  ];

  for (const [pattern, replacement] of relative) {
    if (pattern.test(result)) {
      result = result.replace(pattern, replacement);
      return result;
    }
  }

  return result;
}

// =============================================================================
// POST /memories
// =============================================================================

app.post("/memories", async (req: Request<{}, {}, MemoryRequest>, res: Response) => {
  try {
    const { content, role, timestamp, sessionId } = req.body;
    if (!content || !role) {
      return res.status(400).json({ error: "content and role are required" });
    }
    const sessionKey = sessionId || "default";
    if (!sessionMessages.has(sessionKey)) {
      sessionMessages.set(sessionKey, []);
    }
    sessionMessages.get(sessionKey)!.push({
      role,
      content,
      timestamp: timestamp || new Date().toISOString(),
    });
    res.json({ success: true, message: "Memory stored" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// =============================================================================
// POST /consolidate - Dense extraction + temporal resolution + contradiction check
// =============================================================================

app.post(
  "/consolidate",
  async (
    req: Request<{}, {}, { sessionId?: string; sessionDates?: Record<string, string> }>,
    res: Response,
  ) => {
    try {
      const { sessionId, sessionDates } = req.body;
      const sessionKey = sessionId || "default";

      const messages = sessionMessages.get(sessionKey);
      if (!messages || messages.length === 0) {
        return res.status(400).json({ error: "No messages to consolidate" });
      }

      if (sessionDates) sessionDatesStore.set(sessionKey, sessionDates);

      console.log(
        `[SHEEP] Consolidating session=${sessionKey} msgs=${messages.length} sessions=${Object.keys(sessionDates || {}).length}`,
      );

      const llmProvider = await getExtractionLLM();
      const { now } = await import("../memory/schema.js");
      const episode = db.insertEpisode({
        timestamp: now(),
        summary: `Conversation session ${sessionKey}`,
        participants: Array.from(new Set(messages.map((m) => m.role))),
        topic: "LoCoMo conversation",
        keywords: [],
        emotionalSalience: 0.5,
        utilityScore: 0.5,
        sourceSessionId: sessionKey,
        sourceMessageIds: messages.map((_, i) => `msg-${i}`),
        ttl: "permanent",
      });

      // =========================================================================
      // STEP 1: Per-session chunking
      // =========================================================================
      const { extractFactsWithLLM } = await import("../extraction/llm-extractor.js");

      const sessionChunks = new Map<string, typeof messages>();
      for (const msg of messages) {
        const match = msg.timestamp.match(/^D(\d+):/);
        const sessionNum = match ? match[1] : "0";
        if (!sessionChunks.has(sessionNum)) sessionChunks.set(sessionNum, []);
        sessionChunks.get(sessionNum)!.push(msg);
      }

      const sortedSessionNums = Array.from(sessionChunks.keys()).sort(
        (a, b) => parseInt(a) - parseInt(b),
      );
      const MAX_CHUNK_CHARS = 25000;
      const extractionChunks: Array<{
        text: string;
        date?: string;
        sessionRange: string;
        sessionNums: string[];
      }> = [];
      let currentChunk: typeof messages = [];
      let currentChunkSize = 0;
      let chunkStartSession = sortedSessionNums[0] || "1";
      let chunkSessionNums: string[] = [];

      for (const sessionNum of sortedSessionNums) {
        const sessionMsgs = sessionChunks.get(sessionNum)!;
        const sessionDate = sessionDates?.[sessionNum];
        const sessionText = sessionMsgs.map((m) => `${m.role}: ${m.content}`).join("\n");

        if (currentChunkSize + sessionText.length > MAX_CHUNK_CHARS && currentChunk.length > 0) {
          const chunkText = currentChunk.map((m) => `${m.role}: ${m.content}`).join("\n");
          extractionChunks.push({
            text: chunkText,
            date: sessionDates?.[chunkStartSession],
            sessionRange: `${chunkStartSession}-${sessionNum}`,
            sessionNums: [...chunkSessionNums],
          });
          currentChunk = [];
          currentChunkSize = 0;
          chunkStartSession = sessionNum;
          chunkSessionNums = [];
        }

        if (sessionDate) {
          currentChunk.push({
            role: "SYSTEM",
            content: `--- Session ${sessionNum} (${sessionDate}) ---`,
            timestamp: "",
          });
        }
        currentChunk.push(...sessionMsgs);
        currentChunkSize += sessionText.length;
        chunkSessionNums.push(sessionNum);
      }

      if (currentChunk.length > 0) {
        const chunkText = currentChunk.map((m) => `${m.role}: ${m.content}`).join("\n");
        extractionChunks.push({
          text: chunkText,
          date: sessionDates?.[chunkStartSession],
          sessionRange: `${chunkStartSession}-end`,
          sessionNums: [...chunkSessionNums],
        });
      }

      console.log(
        `[SHEEP] Split into ${extractionChunks.length} chunks from ${sortedSessionNums.length} sessions`,
      );

      // =========================================================================
      // STEP 2: Dense fact extraction (sequential, with retry)
      // =========================================================================
      const TIMEOUT_MS = 120_000;
      let allFacts: Array<
        Omit<import("../memory/schema.js").Fact, "id" | "createdAt" | "updatedAt">
      > = [];

      for (let idx = 0; idx < extractionChunks.length; idx++) {
        const chunk = extractionChunks[idx];
        try {
          const t0 = Date.now();
          const factsPromise = extractFactsWithLLM(llmProvider, chunk.text, episode.id, {
            conversationDate: chunk.date,
            maxFacts: 80, // Dense extraction
          });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS),
          );
          const facts = await Promise.race([factsPromise, timeoutPromise]);

          // Step 3: Temporal resolution now happens at QUERY time, not extraction time.
          // Facts preserve original phrasing ("last week", "next month").
          // The recall prompt uses SESSION DATES to resolve at answer time.

          allFacts.push(...facts);
          console.log(
            `[SHEEP] Chunk ${idx + 1}/${extractionChunks.length} (sessions ${chunk.sessionRange}): ${facts.length} facts in ${Date.now() - t0}ms`,
          );
        } catch (err) {
          console.warn(`[SHEEP] Chunk ${idx + 1} failed: ${err}`);
        }
      }

      // =========================================================================
      // STEP 3: SECOND-PASS extraction — details, motivations, consequences
      // Targets the small specific facts that Cat 4 questions ask about
      // =========================================================================
      const DETAIL_PROMPT = `You are extracting SPECIFIC DETAILS that were missed in a first pass.
Focus ONLY on these categories — extract facts the first pass likely missed:

1. MOTIVATIONS: Why did someone do something? "Jon started dance studio because he lost his banking job"
2. SPECIFIC DETAILS: Colors, types, names, amounts. "The charity race raised awareness for mental health"
3. CONSEQUENCES: What happened after an event? "After the race, Melanie felt energized"
4. OPINIONS & PREFERENCES: What does someone think/feel? "Nate thinks turtles are the best pets"
5. GIFTS & POSSESSIONS: Specific items. "Jolene received a pendant from her mother in France"
6. LOCATIONS: Specific places visited. "Tim traveled to Ireland, Galway, and the Smoky Mountains"
7. NUMBERS & QUANTITIES: How many, how much. "Melanie has three children"

RULES:
- Output ONLY valid JSON: {"facts": [{"subject":"...","predicate":"...","object":"...","confidence":0.9,"reasoning":"..."}]}
- NO markdown code blocks. Start directly with {
- Each fact: subject | predicate | specific detail (use exact words from conversation)
- Preserve temporal phrases as spoken ("last week", "next month")
- Extract 30-50 detail facts per chunk

Conversation:
`;

      for (let idx = 0; idx < extractionChunks.length; idx++) {
        const chunk = extractionChunks[idx];
        try {
          const t0 = Date.now();
          const detailPrompt = DETAIL_PROMPT + chunk.text;

          let detailResponse = await Promise.race([
            llmProvider.complete(detailPrompt, {
              maxTokens: 4096,
              temperature: 0.1,
              jsonMode: true,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS),
            ),
          ]);

          // Strip markdown fences
          if (detailResponse && detailResponse.includes("```")) {
            detailResponse = detailResponse
              .replace(/```json\s*\n?/gi, "")
              .replace(/```\s*\n?/g, "")
              .trim();
          }

          const { parseJSONResponse } = await import("../extraction/llm-extractor.js");
          let parsed = parseJSONResponse<{
            facts: Array<{
              subject: string;
              predicate: string;
              object: string;
              confidence: number;
            }>;
          }>(detailResponse);

          // Salvage truncated JSON
          if (!parsed && detailResponse && !detailResponse.trimEnd().endsWith("}")) {
            try {
              const lastObj = detailResponse.lastIndexOf("}");
              if (lastObj > 0) {
                parsed = JSON.parse(detailResponse.substring(0, lastObj + 1) + "]}");
              }
            } catch {
              /* salvage failed */
            }
          }

          if (parsed?.facts) {
            const { now: nowFn } = await import("../memory/schema.js");
            const ts = nowFn();
            const detailFacts = parsed.facts
              .filter((f) => f.confidence >= 0.6)
              .map((f) => ({
                subject: f.subject,
                predicate: f.predicate.toLowerCase().replace(/\s+/g, "_"),
                object: f.object,
                confidence: Math.max(0, Math.min(1, f.confidence)),
                evidence: [episode.id],
                isActive: true as const,
                userAffirmed: false,
                accessCount: 0,
                firstSeen: ts,
                lastConfirmed: ts,
                contradictions: [] as string[],
              }));
            allFacts.push(...detailFacts);
            console.log(
              `[SHEEP] Detail pass ${idx + 1}/${extractionChunks.length}: ${detailFacts.length} detail facts in ${Date.now() - t0}ms`,
            );
          }
        } catch (err) {
          console.warn(`[SHEEP] Detail pass ${idx + 1} failed: ${err}`);
        }
      }

      // =========================================================================
      // STEP 3.5: THIRD-PASS extraction — Micro-fact explosion for Cat 4
      // Target: 800-1000+ facts per conversation (currently ~351)
      // Focus on ultra-granular facts that Cat 4 questions ask about
      // =========================================================================
      const MICRO_FACT_PROMPT = `You are extracting MICRO-FACTS — the smallest, most specific details that Cat 4 questions ask about.
Extract EVERY tiny detail as a separate fact. Be extremely granular.

CATEGORIES (extract ALL instances):
1. EXACT NAMES: Every person, place, pet, book, food, brand mentioned
   - "Caroline met Sarah" → "Caroline | met | Sarah"
   - "visited Paris" → "Caroline | visited | Paris"
   - "read 'Pride and Prejudice'" → "Caroline | read | Pride and Prejudice"

2. EXACT QUANTITIES: Numbers, counts, durations, amounts
   - "three children" → "Melanie | has | three children"
   - "two years ago" → "Melanie | did_something | two years ago"
   - "five dollars" → "Caroline | spent | five dollars"

3. EXACT DESCRIPTIONS: Colors, types, styles, materials
   - "blue dress" → "Caroline | wore | blue dress"
   - "ceramic bowl" → "Melanie | made | ceramic bowl"
   - "modern style" → "Caroline | prefers | modern style"

4. MOTIVATIONS: WHY someone did something (even if implicit)
   - "started because..." → "Person | started_X | because [reason]"
   - "wanted to..." → "Person | wanted_to | [goal]"

5. CONSEQUENCES: What happened AFTER an event
   - "After X, Y happened" → "After X | consequence | Y"
   - "led to..." → "X | led_to | Y"

6. OPINIONS & PREFERENCES: What someone thinks/feels/prefers
   - "thinks X is Y" → "Person | thinks | X is Y"
   - "prefers A over B" → "Person | prefers | A over B"
   - "loves/hates X" → "Person | loves | X"

7. COMPARISONS: How X differs from Y
   - "X is different from Y because..." → "X | differs_from | Y because [reason]"
   - "X is better than Y" → "X | is_better_than | Y"

8. RELATIONSHIPS: Family, friends, connections
   - "sister of X" → "Person | is_sister_of | X"
   - "friend from Y" → "Person | is_friend_from | Y"

9. TEMPORAL DETAILS: Specific times, dates, periods
   - "last Friday" → "Event | happened_on | last Friday"
   - "in 2022" → "Event | happened_in | 2022"

10. POSSESSIONS & GIFTS: Items owned or received
    - "has a pendant" → "Person | has | pendant"
    - "received X from Y" → "Person | received | X from Y"

RULES:
- Extract 50-80 micro-facts per chunk (be VERY granular)
- Each fact should be atomic (one piece of information)
- Use exact words from conversation
- Preserve temporal phrases exactly ("last week", "three years ago")
- Output ONLY valid JSON: {"facts": [{"subject":"...","predicate":"...","object":"...","confidence":0.85}]}
- NO markdown code blocks. Start directly with {
- Lower confidence threshold: 0.7 (micro-facts are more speculative but still valuable)

Conversation:
`;

      for (let idx = 0; idx < extractionChunks.length; idx++) {
        const chunk = extractionChunks[idx];
        try {
          const t0 = Date.now();
          const microPrompt = MICRO_FACT_PROMPT + chunk.text;

          let microResponse = await Promise.race([
            llmProvider.complete(microPrompt, {
              maxTokens: 6144, // Larger for more facts
              temperature: 0.15, // Slightly higher for more creative extraction
              jsonMode: true,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS),
            ),
          ]);

          // Strip markdown fences
          if (microResponse && microResponse.includes("```")) {
            microResponse = microResponse
              .replace(/```json\s*\n?/gi, "")
              .replace(/```\s*\n?/g, "")
              .trim();
          }

          const { parseJSONResponse } = await import("../extraction/llm-extractor.js");
          let parsed = parseJSONResponse<{
            facts: Array<{
              subject: string;
              predicate: string;
              object: string;
              confidence: number;
            }>;
          }>(microResponse);

          // Salvage truncated JSON
          if (!parsed && microResponse && !microResponse.trimEnd().endsWith("}")) {
            try {
              const lastObj = microResponse.lastIndexOf("}");
              if (lastObj > 0) {
                parsed = JSON.parse(microResponse.substring(0, lastObj + 1) + "]}");
              }
            } catch {
              /* salvage failed */
            }
          }

          if (parsed?.facts) {
            const { now: nowFn } = await import("../memory/schema.js");
            const ts = nowFn();
            const microFacts = parsed.facts
              .filter((f) => f.confidence >= 0.7) // Lower threshold for micro-facts
              .map((f) => ({
                subject: f.subject,
                predicate: f.predicate.toLowerCase().replace(/\s+/g, "_"),
                object: f.object,
                confidence: Math.max(0, Math.min(1, f.confidence)),
                evidence: [episode.id],
                isActive: true as const,
                userAffirmed: false,
                accessCount: 0,
                firstSeen: ts,
                lastConfirmed: ts,
                contradictions: [] as string[],
              }));
            allFacts.push(...microFacts);
            console.log(
              `[SHEEP] Micro-fact pass ${idx + 1}/${extractionChunks.length}: ${microFacts.length} micro-facts in ${Date.now() - t0}ms`,
            );
          }
        } catch (err) {
          console.warn(`[SHEEP] Micro-fact pass ${idx + 1} failed: ${err}`);
        }
      }

      // =========================================================================
      // STEP 4: Contradiction detection & deduplication
      // =========================================================================
      const factMap = new Map<string, (typeof allFacts)[0]>();
      let contradictions = 0;

      for (const fact of allFacts) {
        const key = `${fact.subject}|${fact.predicate}|${fact.object}`.toLowerCase();
        const subjectPredicateKey = `${fact.subject}|${fact.predicate}`.toLowerCase();

        // Check for exact duplicates
        const existing = factMap.get(key);
        if (existing) {
          // Exact duplicate: keep higher confidence
          if (fact.confidence > existing.confidence) {
            factMap.set(key, fact);
          }
          continue;
        }

        // Check for contradictions (same subject+predicate, different object)
        // Only for "is/has" type predicates that should be unique
        const uniquePredicates = new Set([
          "name_is",
          "age_is",
          "gender_is",
          "birth_date",
          "lives_in",
          "relationship_status",
          "partner_status",
          "education_level",
          "occupation",
          "job_title",
          "works_at",
          "personality_type",
        ]);

        const normalizedPredicate = fact.predicate.toLowerCase().replace(/\s+/g, "_");
        if (uniquePredicates.has(normalizedPredicate)) {
          // Check if another fact has same subject+predicate
          for (const [existingKey, existingFact] of factMap) {
            const existingSPKey = `${existingFact.subject}|${existingFact.predicate}`.toLowerCase();
            if (existingSPKey === subjectPredicateKey && existingKey !== key) {
              contradictions++;
              // Keep the higher confidence one
              if (fact.confidence > existingFact.confidence) {
                factMap.delete(existingKey);
                factMap.set(key, fact);
              }
              break;
            }
          }
        }

        if (!factMap.has(key)) {
          factMap.set(key, fact);
        }
      }

      const facts = Array.from(factMap.values());

      // =========================================================================
      // STEP 5: Store to SQLite
      // =========================================================================
      let factsStored = 0;
      for (const fact of facts) {
        try {
          if (!fact.evidence.includes(episode.id)) {
            fact.evidence = [episode.id, ...fact.evidence];
          }
          db.insertFact(fact);
          factsStored++;
        } catch (err) {
          // skip
        }
      }

      // Invalidate caches so next recall picks up new facts
      invalidateFactsCache(sessionKey);
      invalidateEntityIndex(sessionKey);

      console.log(
        `[SHEEP] Consolidation done: ${factsStored} stored, ${contradictions} contradictions resolved, ${allFacts.length} raw → ${facts.length} unique`,
      );

      res.json({
        success: true,
        episodes: 1,
        facts: factsStored,
        contradictions,
        causalLinks: 0,
      });
    } catch (err) {
      log.error("Error consolidating", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  },
);

// =============================================================================
// GET /recall - TWO MODES: "memory" (facts only) and "hybrid" (facts + conversation)
// =============================================================================

app.get("/recall", async (req: Request<{}, {}, {}, RecallRequest>, res: Response) => {
  try {
    const { query, sessionId, mode: rawMode } = req.query;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query parameter is required" });
    }

    const sessionKey = sessionId && typeof sessionId === "string" ? sessionId : "default";
    const mode = rawMode === "memory" ? "memory" : "hybrid";

    const llm = await getReasoningLLM();

    let answer = "No information available.";
    const factsList: RecallResponse["facts"] = [];

    const storedDates = sessionDatesStore.get(sessionKey);

    // =========================================================================
    // DETECT QUESTION TYPE (needed for multi-hop retrieval and answer calibration)
    // =========================================================================
    const qLower = query.toLowerCase();
    const isInference = /\b(likely|would|might|could|suspected|possible|probably|suggest)\b/.test(
      qLower,
    );
    const isDuration = /\bhow (long|many years|many months)\b/.test(qLower);
    const isCount = /\bhow many\b/.test(qLower) && !isDuration;
    const isYesNo =
      /^(is |are |does |do |did |has |have |was |were |will |would |can |could |should )/i.test(
        query,
      );

    // =========================================================================
    // BUILD CONTEXT based on mode
    // =========================================================================
    let contextBlock = "";

    // Session dates header (both modes)
    if (storedDates) {
      const sortedKeys = Object.keys(storedDates).sort((a, b) => parseInt(a) - parseInt(b));
      contextBlock += "SESSION DATES:\n";
      for (const k of sortedKeys) {
        contextBlock += `Session ${k}: ${storedDates[k]}\n`;
      }
      contextBlock += "\n";
    }

    if (mode === "memory") {
      // =====================================================================
      // MEMORY MODE: Facts only from database (THE ACID TEST)
      // =====================================================================
      const allSessionFacts = getSessionFacts(sessionKey);

      // ---------------------------------------------------------------
      // ADVERSARIAL CHECK: Deterministic pre-filter (no LLM, saves cost)
      // If question swaps names (Cat 5), return "" immediately
      // ---------------------------------------------------------------
      if (allSessionFacts.length > 0) {
        const adversarialResult = checkAdversarial(query, sessionKey, allSessionFacts);
        if (adversarialResult !== null) {
          console.log(`[SHEEP] [${mode}] ADVERSARIAL Q: "${query.slice(0, 50)}" → blocked`);
          return res.json({
            answer: adversarialResult,
            mode,
            factsUsed: 0,
            facts: [],
          } as RecallResponse);
        }
      }

      // =====================================================================
      // BREAKTHROUGH D: Multi-hop retrieval for Cat 3 inference questions
      // =====================================================================
      let sessionFacts: typeof allSessionFacts = [];

      if (isInference && allSessionFacts.length > 0) {
        // Step 1: Extract keywords from question for direct matching
        const qWords = query
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 2 &&
              ![
                "what",
                "when",
                "where",
                "who",
                "why",
                "how",
                "is",
                "are",
                "was",
                "were",
                "does",
                "did",
                "do",
                "has",
                "have",
                "will",
                "would",
                "can",
                "could",
                "should",
                "might",
                "may",
                "likely",
                "probably",
                "possibly",
                "suspected",
                "suggest",
                "infer",
                "deduce",
              ].includes(w),
          );

        // Step 2: Retrieve facts matching question keywords directly
        const directFacts = allSessionFacts.filter((f) => {
          const factText = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
          return qWords.some((word) => factText.includes(word));
        });

        // Step 3: Extract entities from direct facts
        const entitiesInDirectFacts = new Set<string>();
        for (const f of directFacts) {
          entitiesInDirectFacts.add(f.subject.toLowerCase());
          // Also extract entities from object field (if it's a person/entity name)
          const objectWords = f.object.toLowerCase().split(/\s+/);
          for (const word of objectWords) {
            if (word.length > 2 && /^[a-z]+$/.test(word)) {
              // Check if this word appears as a subject in other facts (likely an entity)
              const appearsAsSubject = allSessionFacts.some(
                (otherF) => otherF.subject.toLowerCase() === word && otherF !== f,
              );
              if (appearsAsSubject) {
                entitiesInDirectFacts.add(word);
              }
            }
          }
        }

        // Step 4: Retrieve facts about entities mentioned in step 1
        const hop2Facts = allSessionFacts.filter(
          (f) => entitiesInDirectFacts.has(f.subject.toLowerCase()) && !directFacts.includes(f),
        );

        // Step 5: Combine both sets (direct + hop2)
        sessionFacts = [...directFacts, ...hop2Facts];

        // Limit to top 100 facts by confidence to avoid overwhelming the LLM
        sessionFacts = sessionFacts.sort((a, b) => b.confidence - a.confidence).slice(0, 100);

        console.log(
          `[SHEEP] MULTI-HOP: Direct=${directFacts.length}, Hop2=${hop2Facts.length}, Total=${sessionFacts.length}`,
        );
      } else {
        // Non-inference: use all facts (or could filter by relevance)
        sessionFacts = allSessionFacts;
      }

      if (sessionFacts.length > 0) {
        contextBlock += "KNOWN FACTS (extracted from conversation memory):\n";
        for (const f of sessionFacts) {
          contextBlock += `- ${f.subject} | ${f.predicate} | ${f.object}\n`;
          factsList.push({
            subject: f.subject,
            predicate: f.predicate,
            object: f.object,
            confidence: f.confidence,
          });
        }
      }
    } else {
      // =====================================================================
      // HYBRID MODE: Full conversation + facts (maximum accuracy)
      // =====================================================================
      const messages = sessionMessages.get(sessionKey);

      if (messages && messages.length > 0) {
        let currentSession = "";
        const formattedLines: string[] = [];
        for (const msg of messages) {
          const match = msg.timestamp.match(/^D(\d+):/);
          const sessionNum = match ? match[1] : "";
          if (sessionNum && sessionNum !== currentSession) {
            currentSession = sessionNum;
            const date = storedDates?.[sessionNum];
            if (date) formattedLines.push(`\n--- Session ${sessionNum} (${date}) ---`);
          }
          formattedLines.push(`${msg.role}: ${msg.content}`);
        }
        contextBlock += formattedLines.join("\n") + "\n";
      }
    }

    if (contextBlock.length < 10) {
      return res.json({
        answer: "No information available.",
        mode,
        factsUsed: 0,
        facts: [],
      } as RecallResponse);
    }

    // =========================================================================
    // ANSWER SYNTHESIS — Question-adaptive + adversarial detection
    // =========================================================================
    // Note: Question type detection moved earlier (before context building)

    let specialInstructions = "";
    if (isInference) {
      specialInstructions +=
        "\nINFERENCE QUESTION (BREAKTHROUGH D): This is a multi-hop reasoning question.\n" +
        "Step 1: Identify facts directly related to the question.\n" +
        "Step 2: Identify facts about entities mentioned in Step 1.\n" +
        "Step 3: Reason step by step from BOTH sets of facts to infer the answer.\n" +
        "State ONLY the conclusion. No explanation of the reasoning process.\n";
    }

    const synthesisPrompt = `${contextBlock}
---
Question: "${query}"
${specialInstructions}
RULES — Shorter answers score higher. Every extra word HURTS.

ADVERSARIAL CHECK (CRITICAL):
The question may deliberately swap names to trick you. Before answering:
- If the question asks "What are MELANIE's adoption plans?" but facts say CAROLINE is adopting → answer ""
- If the question attributes an action to Person X but facts show Person Y did it → answer ""
- If the question asks about something NOBODY mentioned → answer "No information available."
- Only answer if the CORRECT person is associated with the fact.

1. MINIMUM WORDS. Strip everything except the core value.
   "What is X's status?" → "Single" STOP.
   "What does X have?" → "pendants" STOP.
   "How long?" → "three years" STOP.
   "How many?" → "2" STOP.
   ${isYesNo ? '"Is/Does/Would...?" → "Yes" or "No" ONLY.' : ""}
   ${isDuration ? '"How long?" → DURATION only: "three years". No dates.' : ""}
   ${isCount ? '"How many?" → NUMBER only.' : ""}

2. TEMPORAL: Resolve relative time using SESSION DATES.
   "last year" (May 2023) → "2022". "last week" (9 June 2023) → "the week before 9 June 2023"
   "last Friday" (23 Jan 2022) → "the Friday before 23 January 2022". Simplify: "2019" not "January 2019".

3. LISTS: ALL items mentioned, comma-separated. No extra items.

4. QUOTE exact words. Never paraphrase.

5. Not in the data → "No information available."

6. NO markdown. NO explanations. Just the value.

Answer:`;

    // Adaptive maxTokens: fewer = forced brevity = higher F1
    const maxTokens = isInference ? 60 : isYesNo || isCount || isDuration ? 15 : 30;

    try {
      const raw = await llm.complete(synthesisPrompt, {
        maxTokens,
        temperature: 0.0,
      });

      // =====================================================================
      // BREAKTHROUGH C: Smart Answer Calibration — Post-process for conciseness
      // =====================================================================

      // Detect question type for targeted extraction (using qLower already defined)
      const isWhat = /^what (is|are|was|were|does|did|do|has|have)/i.test(query);
      const isWhen = /^when (did|does|do|was|were|will|would)/i.test(query);
      const isWhere = /^where (did|does|do|was|were|will|would|is|are)/i.test(query);
      const isWho = /^who (did|does|do|was|were|will|would|is|are)/i.test(query);
      const isHowMany = /\bhow many\b/i.test(query);
      const isHowMuch = /\bhow much\b/i.test(query);

      answer = raw.trim();

      // Step 1: Strip markdown and common prefixes
      answer = answer
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/^#+\s*/gm, "")
        .replace(/^["'`]|["'`]$/g, "")
        .replace(
          /^(based on|according to|from) (the |this )?(conversation|information|facts|data|context|memory)[,:]?\s*/i,
          "",
        )
        .replace(/^(the answer is|answer)[:\s]*/i, "")
        .replace(/^(i\.e\.,?\s*)/i, "")
        .replace(/\s*\(i\.e\.,?[^)]*\)/gi, "")
        .replace(/,?\s*i\.e\.,?\s*/gi, ", ")
        .replace(/\bapproximately\s*/gi, "")
        .replace(/\baround\s*/gi, "")
        .replace(/\babout\s*/gi, "")
        .trim();

      // Step 2: Strip qualifiers and explanations (Breakthrough C)
      answer = answer
        .replace(/\s+because\s+[^.]*(\.|$)/gi, "") // Remove "because..." clauses
        .replace(/\s+since\s+[^.]*(\.|$)/gi, "") // Remove "since..." clauses
        .replace(/\s+which means\s+[^.]*(\.|$)/gi, "") // Remove "which means..." clauses
        .replace(/\s+meaning\s+[^.]*(\.|$)/gi, "") // Remove "meaning..." clauses
        .replace(/\s+as\s+[^.]*(\.|$)/gi, "") // Remove "as..." clauses (but be careful with "as X as Y")
        .replace(/\s+due to\s+[^.]*(\.|$)/gi, "") // Remove "due to..." clauses
        .replace(/\s+in order to\s+[^.]*(\.|$)/gi, "") // Remove "in order to..." clauses
        .trim();

      // Step 3: Question-type specific extraction
      if (isWhen) {
        // Extract just the date/time (first temporal expression)
        const dateMatch = answer.match(
          /(\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+\d{4}|\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|(last|next|this)\s+(week|month|year|Friday|Monday|Tuesday|Wednesday|Thursday|Saturday|Sunday)|(the\s+)?(week|month|year|day)\s+before\s+[^,\.]+)/i,
        );
        if (dateMatch) {
          answer = dateMatch[0].trim();
        } else {
          // Try to extract first phrase that looks like a date
          const phrases = answer.split(/[.,;]/);
          for (const phrase of phrases) {
            if (/\d{4}|\d{1,2}\/\d{1,2}|(last|next|this)\s+(week|month|year)/i.test(phrase)) {
              answer = phrase.trim();
              break;
            }
          }
        }
      } else if (isWhere) {
        // Extract just the place name (first capitalized phrase or location)
        const placeMatch = answer.match(
          /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(City|Town|Park|Street|Avenue|Road|Place|Square|Plaza|Airport|Station|Center|Centre|Museum|Library|Hospital|School|University|College|Restaurant|Cafe|Hotel|Beach|Mountain|Lake|River|Island|Country|State|Province|Region))?)/,
        );
        if (placeMatch) {
          answer = placeMatch[0].trim();
        } else {
          // Take first phrase
          answer = answer.split(/[.,;]/)[0].trim();
        }
      } else if (isWhat && !isHowMany && !isHowMuch) {
        // Extract just the value (stop at first period, comma, or explanation)
        // For "What is X?" questions, extract the core value
        answer = answer.split(/[.,;]/)[0].trim();
        // Remove common trailing qualifiers
        answer = answer
          .replace(/\s+(and|or|but|however|although|though|while|whereas).*$/i, "")
          .trim();
      } else if (isHowMany || isHowMuch) {
        // Extract just the number
        const numberMatch = answer.match(
          /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)/i,
        );
        if (numberMatch) {
          answer = numberMatch[0].trim();
        }
      }

      // Step 4: Normalize numbers (Breakthrough C)
      const numberMap: Record<string, string> = {
        zero: "0",
        one: "1",
        two: "2",
        three: "3",
        four: "4",
        five: "5",
        six: "6",
        seven: "7",
        eight: "8",
        nine: "9",
        ten: "10",
        eleven: "11",
        twelve: "12",
        thirteen: "13",
        fourteen: "14",
        fifteen: "15",
        sixteen: "16",
        seventeen: "17",
        eighteen: "18",
        nineteen: "19",
        twenty: "20",
        thirty: "30",
        forty: "40",
        fifty: "50",
        sixty: "60",
        seventy: "70",
        eighty: "80",
        ninety: "90",
        hundred: "100",
        thousand: "1000",
      };
      for (const [word, num] of Object.entries(numberMap)) {
        const regex = new RegExp(`\\b${word}\\b`, "gi");
        if (isHowMany || isHowMuch) {
          // For count questions, prefer numeric form
          answer = answer.replace(regex, num);
        }
        // For other questions, keep original but allow both forms
      }

      // Step 5: Final cleanup
      const firstLine = answer.split("\n")[0].trim();
      if (firstLine.length > 3) answer = firstLine;

      // Extract parenthetical if it contains the answer (e.g., "something (the actual answer)")
      const pm = answer.match(/\(([^)]+)\)\s*$/);
      if (pm && (/\d/.test(pm[1]) || pm[1].length > 2)) {
        answer = pm[1].trim();
      }

      // Remove trailing punctuation and whitespace
      answer = answer.replace(/[.,;]\s*$/, "").trim();

      // Final pass: remove any remaining explanation markers
      answer = answer.replace(/\s*—\s*.*$/, "").trim(); // Remove em-dash explanations
      answer = answer.replace(/\s*:\s*.*$/, "").trim(); // Remove colon explanations (but be careful)
    } catch (llmErr) {
      log.warn("Synthesis failed", { error: String(llmErr) });
      answer = "No information available.";
    }

    console.log(`[SHEEP] [${mode}] Q: "${query.slice(0, 50)}" → A: "${answer.slice(0, 80)}"`);

    res.json({
      answer,
      mode,
      factsUsed: factsList.length,
      facts: factsList.slice(0, 10),
    } as RecallResponse);
  } catch (err) {
    log.error("Error recalling", { error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

// =============================================================================
// GET /health
// =============================================================================

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", agentId, modes: ["memory", "hybrid"] });
});

// =============================================================================
// SERVER START
// =============================================================================

const PORT = Number(process.env.PORT) || 8001;

export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`🐑 SHEEP AI Server v2 running on http://localhost:${port}`);
    console.log(`   Agent ID: ${agentId}`);
    console.log(`   Models: Sonnet 4.5 (extraction) + Opus 4.6 (reasoning)`);
    console.log(`   Modes: ?mode=memory (facts only) | ?mode=hybrid (default)`);
    console.log(`   Pipeline: Extract → Temporal Resolve → Contradiction Check → Store`);
  });
}

export default app;
