/**
 * SHEEP Cloud - Multi-User Telegram Bot
 *
 * Mass-market: every Telegram user gets their own cognitive memory.
 * No install, no API keys. Just open Telegram and chat.
 *
 * Features:
 *   - Guided onboarding (name, use case, demo)
 *   - Telegram Stars in-app payments
 *   - Per-user isolated memory (SQLite)
 *   - Shared brain module (reusable across channels)
 *   - Daily limit for free users, unlimited for paid
 */

import { Bot, Context, InlineKeyboard, session } from "grammy";
import { getUserDatabase } from "./db-manager.js";
import { processMessage, type UserTier } from "./channels/shared-brain.js";
import { now } from "../memory/schema.js";

// =============================================================================
// CONFIG
// =============================================================================

const FREE_DAILY_LIMIT = 20;
const MAX_HISTORY = 8;
const STARS_PERSONAL = 500; // ~$9
const STARS_PRO = 1000;     // ~$19

// =============================================================================
// TYPES
// =============================================================================

type OnboardingStep = "new" | "ask_name" | "ask_usecase" | "done";

type CloudSessionData = {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  messageCount: number;
  lastReset: string;
  tier: UserTier;
  subscriptionExpires: string | null;
  onboardingStep: OnboardingStep;
  userName: string | null;
};

type CloudContext = Context & { session: CloudSessionData };

// =============================================================================
// HELPERS
// =============================================================================

function checkDailyLimit(session: CloudSessionData): { allowed: boolean; remaining: number } {
  if (session.tier !== "free") return { allowed: true, remaining: 999 };
  const today = new Date().toISOString().slice(0, 10);
  if (session.lastReset !== today) {
    session.messageCount = 0;
    session.lastReset = today;
  }
  const remaining = FREE_DAILY_LIMIT - session.messageCount;
  return { allowed: remaining > 0, remaining: Math.max(0, remaining) };
}

function storeFact(userId: string, subject: string, predicate: string, object: string) {
  try {
    const db = getUserDatabase(userId);
    const ts = now();
    db.insertFact({
      subject, predicate, object,
      confidence: 1.0,
      evidence: ["onboarding"],
      firstSeen: ts,
      lastConfirmed: ts,
      userAffirmed: true,
    });
  } catch { /* ignore */ }
}

// =============================================================================
// BOT
// =============================================================================

