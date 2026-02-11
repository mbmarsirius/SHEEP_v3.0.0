/**
 * SHEEP Cloud - Multi-User Telegram Bot
 *
 * Mass-market version: every Telegram user gets their own cognitive memory.
 * No install, no API keys, no terminal. Just open Telegram and chat.
 *
 * Architecture:
 *   - Each Telegram chat ID -> separate SQLite database (via getUserDatabase)
 *   - LLM: Anthropic API direct (Sonnet 4 for chat, Haiku 4 for learning)
 *   - Runs on Railway alongside the cloud API server
 *
 * Free tier: 20 messages/day, basic recall
 * Personal ($9/mo): unlimited, consolidation, causal reasoning
 */

import { Bot, Context, session } from "grammy";
import Anthropic from "@anthropic-ai/sdk";
import { getUserDatabase } from "./db-manager.js";
import { now } from "../memory/schema.js";
import type { LLMProvider } from "../extraction/llm-extractor.js";

// =============================================================================
// TYPES
// =============================================================================

type CloudSessionData = {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  messageCount: number;
  lastReset: string; // ISO date for daily limit
};

type CloudContext = Context & { session: CloudSessionData };

// =============================================================================
// CONFIG
// =============================================================================

const FREE_DAILY_LIMIT = 20;
const MAX_HISTORY = 8;
const CHAT_MODEL = "claude-sonnet-4-20250514";
const LEARN_MODEL = "claude-haiku-4-5-20251001";

// =============================================================================
// LLM PROVIDER (Direct Anthropic API for cloud)
// =============================================================================

function createAnthropicProvider(model: string): LLMProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });

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
// RATE LIMITING (daily message count per chat)
// =============================================================================

function checkDailyLimit(session: CloudSessionData): { allowed: boolean; remaining: number } {
  const today = new Date().toISOString().slice(0, 10);
  if (session.lastReset !== today) {
    session.messageCount = 0;
    session.lastReset = today;
  }
  const remaining = FREE_DAILY_LIMIT - session.messageCount;
  return { allowed: remaining > 0, remaining: Math.max(0, remaining) };
}

// =============================================================================
// BACKGROUND LEARNING
// =============================================================================

async function learnFromTurn(
  chatId: string,
  llm: LLMProvider,
  userMsg: string,
  assistantMsg: string,
): Promise<void> {
  try {
    const { extractFactsWithLLM } = await import("../extraction/llm-extractor.js");
    const db = getUserDatabase(chatId);
    const text = `User: ${userMsg}\nAssistant: ${assistantMsg}`;
    const episodeId = `tg-${Date.now()}`;
    const facts = await extractFactsWithLLM(llm, text, episodeId);
    for (const fact of facts) {
      try {
        db.insertFact({
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          confidence: fact.confidence,
          evidence: fact.evidence,
          firstSeen: now(),
          lastConfirmed: now(),
          userAffirmed: false,
        });
      } catch { /* ignore duplicate */ }
    }
    if (facts.length > 0) {
      console.log(`[tg-cloud] Learned ${facts.length} facts from chat ${chatId}`);
    }
  } catch (err) {
    console.warn(`[tg-cloud] Learning failed for ${chatId}: ${err}`);
  }
}

// =============================================================================
// BOT SETUP
// =============================================================================

