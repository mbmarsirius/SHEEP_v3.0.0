/**
 * SHEEP AI - Episode Extraction Pipeline
 *
 * Converts raw session JSONL files into structured Episodes.
 * Uses a sliding window approach to segment conversations into
 * coherent topical episodes.
 *
 * @module sheep/extraction/episode-extractor
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Episode } from "../memory/schema.js";
import { resolveSessionTranscriptsDirForAgent } from "../stubs/session-paths.js";
import { generateId, now } from "../memory/schema.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A raw message from a session JSONL file
 */
export type RawMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
};

/**
 * A parsed session with metadata and messages
 */
export type ParsedSession = {
  sessionId: string;
  sessionFile: string;
  timestamp: string;
  messages: RawMessage[];
};

/**
 * Options for episode extraction
 */
export type ExtractionOptions = {
  /** Minimum messages to form an episode (default: 2) */
  minMessagesPerEpisode?: number;
  /** Maximum messages per episode (default: 20) */
  maxMessagesPerEpisode?: number;
  /** Whether to use LLM for better extraction (default: false for now) */
  useLLM?: boolean;
  /** Only process sessions/episodes after this timestamp (ISO string) */
  processedFrom?: string;
};

// =============================================================================
// JSONL PARSING
// =============================================================================

/**
 * Parse a single JSONL line into a message
 */
function parseJsonlLine(line: string): RawMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let record: unknown;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!record || typeof record !== "object") return null;

  const obj = record as Record<string, unknown>;

  // Handle message records
  if (obj.type === "message") {
    const message = obj.message as Record<string, unknown> | undefined;
    if (!message || typeof message.role !== "string") return null;

    const role = message.role as string;
    if (role !== "user" && role !== "assistant" && role !== "system") return null;

    const content = extractContent(message.content);
    if (!content) return null;

    return {
      id: (obj.id as string) ?? generateId("mc"),
      role: role as "user" | "assistant" | "system",
      content,
      timestamp: typeof obj.timestamp === "number" ? obj.timestamp : undefined,
    };
  }

  return null;
}

/**
 * Extract text content from message content field
 */
function extractContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content.trim() || null;
  }

  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as { type?: unknown; text?: unknown };
    if (record.type !== "text" || typeof record.text !== "string") continue;
    const text = record.text.trim();
    if (text) parts.push(text);
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Parse a session JSONL file into structured data
 */
