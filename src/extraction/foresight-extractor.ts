/**
 * SHEEP AI - Foresight Signal Extractor
 *
 * Extracts time-bounded predictions and intentions from conversations.
 * Inspired by EverMemOS foresight_extractor.py but adapted for SHEEP.
 *
 * Examples of foresights:
 * - "User plans to buy a Mac Studio this month"
 * - "User will travel to Istanbul next week"
 * - "User wants to achieve LoCoMo 90%+ in 3 weeks"
 *
 * @module sheep/extraction/foresight-extractor
 */

import type { Episode } from "../memory/schema.js";
import type { LLMProvider } from "./llm-extractor.js";

// =============================================================================
// TYPES
// =============================================================================

export type ForesightCandidate = {
  description: string;
  evidence: string;
  startTime: string;
  endTime: string | null;
  durationDays: number | null;
  confidence: number;
};

// =============================================================================
// PROMPTS
// =============================================================================

const FORESIGHT_PROMPT = `You are a personal foresight analyst. Based on the conversation below, predict specific impacts on the user's future behavior and decisions.

Each prediction must include:
- "description": What will happen (max 40 words, specific and verifiable)
- "evidence": Supporting fact from conversation (max 40 words)
- "start_time": YYYY-MM-DD (when this becomes relevant)
- "end_time": YYYY-MM-DD or null (when this expires)
- "duration_days": Number of days or null
- "confidence": 0.0-1.0

Rules:
- Only extract predictions with clear evidence in the text
- Be specific, not vague ("will buy X" not "might consider purchasing")
- Include both explicit intentions AND implicit plans
- 0-6 predictions per conversation segment

Conversation:
"""
{TEXT}
"""

Today's date: {DATE}

Respond with a JSON array only. If no predictions found, respond with [].`;

// =============================================================================
// EXTRACTION
// =============================================================================

/**
 * Extract foresight signals from an episode
 */
export async function extractForesights(
  episode: Episode,
  llm: LLMProvider,
  currentDate?: string,
): Promise<ForesightCandidate[]> {
  const text = episode.summary;
  if (!text || text.length < 30) return [];

  const date = currentDate ?? new Date().toISOString().split("T")[0];

  try {
    const prompt = FORESIGHT_PROMPT.replace("{TEXT}", text).replace("{DATE}", date);

    const response = await llm.complete(prompt, {
      temperature: 0.1,
      maxTokens: 1500,
      jsonMode: true,
    });

    let parsed: Array<{
      description: string;
      evidence: string;
      start_time: string;
      end_time: string | null;
      duration_days: number | null;
      confidence: number;
    }>;

    try {
      const cleaned = response
        .trim()
        .replace(/^```json?\n?/, "")
        .replace(/\n?```$/, "");
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];
    } catch {
      return [];
    }

    return parsed
      .filter((item) => item.description && item.confidence >= 0.3)
      .map((item) => ({
        description: item.description.slice(0, 200),
        evidence: (item.evidence ?? "").slice(0, 200),
        startTime: item.start_time ?? date,
        endTime: item.end_time ?? null,
        durationDays: item.duration_days ?? null,
        confidence: Math.min(Math.max(item.confidence, 0), 1),
      }));
  } catch {
    return [];
  }
}

/**
 * Extract foresights from multiple episodes
 */
export async function extractForesightsFromEpisodes(
  episodes: Episode[],
  llm: LLMProvider,
  currentDate?: string,
): Promise<ForesightCandidate[]> {
  const allForesights: ForesightCandidate[] = [];

  for (const episode of episodes) {
    const foresights = await extractForesights(episode, llm, currentDate);
    allForesights.push(...foresights);
  }

  // Deduplicate by description similarity (simple approach)
  const seen = new Set<string>();
  return allForesights.filter((f) => {
    const key = f.description.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
