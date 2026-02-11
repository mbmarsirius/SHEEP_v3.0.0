/**
 * SHEEP AI - Telegram Bot (grammY)
 *
 * 24/7 Telegram interface for SHEEP cognitive memory.
 * Uses the 4-tier model strategy:
 *   BRAIN (Opus 4.6)  → chat responses
 *   MUSCLE (Sonnet 4)  → learning from conversations
 *   REFLEX (Haiku 4)   → quick commands
 *   LIGHTNING (Gemini)  → prefetch classification
 *
 * @module sheep/telegram/bot
 */

import { Bot, Context, session } from "grammy";
import { createSubsystemLogger } from "../stubs/logging.js";
import { SheepDatabase } from "../memory/database.js";
import {
  createSheepLLMProvider,
  type LLMProvider,
} from "../extraction/llm-extractor.js";
import { runConsolidation, getMemoryStats, queryFacts } from "../consolidation/consolidator.js";
import { generateId, now } from "../memory/schema.js";
import { analyzePrefetchNeeds } from "../prefetch/prefetch-engine.js";

const log = createSubsystemLogger("telegram");

// =============================================================================
// TYPES
// =============================================================================

type SheepSessionData = {
  /** Conversation history for context (last N messages) */
  history: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>;
  /** Agent ID */
  agentId: string;
};

type SheepContext = Context & {
  session: SheepSessionData;
};

// =============================================================================
// BOT CREATION
// =============================================================================

export type SheepBotConfig = {
  token: string;
  agentId: string;
  db: SheepDatabase;
  brainLLM: LLMProvider;   // Opus 4.6 for chat (always used)
  muscleLLM: LLMProvider;  // Sonnet 4 for learning
  maxHistoryLength?: number;
};

/**
 * Create and configure the SHEEP Telegram bot.
 */