export async function parseSessionFile(sessionFile: string): Promise<ParsedSession | null> {
  try {
    const raw = await fs.readFile(sessionFile, "utf-8");
    const lines = raw.split("\n");
    const messages: RawMessage[] = [];

    let sessionId: string | undefined;
    let timestamp: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let record: unknown;
      try {
        record = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const obj = record as Record<string, unknown>;

      // Extract session header
      if (obj.type === "session") {
        sessionId = obj.id as string;
        timestamp = obj.timestamp as string;
        continue;
      }

      // Extract messages
      const message = parseJsonlLine(trimmed);
      if (message && message.role !== "system") {
        messages.push(message);
      }
    }

    if (!sessionId || messages.length === 0) return null;

    return {
      sessionId,
      sessionFile,
      timestamp: timestamp ?? now(),
      messages,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// EPISODE SEGMENTATION
// =============================================================================

/**
 * Simple topic detection based on keyword overlap
 * Returns true if messages are likely about different topics
 */
function detectTopicShift(prevMessages: RawMessage[], nextMessage: RawMessage): boolean {
  if (prevMessages.length === 0) return false;

  // Get keywords from previous messages
  const prevText = prevMessages.map((m) => m.content).join(" ");
  const prevKeywords = extractKeywords(prevText);

  // Get keywords from next message
  const nextKeywords = extractKeywords(nextMessage.content);

  // Calculate keyword overlap
  const overlap = prevKeywords.filter((k) => nextKeywords.includes(k)).length;
  const maxPossible = Math.min(prevKeywords.length, nextKeywords.length);

  // Low overlap suggests topic shift
  return maxPossible > 0 && overlap / maxPossible < 0.2;
}

/**
 * Calculate semantic density of a window (SimpleMem-style gating)
 * Returns a score 0-1 indicating how information-dense the window is
 * Low-density windows (< 0.3) should be filtered out
 */
export function calculateSemanticDensity(messages: RawMessage[]): number {
  if (messages.length === 0) return 0;

  const text = messages.map((m) => m.content).join(" ");
  const keywords = extractKeywords(text);

  // Density factors:
  // 1. Keyword-to-word ratio (more keywords = denser)
  const words = text.split(/\s+/).filter((w) => w.length > 2);
  const keywordRatio = keywords.length / Math.max(words.length, 1);

  // 2. Named entity indicators (capitalized words, proper nouns)
  const capitalizedWords = text.match(/\b[A-Z][a-z]+\b/g) || [];
  const entityRatio = capitalizedWords.length / Math.max(words.length, 1);

  // 3. Information content (numbers, dates, specific terms)
  const hasNumbers = /\d+/.test(text);
  const hasDates = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(text);
  const hasSpecificTerms = /(?:project|company|location|technology|tool|method|approach)/i.test(
    text,
  );

  // Combine factors
  let density = keywordRatio * 0.4 + entityRatio * 0.3;
  if (hasNumbers) density += 0.1;
  if (hasDates) density += 0.1;
  if (hasSpecificTerms) density += 0.1;

  return Math.min(density, 1.0);
}

/**
 * Extract keywords from text (simple implementation)
 */
function extractKeywords(text: string): string[] {
  // Remove common words and extract meaningful terms
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "can",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "every",
    "both",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "just",
    "and",
    "but",
    "if",
    "or",
    "because",
    "until",
    "while",
    "this",
    "that",
    "these",
    "those",
    "what",
    "which",
    "who",
    "whom",
    "i",
    "me",
    "my",
    "myself",
    "we",
    "our",
    "ours",
    "you",
    "your",
    "yours",
    "he",
    "him",
    "his",
    "she",
    "her",
    "hers",
    "it",
    "its",
    "they",
    "them",
    "their",
    "theirs",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // Return unique words
  return [...new Set(words)];
}

/**
 * Calculate emotional salience from message content
 */
function calculateSalience(messages: RawMessage[]): number {
  const text = messages
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();

  let score = 0.3; // Base score

  // Excitement indicators
  if (text.includes("!")) score += 0.1;
  if ((text.match(/!+/g) || []).length > 2) score += 0.1;
  if (/\b(amazing|awesome|fantastic|incredible|love|great|excellent)\b/i.test(text)) score += 0.1;

  // Importance indicators
  if (/\b(important|critical|urgent|must|need|essential|crucial)\b/i.test(text)) score += 0.15;
  if (/\b(remember|don't forget|note|save|keep)\b/i.test(text)) score += 0.1;

  // Question depth (complex questions = more salient)
  const questions = (text.match(/\?/g) || []).length;
  if (questions > 0) score += Math.min(questions * 0.05, 0.15);

  // Cap at 1.0
  return Math.min(score, 1.0);
}

/**
 * Calculate utility score based on conversation outcome
 */
function calculateUtility(messages: RawMessage[]): number {
  const text = messages
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();

  let score = 0.4; // Base score

  // Problem solving indicators
  if (/\b(solved|fixed|working|works|done|completed|success)\b/i.test(text)) score += 0.2;
  if (/\b(thank|thanks|perfect|exactly)\b/i.test(text)) score += 0.15;

  // Learning indicators
  if (/\b(learned|understand|got it|makes sense|i see)\b/i.test(text)) score += 0.1;

  // Code/technical content (usually higher utility)
  if (/```|function|class|import|export|const|let|var/.test(text)) score += 0.1;

  // Cap at 1.0
  return Math.min(score, 1.0);
}

/**
 * Determine TTL based on salience and utility
 */
function determineTTL(salience: number, utility: number): Episode["ttl"] {
  const combined = (salience + utility) / 2;
  if (combined > 0.8) return "permanent";
  if (combined > 0.6) return "90d";
  if (combined > 0.4) return "30d";
  return "7d";
}

/**
 * Extract primary topic from messages
 */
function extractTopic(messages: RawMessage[]): string {
  const keywords = extractKeywords(messages.map((m) => m.content).join(" "));

  // Count keyword frequency
  const counts = new Map<string, number>();
  for (const kw of keywords) {
    counts.set(kw, (counts.get(kw) || 0) + 1);
  }

  // Get top keywords
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  if (sorted.length === 0) return "General discussion";
  return sorted.map(([word]) => word).join(", ");
}

/**
 * Generate a summary of the episode
 * Includes all user messages (where facts live) plus assistant responses for context
 */
function generateSummary(messages: RawMessage[]): string {
  // Include ALL user messages - this is where facts about the user live
  // Also include assistant responses for context (helpful for causal reasoning)
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      // Clean up the content (remove excessive whitespace)
      const cleaned = msg.content.replace(/\s+/g, " ").trim();
      if (cleaned) {
        parts.push(`[${msg.role}]: ${cleaned}`);
      }
    }
  }

  if (parts.length === 0) return "Conversation exchange";

  // Join all messages - we need the full content for fact extraction
  // Limit to 5000 chars to prevent massive episodes
  const full = parts.join("\n\n");
  if (full.length <= 5000) return full;
  return full.substring(0, 4997) + "...";
}

/**
 * Segment a session into episodes with SimpleMem-style semantic density gating
 * Filters out low-density windows to improve compression quality
 */
export function segmentIntoEpisodes(
  session: ParsedSession,
  options: ExtractionOptions = {},
): Omit<Episode, "id" | "createdAt" | "updatedAt" | "accessCount">[] {
  const minMessages = options.minMessagesPerEpisode ?? 2;
  const maxMessages = options.maxMessagesPerEpisode ?? 20;
  // Semantic density threshold (SimpleMem approach: filter low-density windows)
  const minDensity = 0.3;

  const episodes: Omit<Episode, "id" | "createdAt" | "updatedAt" | "accessCount">[] = [];
  let currentMessages: RawMessage[] = [];

  for (const message of session.messages) {
    // Check if we should start a new episode
    const shouldSplit =
      currentMessages.length >= maxMessages ||
      (currentMessages.length >= minMessages && detectTopicShift(currentMessages, message));

    if (shouldSplit && currentMessages.length >= minMessages) {
      // Apply semantic density gating (SimpleMem approach)
      const density = calculateSemanticDensity(currentMessages);
      if (density >= minDensity) {
        // Create episode from current messages (high density)
        const episode = createEpisodeFromMessages(currentMessages, session);
        episodes.push(episode);
      }
      // Skip low-density windows (they don't contain enough information)
      currentMessages = [];
    }

    currentMessages.push(message);
  }

  // Handle remaining messages with density gating
  if (currentMessages.length >= minMessages) {
    const density = calculateSemanticDensity(currentMessages);
    if (density >= minDensity) {
      const episode = createEpisodeFromMessages(currentMessages, session);
      episodes.push(episode);
    }
  } else if (currentMessages.length > 0 && episodes.length > 0) {
    // Merge with last episode if too few messages (but check density)
    const density = calculateSemanticDensity(currentMessages);
    if (density >= minDensity) {
      const lastEpisode = episodes[episodes.length - 1];
      lastEpisode.sourceMessageIds.push(...currentMessages.map((m) => m.id));
      // Recalculate scores
      const allMessages = [
        ...session.messages.filter((m) => lastEpisode.sourceMessageIds.includes(m.id)),
        ...currentMessages,
      ];
      lastEpisode.emotionalSalience = calculateSalience(allMessages);
      lastEpisode.utilityScore = calculateUtility(allMessages);
    }
  } else if (currentMessages.length > 0) {
    // Create episode even with few messages if density is acceptable
    const density = calculateSemanticDensity(currentMessages);
    if (density >= minDensity) {
      const episode = createEpisodeFromMessages(currentMessages, session);
      episodes.push(episode);
    }
  }

  return episodes;
}

/**
 * Create an episode from a group of messages
 */
function createEpisodeFromMessages(
  messages: RawMessage[],
  session: ParsedSession,
): Omit<Episode, "id" | "createdAt" | "updatedAt" | "accessCount"> {
  const salience = calculateSalience(messages);
  const utility = calculateUtility(messages);
  const keywords = extractKeywords(messages.map((m) => m.content).join(" ")).slice(0, 10);

  // Determine timestamp from first message or session
  const firstTimestamp = messages[0]?.timestamp;
  const timestamp = firstTimestamp ? new Date(firstTimestamp).toISOString() : session.timestamp;

  return {
    timestamp,
    summary: generateSummary(messages),
    participants: [...new Set(messages.map((m) => m.role))],
    topic: extractTopic(messages),
    keywords,
    emotionalSalience: salience,
    utilityScore: utility,
    sourceSessionId: session.sessionId,
    sourceMessageIds: messages.map((m) => m.id),
    ttl: determineTTL(salience, utility),
    lastAccessedAt: undefined,
  };
}

// =============================================================================
// MAIN EXTRACTION FUNCTION
// =============================================================================

/**
 * Extract episodes from all sessions for an agent
 */
export async function extractEpisodesFromSessions(
  agentId: string,
  options: ExtractionOptions = {},
): Promise<{
  episodes: Omit<Episode, "id" | "createdAt" | "updatedAt" | "accessCount">[];
  sessionsProcessed: number;
}> {
  const sessionsDir = resolveSessionTranscriptsDirForAgent(agentId);
  const episodes: Omit<Episode, "id" | "createdAt" | "updatedAt" | "accessCount">[] = [];
  let sessionsProcessed = 0;

  // Parse processedFrom timestamp for filtering
  const processedFromDate = options.processedFrom ? new Date(options.processedFrom) : null;

  try {
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
    const jsonlFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => path.join(sessionsDir, e.name));

    for (const sessionFile of jsonlFiles) {
      const session = await parseSessionFile(sessionFile);
      if (!session) continue;

      // Filter by timestamp if processedFrom is provided
      if (processedFromDate) {
        const sessionDate = new Date(session.timestamp);
        // Skip sessions that are older than processedFrom
        if (sessionDate <= processedFromDate) {
          continue;
        }
      }

      const sessionEpisodes = segmentIntoEpisodes(session, options);

      // Also filter episodes by timestamp (in case session spans multiple days)
      if (processedFromDate) {
        const filteredEpisodes = sessionEpisodes.filter((ep) => {
          const episodeDate = new Date(ep.timestamp);
          return episodeDate > processedFromDate;
        });
        episodes.push(...filteredEpisodes);
      } else {
        episodes.push(...sessionEpisodes);
      }

      sessionsProcessed++;
    }
  } catch {
    // Directory might not exist yet
  }

  return { episodes, sessionsProcessed };
}

/**
 * Extract episodes from a single session file
 */
export async function extractEpisodesFromFile(
  sessionFile: string,
  options: ExtractionOptions = {},
): Promise<Omit<Episode, "id" | "createdAt" | "updatedAt" | "accessCount">[]> {
  const session = await parseSessionFile(sessionFile);
  if (!session) return [];
  return segmentIntoEpisodes(session, options);
}