export function startCloudTelegramBot(): Bot<CloudContext> | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[tg-cloud] TELEGRAM_BOT_TOKEN not set. Telegram bot disabled.");
    return null;
  }

  const chatLLM = createAnthropicProvider(CHAT_MODEL);
  const learnLLM = createAnthropicProvider(LEARN_MODEL);

  if (!chatLLM) {
    console.warn("[tg-cloud] ANTHROPIC_API_KEY not set. Telegram bot disabled.");
    return null;
  }

  const bot = new Bot<CloudContext>(token);

  // Session: per-chat, in-memory (resets on deploy -- that's fine, DB persists)
  bot.use(
    session({
      initial: (): CloudSessionData => ({
        history: [],
        messageCount: 0,
        lastReset: new Date().toISOString().slice(0, 10),
      }),
    }),
  );

  // =========================================================================
  // COMMANDS
  // =========================================================================

  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat.id);
    // Touch the DB to create it
    getUserDatabase(chatId);

    await ctx.reply(
      `Welcome to Counting Sheep!\n\n` +
      `I'm an AI that actually remembers you. Every conversation builds my understanding of who you are, what you care about, and how you think.\n\n` +
      `Just talk to me naturally. I'll remember.\n\n` +
      `Commands:\n` +
      `/status - Your memory stats\n` +
      `/recall <query> - Search my memories of you\n` +
      `/facts - Show what I know about you\n` +
      `/forget <topic> - Forget something\n` +
      `/help - All commands\n\n` +
      `Free: ${FREE_DAILY_LIMIT} messages/day\n` +
      `Upgrade: /upgrade`,
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `Counting Sheep - Commands\n\n` +
      `/status - Memory statistics\n` +
      `/recall <query> - Search memories\n` +
      `/facts - Recent facts about you\n` +
      `/forget <topic> - Forget something\n` +
      `/remember <fact> - Store something explicitly\n` +
      `/upgrade - Get unlimited access\n` +
      `/privacy - Data & privacy info\n\n` +
      `Or just chat with me naturally!`,
    );
  });

  bot.command("status", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const db = getUserDatabase(chatId);
    const stats = db.getStats();
    const { remaining } = checkDailyLimit(ctx.session);

    await ctx.reply(
      `Your Memory Stats\n\n` +
      `Facts: ${stats.totalFacts}\n` +
      `Episodes: ${stats.totalEpisodes}\n` +
      `Causal Links: ${stats.totalCausalLinks}\n` +
      `Messages today: ${ctx.session.messageCount}/${FREE_DAILY_LIMIT} (${remaining} left)\n` +
      `Last consolidation: ${stats.lastConsolidation ?? "Never"}`,
    );
  });

  bot.command("facts", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const db = getUserDatabase(chatId);
    const facts = db.findFacts({ activeOnly: true });
    const recent = facts.slice(0, 15);

    if (recent.length === 0) {
      await ctx.reply("No facts yet. Just chat with me and I'll start learning!");
      return;
    }

    const lines = recent.map(
      (f, i) => `${i + 1}. ${f.subject} ${f.predicate} ${f.object}`,
    );
    await ctx.reply(`What I know about you (${recent.length}):\n\n${lines.join("\n")}`);
  });

  bot.command("recall", async (ctx) => {
    const query = ctx.match;
    if (!query) {
      await ctx.reply("Usage: /recall <what to search for>");
      return;
    }
    const chatId = String(ctx.chat.id);
    const db = getUserDatabase(chatId);
    const facts = db.findFacts({ activeOnly: true });
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const matching = facts
      .filter((f) => {
        const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
        return words.some((w) => text.includes(w));
      })
      .slice(0, 10);

    if (matching.length === 0) {
      await ctx.reply("Nothing found for that query.");
      return;
    }
    const lines = matching.map(
      (f, i) => `${i + 1}. ${f.subject} ${f.predicate} ${f.object}`,
    );
    await ctx.reply(`Found ${matching.length} memories:\n\n${lines.join("\n")}`);
  });

  bot.command("remember", async (ctx) => {
    const text = ctx.match;
    if (!text) {
      await ctx.reply("Usage: /remember <something to remember>");
      return;
    }
    const chatId = String(ctx.chat.id);
    const db = getUserDatabase(chatId);
    const ts = now();
    db.insertFact({
      subject: "user",
      predicate: "stated",
      object: text,
      confidence: 1.0,
      evidence: ["explicit /remember"],
      firstSeen: ts,
      lastConfirmed: ts,
      userAffirmed: true,
    });
    await ctx.reply(`Remembered: "${text}"`);
  });

  bot.command("forget", async (ctx) => {
    const topic = ctx.match;
    if (!topic) {
      await ctx.reply("Usage: /forget <topic>");
      return;
    }
    const chatId = String(ctx.chat.id);
    const db = getUserDatabase(chatId);
    const facts = db.findFacts({ activeOnly: true });
    const topicLower = topic.toLowerCase();
    let forgotten = 0;
    for (const fact of facts) {
      if (`${fact.subject} ${fact.predicate} ${fact.object}`.toLowerCase().includes(topicLower)) {
        db.retractFact(fact.id, `User /forget: ${topic}`);
        forgotten++;
      }
    }
    await ctx.reply(`Forgotten ${forgotten} fact(s) about "${topic}".`);
  });

  bot.command("upgrade", async (ctx) => {
    await ctx.reply(
      `Upgrade Counting Sheep\n\n` +
      `Free: ${FREE_DAILY_LIMIT} msgs/day, basic memory\n` +
      `Personal ($9/mo): Unlimited messages, sleep consolidation, causal reasoning\n` +
      `Pro ($19/mo): Multi-device, API access, priority\n\n` +
      `Contact: mb@marsirius.ai\n` +
      `Website: https://marsirius.ai/sheep`,
    );
  });

  bot.command("privacy", async (ctx) => {
    await ctx.reply(
      `Your Data & Privacy\n\n` +
      `- Your memories are stored in an isolated database (not shared with anyone)\n` +
      `- Use /forget to remove specific memories\n` +
      `- Use /deleteall to permanently delete ALL your data\n` +
      `- We comply with GDPR (right to erasure, data export)\n` +
      `- Contact: mb@marsirius.ai`,
    );
  });

  bot.command("deleteall", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const { deleteUserDatabase } = await import("./db-manager.js");
    deleteUserDatabase(chatId);
    await ctx.reply("All your data has been permanently deleted. Start fresh anytime with /start.");
  });

  // =========================================================================
  // MESSAGE HANDLER
  // =========================================================================

  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const chatId = String(ctx.chat.id);

    // Rate limit check
    const { allowed, remaining } = checkDailyLimit(ctx.session);
    if (!allowed) {
      await ctx.reply(
        `You've used all ${FREE_DAILY_LIMIT} free messages today. Resets at midnight UTC.\n\n` +
        `Want unlimited? /upgrade`,
      );
      return;
    }

    ctx.session.messageCount++;

    try {
      // Typing indicator
      await ctx.api.sendChatAction(ctx.chat.id, "typing");
      const typingInterval = setInterval(
        () => ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {}),
        4000,
      );

      // Get user's database
      const db = getUserDatabase(chatId);

      // Fetch relevant memories
      let memoryContext = "";
      try {
        const facts = db.findFacts({ activeOnly: true });
        const words = userMessage.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const relevant = facts
          .filter((f) => {
            const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
            return words.some((w) => text.includes(w));
          })
          .slice(0, 8);

        if (relevant.length > 0) {
          memoryContext =
            "\n\n[Your memories about this user]\n" +
            relevant.map((f) => `- ${f.subject} ${f.predicate} ${f.object}`).join("\n");
        }
      } catch { /* no facts yet */ }

      // Build conversation context
      ctx.session.history.push({ role: "user", content: userMessage });
      if (ctx.session.history.length > MAX_HISTORY * 2) {
        ctx.session.history = ctx.session.history.slice(-MAX_HISTORY);
      }

      const historyText = ctx.session.history
        .slice(-MAX_HISTORY)
        .map((h) => `${h.role === "user" ? "User" : "Sheep"}: ${h.content}`)
        .join("\n");

      const systemPrompt = `You are Counting Sheep, a friendly AI companion that remembers everything.

You have a real memory system. You learn from every conversation and remember across sessions.
When you have relevant memories, use them naturally -- like a friend would.
Never fabricate memories you don't have. If you don't know something, say so.

Keep responses concise and warm. Use short paragraphs. No walls of text.
Match the user's language (if they write in Turkish, respond in Turkish, etc.).
${memoryContext || "\nNo memories yet -- this is a fresh conversation. Everything they tell you will be learned."}

Remaining messages today: ${remaining - 1}`;

      // Generate response
      const reply = await chatLLM.complete(
        `${historyText}\nUser: ${userMessage}\nSheep:`,
        { system: systemPrompt, maxTokens: 800, temperature: 0.7 },
      );

      clearInterval(typingInterval);

      const finalReply = reply?.trim() || "I'm here but had trouble responding. Try again?";
      await ctx.reply(finalReply);

      ctx.session.history.push({ role: "assistant", content: finalReply });

      // Learn in background
      if (learnLLM) {
        learnFromTurn(chatId, learnLLM, userMessage, finalReply).catch(() => {});
      }
    } catch (err) {
      console.error(`[tg-cloud] Error for chat ${chatId}:`, err);
      await ctx.reply("Sorry, something went wrong. Please try again.").catch(() => {});
    }
  });

  // Error handler
  bot.catch((err) => {
    console.error("[tg-cloud] Bot error:", err.error);
  });

  return bot;
}