export function startCloudTelegramBot(): Bot<CloudContext> | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[tg-cloud] TELEGRAM_BOT_TOKEN not set. Telegram bot disabled.");
    return null;
  }

  const bot = new Bot<CloudContext>(token);

  bot.use(
    session({
      initial: (): CloudSessionData => ({
        history: [],
        messageCount: 0,
        lastReset: new Date().toISOString().slice(0, 10),
        tier: "free",
        subscriptionExpires: null,
        onboardingStep: "new",
        userName: null,
      }),
    }),
  );

  // =========================================================================
  // ONBOARDING
  // =========================================================================

  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat.id);
    getUserDatabase(chatId); // create DB

    ctx.session.onboardingStep = "ask_name";

    await ctx.reply(
      `Hey there! I'm Counting Sheep -- an AI that actually remembers you.\n\n` +
      `Unlike other AIs that forget everything after each chat, I learn from our conversations and remember across sessions. The more we talk, the better I know you.\n\n` +
      `Let's get started! What's your name?`,
    );
  });

  // Handle onboarding callback queries (use case buttons)
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = String(ctx.chat!.id);

    if (data.startsWith("usecase_")) {
      const useCase = data.replace("usecase_", "").replace(/_/g, " ");
      storeFact(chatId, "user", "wants_to_use_sheep_for", useCase);
      ctx.session.onboardingStep = "done";

      await ctx.answerCallbackQuery();
      await ctx.editMessageText(`Got it! You want to use me for: ${useCase}`);

      // Show the demo + capabilities
      const db = getUserDatabase(chatId);
      const facts = db.findFacts({ activeOnly: true });
      const factLines = facts.slice(0, 5).map((f) => `  - ${f.subject} ${f.predicate} ${f.object}`);

      await ctx.reply(
        `I just learned ${facts.length} thing(s) about you:\n\n` +
        `${factLines.join("\n")}\n\n` +
        `Try asking me "what do you know about me?" anytime.\n\n` +
        `Here's what I can do:\n` +
        `/recall <query> - Search my memories\n` +
        `/facts - Everything I know about you\n` +
        `/remember <fact> - Store something explicitly\n` +
        `/forget <topic> - Forget something\n` +
        `/status - Your memory stats\n` +
        `/upgrade - Get unlimited access\n\n` +
        `Or just chat naturally -- I learn from every conversation.\n` +
        `Free: ${FREE_DAILY_LIMIT} messages/day. /upgrade for unlimited.`,
      );
      return;
    }

    // Payment callbacks handled below
    await ctx.answerCallbackQuery();
  });

  // =========================================================================
  // COMMANDS
  // =========================================================================

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `Counting Sheep - Commands\n\n` +
      `/status - Memory statistics\n` +
      `/recall <query> - Search memories\n` +
      `/facts - What I know about you\n` +
      `/remember <fact> - Store something\n` +
      `/forget <topic> - Forget something\n` +
      `/upgrade - Unlimited access\n` +
      `/privacy - Data & privacy\n` +
      `/deleteall - Delete all your data\n\n` +
      `Or just chat with me!`,
    );
  });

  bot.command("status", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const db = getUserDatabase(chatId);
    const stats = db.getStats();
    const { remaining } = checkDailyLimit(ctx.session);
    const tierLabel = ctx.session.tier === "free" ? "Free" : ctx.session.tier.charAt(0).toUpperCase() + ctx.session.tier.slice(1);

    await ctx.reply(
      `Your Memory Stats\n\n` +
      `Tier: ${tierLabel}\n` +
      `Facts: ${stats.totalFacts}\n` +
      `Episodes: ${stats.totalEpisodes}\n` +
      `Causal Links: ${stats.totalCausalLinks}\n` +
      (ctx.session.tier === "free"
        ? `Messages today: ${ctx.session.messageCount}/${FREE_DAILY_LIMIT} (${remaining} left)\n`
        : `Messages: Unlimited\n`) +
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
    const lines = recent.map((f, i) => `${i + 1}. ${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`);
    await ctx.reply(`What I know about you (${facts.length} total):\n\n${lines.join("\n")}`);
  });

  bot.command("recall", async (ctx) => {
    const query = ctx.match;
    if (!query) { await ctx.reply("Usage: /recall <what to search for>"); return; }
    const chatId = String(ctx.chat.id);
    const db = getUserDatabase(chatId);
    const facts = db.findFacts({ activeOnly: true });
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const matching = facts.filter((f) => {
      const text = `${f.subject} ${f.predicate} ${f.object}`.toLowerCase();
      return words.some((w) => text.includes(w));
    }).slice(0, 10);
    if (matching.length === 0) { await ctx.reply("Nothing found for that query."); return; }
    const lines = matching.map((f, i) => `${i + 1}. ${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`);
    await ctx.reply(`Found ${matching.length} memories:\n\n${lines.join("\n")}`);
  });

  bot.command("remember", async (ctx) => {
    const text = ctx.match;
    if (!text) { await ctx.reply("Usage: /remember <something to remember>"); return; }
    storeFact(String(ctx.chat.id), "user", "stated", text);
    await ctx.reply(`Remembered: "${text}"`);
  });

  bot.command("forget", async (ctx) => {
    const topic = ctx.match;
    if (!topic) { await ctx.reply("Usage: /forget <topic>"); return; }
    const chatId = String(ctx.chat.id);
    const db = getUserDatabase(chatId);
    const facts = db.findFacts({ activeOnly: true });
    let forgotten = 0;
    for (const fact of facts) {
      if (`${fact.subject} ${fact.predicate} ${fact.object}`.toLowerCase().includes(topic.toLowerCase())) {
        db.retractFact(fact.id, `User /forget: ${topic}`);
        forgotten++;
      }
    }
    await ctx.reply(`Forgotten ${forgotten} fact(s) about "${topic}".`);
  });

  // =========================================================================
  // TELEGRAM STARS PAYMENTS
  // =========================================================================

  bot.command("upgrade", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text(`Personal - ${STARS_PERSONAL} Stars/mo`, "buy_personal")
      .row()
      .text(`Pro - ${STARS_PRO} Stars/mo`, "buy_pro");

    await ctx.reply(
      `Upgrade Counting Sheep\n\n` +
      `Free: ${FREE_DAILY_LIMIT} msgs/day, basic memory\n` +
      `Personal (${STARS_PERSONAL} Stars/mo ≈ $9): Unlimited messages, sleep consolidation, causal reasoning\n` +
      `Pro (${STARS_PRO} Stars/mo ≈ $19): Multi-device, API access, priority\n\n` +
      `Pay with Telegram Stars -- instant, no credit card needed.`,
      { reply_markup: keyboard },
    );
  });

  // Handle buy button clicks
  bot.callbackQuery("buy_personal", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.api.sendInvoice(
      ctx.chat!.id,
      "SHEEP Personal",
      "Unlimited messages, sleep consolidation, causal reasoning, foresight. Renews monthly.",
      "personal_monthly",
      "XTR",
      [{ label: "Personal (1 month)", amount: STARS_PERSONAL }],
      { subscription_period: 2592000 }, // 30 days
    );
  });

  bot.callbackQuery("buy_pro", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.api.sendInvoice(
      ctx.chat!.id,
      "SHEEP Pro",
      "Everything in Personal + multi-device, API access, priority processing. Renews monthly.",
      "pro_monthly",
      "XTR",
      [{ label: "Pro (1 month)", amount: STARS_PRO }],
      { subscription_period: 2592000 },
    );
  });

  // Pre-checkout: must respond within 10 seconds
  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  // Successful payment: upgrade tier
  bot.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    const chatId = String(ctx.chat.id);
    const payload = payment.invoice_payload;

    const tier: UserTier = payload.includes("pro") ? "pro" : "personal";
    ctx.session.tier = tier;

    // Store 30 days from now
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    ctx.session.subscriptionExpires = expires.toISOString();

    storeFact(chatId, "user", "subscription_tier", tier);
    storeFact(chatId, "user", "subscription_expires", expires.toISOString().slice(0, 10));

    const tierName = tier === "pro" ? "Pro" : "Personal";
    await ctx.reply(
      `Payment successful! You're now on SHEEP ${tierName}.\n\n` +
      `Unlimited messages, all features unlocked. Thank you for supporting Counting Sheep!`,
    );

    console.log(`[tg-cloud] Payment: chat ${chatId} upgraded to ${tier} (${payment.total_amount} Stars)`);
  });

  // =========================================================================
  // PRIVACY
  // =========================================================================

  bot.command("privacy", async (ctx) => {
    await ctx.reply(
      `Your Data & Privacy\n\n` +
      `- Your memories are in an isolated database (not shared)\n` +
      `- /forget removes specific memories\n` +
      `- /deleteall permanently deletes ALL your data\n` +
      `- GDPR compliant (right to erasure, data export)\n` +
      `- Contact: mb@marsirius.ai`,
    );
  });

  bot.command("deleteall", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const { deleteUserDatabase } = await import("./db-manager.js");
    deleteUserDatabase(chatId);
    ctx.session.onboardingStep = "new";
    ctx.session.history = [];
    ctx.session.messageCount = 0;
    await ctx.reply("All your data has been permanently deleted. Start fresh with /start.");
  });

  // =========================================================================
  // MESSAGE HANDLER
  // =========================================================================

  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const chatId = String(ctx.chat.id);

    // --- ONBOARDING: ask name ---
    if (ctx.session.onboardingStep === "ask_name") {
      const name = userMessage.trim();
      ctx.session.userName = name;
      storeFact(chatId, "user", "name_is", name);
      ctx.session.onboardingStep = "ask_usecase";

      const keyboard = new InlineKeyboard()
        .text("Personal companion", "usecase_personal_companion").row()
        .text("Work & projects", "usecase_work_and_projects").row()
        .text("Learning & study", "usecase_learning_and_study").row()
        .text("Journal & reflection", "usecase_journal_and_reflection").row()
        .text("Just exploring", "usecase_just_exploring");

      await ctx.reply(
        `Nice to meet you, ${name}! I'll remember that.\n\n` +
        `What would you like to use me for?`,
        { reply_markup: keyboard },
      );
      return;
    }

    // --- RATE LIMIT ---
    const { allowed, remaining } = checkDailyLimit(ctx.session);
    if (!allowed) {
      await ctx.reply(
        `You've used all ${FREE_DAILY_LIMIT} free messages today. Resets at midnight UTC.\n\nWant unlimited? /upgrade`,
      );
      return;
    }
    ctx.session.messageCount++;

    // --- TYPING ---
    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const typingInterval = setInterval(
      () => ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {}),
      4000,
    );

    try {
      // --- SHARED BRAIN ---
      ctx.session.history.push({ role: "user", content: userMessage });
      if (ctx.session.history.length > MAX_HISTORY * 2) {
        ctx.session.history = ctx.session.history.slice(-MAX_HISTORY);
      }

      const result = await processMessage(chatId, userMessage, ctx.session.history, ctx.session.tier);

      clearInterval(typingInterval);
      await ctx.reply(result.reply);

      ctx.session.history.push({ role: "assistant", content: result.reply });

      if (result.factsLearned > 0) {
        console.log(`[tg-cloud] Learned ${result.factsLearned} facts from chat ${chatId}`);
      }
    } catch (err) {
      clearInterval(typingInterval);
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
