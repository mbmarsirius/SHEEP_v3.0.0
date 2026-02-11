/**
 * SHEEP Cloud - Shared Brain Module
 *
 * Core chat-with-memory logic reusable across all channels
 * (Telegram, WhatsApp, Web, API).
 *
 * The channel-specific code handles message I/O.
 * This module handles: memory lookup, LLM response, background learning.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getUserDatabase } from "../db-manager.js";
import { semanticRecall } from "../semantic-recall.js";
import { now } from "../../memory/schema.js";
import type { LLMProvider } from "../../extraction/llm-extractor.js";

// =============================================================================
// CONFIG
// =============================================================================

const SONNET_MODEL = "claude-sonnet-4-20250514";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

let _anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  if (_anthropicClient) return _anthropicClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === "none") return null;
  _anthropicClient = new Anthropic({ apiKey: key });
  return _anthropicClient;
}

function createProvider(model: string): LLMProvider | null {
  const client = getAnthropicClient();
  if (!client) return null;
  return {
    name: `anthropic/${model}`,
    complete: async (prompt, options) => {
      const resp = await client.messages.create({
        model,
        max_tokens: options?.maxTokens ?? 1024,
        temperature: options?.temperature ?? 0.7,
        ...(options?.system ? { system: options.system } : {}),
        messages: [{ role: "user", content: prompt }],
      });
      return resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    },
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

export type UserTier = "free" | "personal" | "pro" | "team";

export interface ChatResult {
  reply: string;
  factsLearned: number;
}

/**
 * Process a message from any channel.
 * Handles: memory lookup, LLM response, background learning.
 */
export async function processMessage(
  userId: string,
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  tier: UserTier = "free",
): Promise<ChatResult> {
  const chatLLM = createProvider(SONNET_MODEL);
  const learnLLM = createProvider(HAIKU_MODEL);

  if (!chatLLM) {
    return { reply: "I'm having trouble connecting to my brain. Please try again later.", factsLearned: 0 };
  }

  const db = getUserDatabase(userId);

  // 1. Fetch relevant memories using hybrid semantic search
  let memoryContext = "";
  try {
    const facts = db.findFacts({ activeOnly: true });
    const relevant = await semanticRecall(userId, userMessage, facts, 8);

    if (relevant.length > 0) {
      memoryContext =
        "\n\n[Your memories about this user]\n" +
        relevant.map((f) => `- ${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`).join("\n");
    }
  } catch { /* no facts yet */ }

  // 2. Build conversation
  const recentHistory = history.slice(-8);
  const historyText = recentHistory
    .map((h) => `${h.role === "user" ? "User" : "Sheep"}: ${h.content}`)
    .join("\n");

  const systemPrompt = `You are Counting Sheep, a friendly AI companion that remembers everything.

You have a real memory system. You learn from every conversation and remember across sessions.
When you have relevant memories, use them naturally -- like a friend would.
Never fabricate memories you don't have. If you don't know something, say so.

Keep responses concise and warm. Use short paragraphs. No walls of text.
Match the user's language (if they write in Turkish, respond in Turkish, etc.).
${memoryContext || "\nNo memories yet -- this is a fresh conversation."}`;

  // 3. Generate response
  const reply = await chatLLM.complete(
    `${historyText}\nUser: ${userMessage}\nSheep:`,
    { system: systemPrompt, maxTokens: 800, temperature: 0.7 },
  );

  const finalReply = reply?.trim() || "I'm here but had trouble responding. Try again?";

  // 4. Background learning
  let factsLearned = 0;
  if (learnLLM) {
    try {
      const { extractFactsWithLLM } = await import("../../extraction/llm-extractor.js");
      const text = `User: ${userMessage}\nAssistant: ${finalReply}`;
      const episodeId = `cloud-${Date.now()}`;
      const facts = await extractFactsWithLLM(learnLLM, text, episodeId);
      const ts = now();
      for (const fact of facts) {
        try {
          db.insertFact({
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            confidence: fact.confidence,
            evidence: fact.evidence,
            firstSeen: ts,
            lastConfirmed: ts,
            userAffirmed: false,
          });
          factsLearned++;
        } catch { /* ignore duplicates */ }
      }
    } catch { /* learning failed, non-critical */ }
  }

  return { reply: finalReply, factsLearned };
}
