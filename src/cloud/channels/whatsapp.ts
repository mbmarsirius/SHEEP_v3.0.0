/**
 * SHEEP Cloud - WhatsApp Cloud API Channel
 *
 * Webhook handler for WhatsApp Business API (hosted by Meta).
 * Each WhatsApp phone number -> isolated SHEEP memory.
 *
 * Setup:
 *   1. Create a Meta Business account
 *   2. Add a phone number in Meta Business Suite
 *   3. Set webhook URL to: https://sheep-cloud-production.up.railway.app/webhook/whatsapp
 *   4. Set env vars: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN
 *
 * Env vars:
 *   WHATSAPP_TOKEN       -- Cloud API access token from Meta
 *   WHATSAPP_PHONE_ID    -- Your WhatsApp Business phone number ID
 *   WHATSAPP_VERIFY_TOKEN -- Any string you choose for webhook verification
 */

import { Router, type Router as IRouter } from "express";
import { processMessage } from "./shared-brain.js";

const router: IRouter = Router();

// In-memory history per WhatsApp user (resets on deploy)
const userHistories = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

// =============================================================================
// GET /webhook/whatsapp -- Meta verification challenge
// =============================================================================

router.get("/webhook/whatsapp", (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? "sheep-verify";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[whatsapp] Webhook verified");
    res.status(200).send(challenge);
  } else {
    console.warn("[whatsapp] Webhook verification failed");
    res.status(403).send("Forbidden");
  }
});

// =============================================================================
// POST /webhook/whatsapp -- Incoming messages
// =============================================================================

router.post("/webhook/whatsapp", async (req, res) => {
  // Always respond 200 immediately (Meta requires this)
  res.status(200).send("OK");

  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return;

    const msg = messages[0];
    if (msg.type !== "text") return; // Only handle text messages for now

    const from = msg.from; // WhatsApp phone number (e.g. "905551234567")
    const text = msg.text?.body;
    if (!from || !text) return;

    console.log(`[whatsapp] Message from ${from}: ${text.slice(0, 50)}`);

    // Get/create history for this user
    let history = userHistories.get(from);
    if (!history) {
      history = [];
      userHistories.set(from, history);
    }

    history.push({ role: "user", content: text });
    if (history.length > 16) {
      userHistories.set(from, history.slice(-8));
      history = userHistories.get(from)!;
    }

    // Process through shared brain (userId = "wa-" + phone number)
    const userId = `wa-${from}`;
    const result = await processMessage(userId, text, history, "free");

    history.push({ role: "assistant", content: result.reply });

    // Send reply via WhatsApp Cloud API
    await sendWhatsAppMessage(from, result.reply);

    if (result.factsLearned > 0) {
      console.log(`[whatsapp] Learned ${result.factsLearned} facts from ${from}`);
    }
  } catch (err) {
    console.error("[whatsapp] Error handling message:", err);
  }
});

// =============================================================================
// Send message via WhatsApp Cloud API
// =============================================================================

async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.warn("[whatsapp] WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set. Cannot send.");
    return;
  }

  const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`[whatsapp] Send failed (${resp.status}): ${err}`);
  }
}

export default router;