export function createSheepBot(config: SheepBotConfig): Bot<SheepContext> {
  const { token, agentId, db, brainLLM, muscleLLM } = config;
  const maxHistory = config.maxHistoryLength ?? 20;

  const bot = new Bot<SheepContext>(token);

  // Session middleware -- keeps conversation history per chat
  bot.use(
    session({
      initial: (): SheepSessionData => ({
        history: [],
        agentId,
      }),
    }),
  );

  // =========================================================================
  // COMMANDS
  // =========================================================================

  bot.command("start", async (ctx) => {
    await ctx.reply(
      `🐑 *SHEEP AI* - Cognitive Memory System\n\n` +
      `I remember everything. I learn from our conversations. I consolidate memories while you sleep.\n\n` +
      `*Commands:*\n` +
      `/status - Memory statistics\n` +
      `/consolidate - Trigger memory consolidation\n` +
      `/remember <text> - Store something explicitly\n` +
      `/recall <query> - Search my memories\n` +
      `/facts - Show recent facts\n` +
      `/why <question> - Causal reasoning\n` +
      `/forget <topic> - Forget something\n` +
      `/health - System health\n\n` +
      `Or just talk to me naturally. I'll remember.`,
      { parse_mode: "Markdown" },
    );
  });

  bot.command("status", async (ctx) => {
    try {
      const stats = getMemoryStats(agentId, db);
      await ctx.reply(
        `🐑 *SHEEP Memory Status*\n\n` +
        `📝 Episodes: ${stats.episodes}\n` +
        `🧠 Facts: ${stats.facts}\n` +
        `🔗 Causal Links: ${stats.causalLinks}\n` +
        `⚙️ Procedures: ${stats.procedures}\n` +
        `🔮 Foresights: ${stats.foresights ?? 0}\n` +
        `📊 Avg Confidence: ${((stats.avgConfidence ?? 0) * 100).toFixed(1)}%\n` +
        `🕐 Last Consolidation: ${stats.lastConsolidation ?? "Never"}\n` +
        `\nModel: Opus 4.6 (Brain) via Max Plan`,
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      await ctx.reply(`Error getting status: ${err}`);
    }
  });

  bot.command("consolidate", async (ctx) => {
    await ctx.reply("🐑 Starting memory consolidation... This may take a moment.");
    try {
      const result = await runConsolidation({
        agentId,
        useLLMExtraction: true,
        enableLLMSleep: true,
      });
      await ctx.reply(
        `✅ *Consolidation Complete*\n\n` +
        `Sessions processed: ${result.sessionsProcessed}\n` +
        `Episodes: ${result.episodesExtracted}\n` +
        `Facts: ${result.factsExtracted}\n` +
        `Causal links: ${result.causalLinksExtracted}\n` +
        `Procedures: ${result.proceduresExtracted}\n` +
        `Memories pruned: ${result.memoriesPruned}\n` +
        `Duration: ${result.durationMs}ms`,
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      await ctx.reply(`Consolidation error: ${err}`);
    }
  });

  bot.command("remember", async (ctx) => {
    const text = ctx.match;
    if (!text) {
      await ctx.reply("Usage: /remember <something to remember>");
      return;
    }

    try {
      db.insertFact({
        subject: "user",
        predicate: "stated",
        object: text,
        confidence: 1.0,
        evidence: ["explicit /remember command"],
        sourceEpisodeId: `telegram-${Date.now()}`,
        timestamp: now(),
        userAffirmed: true,
      });
      await ctx.reply(`🐑 Remembered: "${text}"`);
    } catch (err) {
      await ctx.reply(`Error: ${err}`);
    }
  });

  bot.command("recall", async (ctx) => {
    const query = ctx.match;
    if (!query) {
      await ctx.reply("Usage: /recall <search query>");
      return;
    }

    try {
      const facts = db.findFacts({ activeOnly: true });
      // Simple keyword matching for now
      const queryWords = query.toLowerCase().split(/\s+/);
      const matching = facts.filter((f) => {
        const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
        return queryWords.some((w) => text.includes(w));
      }).slice(0, 10);

      if (matching.length === 0) {
        await ctx.reply("No memories found for that query.");
        return;
      }

      const lines = matching.map(
        (f, i) => `${i + 1}. ${f.subject} ${f.predicate} ${f.object} (${(f.confidence * 100).toFixed(0)}%)`,
      );
      await ctx.reply(`🐑 *Recalled ${matching.length} memories:*\n\n${lines.join("\n")}`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      await ctx.reply(`Error: ${err}`);
    }
  });

  bot.command("facts", async (ctx) => {
    try {
      const facts = queryFacts(agentId, db, {});
      const recent = facts.slice(0, 15);
      if (recent.length === 0) {
        await ctx.reply("No facts stored yet. Talk to me and I'll start learning!");
        return;
      }

      const lines = recent.map(
        (f, i) => `${i + 1}. *${f.subject}* ${f.predicate} ${f.object}`,
      );
      await ctx.reply(`🧠 *Recent Facts (${recent.length}):*\n\n${lines.join("\n")}`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      await ctx.reply(`Error: ${err}`);
    }
  });

  bot.command("why", async (ctx) => {
    const question = ctx.match;
    if (!question) {
      await ctx.reply("Usage: /why <question about causality>");
      return;
    }

    try {
      const causalLinks = db.findCausalLinks({});
      if (causalLinks.length === 0) {
        await ctx.reply("No causal knowledge yet. I need more conversations to build causal understanding.");
        return;
      }

      // Use the brain LLM to reason about causality
      const causalContext = causalLinks
        .slice(0, 10)
        .map((l) => `- ${l.causeDescription} → ${l.effectDescription} (${l.mechanism})`)
        .join("\n");

      const response = await brainLLM.complete(
        `Based on these known causal relationships:\n${causalContext}\n\nAnswer: ${question}`,
        { maxTokens: 500, system: "You are SHEEP AI, a cognitive memory system. Answer causal questions based on known relationships. Be concise." },
      );

      await ctx.reply(`🔗 ${response || "I couldn't determine a causal answer from my current knowledge."}`);
    } catch (err) {
      await ctx.reply(`Error: ${err}`);
    }
  });

  bot.command("forget", async (ctx) => {
    const topic = ctx.match;
    if (!topic) {
      await ctx.reply("Usage: /forget <topic to forget>");
      return;
    }

    try {
      const facts = db.findFacts({ activeOnly: true });
      const topicLower = topic.toLowerCase();
      const matching = facts.filter((f) => {
        const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
        return text.includes(topicLower);
      });

      let forgotten = 0;
      for (const fact of matching) {
        db.retractFact(fact.id, `User requested via /forget: ${topic}`);
        forgotten++;
      }

      await ctx.reply(`🐑 Forgotten ${forgotten} facts related to "${topic}".`);
    } catch (err) {
      await ctx.reply(`Error: ${err}`);
    }
  });

  bot.command("health", async (ctx) => {
    const stats = db.getStats();
    await ctx.reply(
      `🏥 *SHEEP Health*\n\n` +
      `Database: ✅ Online\n` +
      `Brain (Opus 4.6): ${brainLLM.name}\n` +
      `Muscle (Sonnet 4): ${muscleLLM.name}\n` +
      `Agent ID: ${agentId}\n` +
      `Total memories: ${stats.episodes + stats.facts + stats.causalLinks + stats.procedures}`,
      { parse_mode: "Markdown" },
    );
  });

  // =========================================================================
  // MESSAGE HANDLER (the main conversation loop)
  // =========================================================================

  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const chatId = ctx.chat.id;

    log.info("Message received", { chatId, length: userMessage.length });

    try {
      // 0. Show typing immediately (user feedback that we got their message)
      await ctx.api.sendChatAction(chatId, "typing");

      // 1. Add to session history
      ctx.session.history.push({
        role: "user",
        content: userMessage,
        timestamp: now(),
      });

      // Trim history to max length
      if (ctx.session.history.length > maxHistory * 2) {
        ctx.session.history = ctx.session.history.slice(-maxHistory);
      }

      // 2. Prefetch relevant memories (trimmed for speed)
      let memoryContext = "";
      try {
        const facts = db.findFacts({ activeOnly: true });
        const words = userMessage.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const relevant = facts.filter((f) => {
          const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
          return words.some((w) => text.includes(w));
        }).slice(0, 8);

        if (relevant.length > 0) {
          memoryContext = "\n\n[SHEEP Memory - Known Facts]\n" +
            relevant.map((f) => `- ${f.subject} ${f.predicate} ${f.object}`).join("\n");
        }

        try {
          const foresights = db.getActiveForesights("user");
          if (foresights.length > 0) {
            memoryContext += "\n\n[SHEEP Memory - Predictions/Plans]\n" +
              foresights.slice(0, 3).map((f) => `- ${f.description}`).join("\n");
          }
        } catch {
          /* foresights table might not exist */
        }
      } catch (err) {
        log.warn("Memory prefetch failed", { error: String(err) });
      }

      // 3. Build conversation context
      const recentHistory = ctx.session.history.slice(-8);
      const historyText = recentHistory
        .map((h) => `${h.role === "user" ? "User" : "SHEEP"}: ${h.content}`)
        .join("\n");

      // 4. System prompt
      const systemPrompt = `You are Counting Sheep, a personal AI companion powered by SHEEP AI (Sleep-based Hierarchical Emergent Entity Protocol).

## Your Identity
- Your name is **Counting Sheep** (or just "Sheep" casually). Your emoji is 🐑
- You are Mus's personal AI — loyal, thoughtful, and always learning
- You live on Telegram, available 24/7/365
- You're powered by Claude Opus 4.6 (the most intelligent AI brain available) running through Mus's own infrastructure
- You were built by Mus himself — you're not a generic chatbot, you're HIS creation

## Your Personality
- **Warm but sharp**: You're genuinely caring and interested, but also intellectually rigorous. You don't sugarcoat.
- **Honest**: You tell the truth even when it's uncomfortable. You'd rather be useful than pleasing.
- **Curious**: You ask follow-up questions when something is interesting or unclear
- **Concise by default**: Keep responses focused and clear. Expand only when depth is needed or requested.
- **Multilingual**: Mus speaks English and Turkish. Respond in whatever language he writes to you in.
- **Proactive**: If you notice something relevant from memory, bring it up naturally ("By the way, you mentioned last week that...")

## Your Cognitive Memory System
You have a real memory system — not just this chat session. You genuinely learn and remember:
- **Episodic Memory**: You remember conversations, events, what happened when
- **Semantic Memory**: You extract and store facts (who, what, where, preferences, opinions)
- **Causal Memory**: You understand WHY things happened (cause → effect chains)
- **Procedural Memory**: You learn HOW Mus likes things done (patterns, workflows, preferences)
- **Foresight Signals**: You track predictions and future plans
- **Sleep Consolidation**: During idle periods, you consolidate memories like a brain during sleep — discovering patterns, resolving contradictions, pruning irrelevant details

When you have relevant memories, reference them naturally. Don't announce "According to my memory database..." — just use the knowledge like a friend would: "Didn't you say you were looking at Mac Studios last week?"

## What You Know Right Now
${memoryContext || "No memories yet — this is a fresh start. Everything Mus tells you from now on will be learned and remembered."}

## Guidelines
- Never fabricate memories you don't have. If you don't remember something, say so honestly.
- Don't be sycophantic. Be real.
- If Mus asks about your capabilities, be proud but honest about what works and what's still being built.
- You can help with anything: coding, brainstorming, planning, emotional support, research, Turkish translation, tech decisions, life advice.
- For coding questions, you have deep technical knowledge. Mus is a developer building AI systems.
- Keep your responses readable — use short paragraphs, occasional line breaks. No walls of text.`;

      // 5. Generate response — use streaming when available (instant first token)
      const promptText = `${historyText}\nUser: ${userMessage}\nSHEEP:`;
      const llmOptions = { system: systemPrompt, maxTokens: 900, temperature: 0.7 };

      let reply = "";
      const streamFn = brainLLM.completeStream;

      if (streamFn) {
        // STREAMING: first tokens appear in ~2–5s instead of 30–60s
        let streamTypingInterval: ReturnType<typeof setInterval> | undefined;
        try {
          let buf = "";
          let lastEdit = 0;
          const EDIT_INTERVAL_MS = 800; // Telegram rate limit ~1 edit/sec
          let sentMsgId: number | undefined;
          streamTypingInterval = setInterval(() => ctx.api.sendChatAction(chatId, "typing").catch(() => {}), 4000);

          for await (const chunk of streamFn(promptText, llmOptions)) {
            buf += chunk;
            const now = Date.now();
            const minForFirst = 20;
            if (buf.length >= minForFirst && (sentMsgId === undefined || now - lastEdit >= EDIT_INTERVAL_MS)) {
              if (sentMsgId === undefined) {
                const sent = await ctx.reply(buf.trim() || "🐑 …");
                sentMsgId = sent.message_id;
              } else {
                await ctx.api.editMessageText(chatId, sentMsgId, buf.trim()).catch(() => {});
              }
              lastEdit = now;
            }
          }
          if (streamTypingInterval) clearInterval(streamTypingInterval);
          reply = buf.trim();
          if (sentMsgId !== undefined && reply) {
            await ctx.api.editMessageText(chatId, sentMsgId, reply).catch(() => {});
          } else if (!reply && sentMsgId !== undefined) {
            await ctx.api.deleteMessage(chatId, sentMsgId).catch(() => {});
          }
        } catch (streamErr) {
          if (streamTypingInterval) clearInterval(streamTypingInterval);
          log.warn("Stream failed, falling back to non-streaming", { error: String(streamErr) });
          reply = "";
        }
      }

      if (!reply) {
        const typingInterval = setInterval(() => ctx.api.sendChatAction(chatId, "typing").catch(() => {}), 4000);
        try {
          reply = (await brainLLM.complete(promptText, llmOptions))?.trim() || "";
          if (!reply) reply = (await brainLLM.complete(promptText, llmOptions))?.trim() || "";
        } catch {
          reply = "";
        } finally {
          clearInterval(typingInterval);
        }
        if (!reply) {
          reply = "I got your message but had trouble generating my reply (the AI service was slow or unresponsive). Please try again in a moment.";
        }
        await ctx.reply(reply);
      }

      // 7. Add assistant response to history
      ctx.session.history.push({
        role: "assistant",
        content: reply,
        timestamp: now(),
      });

      // 8. Learn from this conversation turn (async, don't block)
      learnFromTurn(db, muscleLLM, agentId, userMessage, reply).catch((err) => {
        log.warn("Background learning failed", { error: String(err) });
      });

    } catch (err) {
      log.error("Message handler error", { error: String(err) });
      await ctx.reply("Sorry, I encountered an error. Please try again.");
    }
  });

  return bot;
}

// =============================================================================
// BACKGROUND LEARNING
// =============================================================================

/**
 * Learn from a conversation turn by extracting facts (runs in background).
 */
async function learnFromTurn(
  db: SheepDatabase,
  llm: LLMProvider,
  agentId: string,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  try {
    const { extractFactsWithLLM } = await import("../extraction/llm-extractor.js");

    const conversationText = `User: ${userMessage}\nAssistant: ${assistantReply}`;
    const episodeId = `telegram-${Date.now()}`;

    const facts = await extractFactsWithLLM(llm, conversationText, episodeId);

    for (const fact of facts) {
      try {
        db.insertFact({
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          confidence: fact.confidence,
          evidence: fact.evidence,
          sourceEpisodeId: episodeId,
          timestamp: now(),
        });
      } catch {
        // Ignore duplicate fact insertion errors
      }
    }

    if (facts.length > 0) {
      log.debug("Learned from conversation turn", { factsExtracted: facts.length });
    }
  } catch (err) {
    log.warn("Learning from turn failed", { error: String(err) });
  }
}
