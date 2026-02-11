#!/usr/bin/env node
/**
 * SHEEP AI - Interactive Terminal Demo
 *
 * 1. Chat with SHEEP for 2-3 minutes
 * 2. Memories extracted in real-time (shown after each exchange)
 * 3. "restart" simulates close/reopen - recalls everything
 * 4. Ask questions, get answers from memory
 *
 * Usage: pnpm run demo
 */

import * as readline from "node:readline";
import { SheepDatabase } from "../memory/database.js";
import {
  extractFactsWithLLM,
  extractCausalLinksWithLLM,
  createSheepLLMProvider,
  type LLMProvider,
} from "../extraction/llm-extractor.js";

const DEMO_AGENT = "demo";
let llm: LLMProvider | null = null;
const conversation: Array<{ role: "user" | "assistant"; text: string }> = [];

function getConversationText(): string {
  return conversation.map((m) => `[${m.role}]: ${m.text}`).join("\n\n");
}

async function extractAndStore(): Promise<void> {
  if (!llm || conversation.length < 2) return;
  const text = getConversationText();
  if (text.length < 30) return;
  try {
    const db = new SheepDatabase(DEMO_AGENT);
    const facts = await extractFactsWithLLM(llm, text, `demo-${Date.now()}`);
    const causal = await extractCausalLinksWithLLM(llm, text, `demo-${Date.now()}`);
    for (const f of facts) {
      try {
        db.insertFact({
          subject: f.subject,
          predicate: f.predicate,
          object: f.object,
          confidence: f.confidence,
          evidence: f.evidence,
          firstSeen: new Date().toISOString(),
          lastConfirmed: new Date().toISOString(),
          userAffirmed: false,
        });
      } catch {
        /* dedup or skip */
      }
    }
    for (const c of causal) {
      try {
        db.insertCausalLink(c);
      } catch {
        /* skip */
      }
    }
    db.close();
    return { facts, causal };
  } catch {
    return;
  }
}

async function answerFromMemory(question: string): Promise<string> {
  if (!llm) return "Demo not initialized.";
  const db = new SheepDatabase(DEMO_AGENT);
  const facts = db.findFacts({ activeOnly: true });
  const causal = db.findCausalLinks({});
  db.close();
  const factLines = facts.slice(0, 15).map((f) => `- ${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`).join("\n");
  const causalLines = causal.slice(0, 5).map((c) => `- ${c.causeDescription} → ${c.effectDescription}`).join("\n");
  const context = [factLines, causalLines].filter(Boolean).join("\n") || "(no memories yet)";
  const prompt = `Answer using ONLY these memories. Reply with just the answer, 1-15 words.

Memories:
${context}

Question: ${question}

Answer:`;
  const ans = await llm.complete(prompt, { maxTokens: 80 } as { maxTokens?: number });
  return (typeof ans === "string" ? ans : String(ans ?? "")).trim().split(/[.!?\n]/)[0] ?? "";
}

function printMemories(): void {
  const db = new SheepDatabase(DEMO_AGENT);
  const stats = db.getStats();
  const facts = db.findFacts({ activeOnly: true }).slice(0, 10);
  const causal = db.findCausalLinks({}).slice(0, 3);
  db.close();
  if (stats.totalFacts === 0 && stats.totalCausalLinks === 0) return;
  console.log("\n  📝 Memories:");
  for (const f of facts) {
    console.log(`     • ${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`);
  }
  for (const c of causal) {
    console.log(`     • ${c.causeDescription} → ${c.effectDescription}`);
  }
  console.log("");
}

async function main() {
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SHEEP AI - Interactive Demo");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("\n  Hi! I'm SHEEP. Let's have a conversation.");
  console.log("  I'll remember what you tell me. Type 'restart' to simulate close/reopen.");
  console.log("  Type 'recall <question>' to ask from memory. Type 'quit' to exit.\n");

  try {
    llm = await createSheepLLMProvider("extraction");
  } catch (err) {
    console.error("  LLM unavailable:", err);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (): void => {
    rl.question("  You: ", async (line) => {
      const input = (line ?? "").trim();
      if (!input) {
        ask();
        return;
      }
      if (input.toLowerCase() === "quit" || input.toLowerCase() === "exit") {
        console.log("\n  Goodbye! 👋\n");
        rl.close();
        process.exit(0);
        return;
      }
      if (input.toLowerCase() === "restart") {
        console.log("\n  🔄 Simulating close/reopen... Loading memories.\n");
        printMemories();
        console.log("  I remember everything from our conversation. Ask me anything!\n");
        ask();
        return;
      }
      if (input.toLowerCase().startsWith("recall ")) {
        const q = input.slice(7).trim();
        if (q) {
          const ans = await answerFromMemory(q);
          console.log(`  SHEEP: ${ans}\n`);
        }
        ask();
        return;
      }

      conversation.push({ role: "user", text: input });
      conversation.push({ role: "assistant", text: `[SHEEP acknowledges: "${input}"]` });

      const result = await extractAndStore();
      if (result && (result.facts.length > 0 || result.causal.length > 0)) {
        console.log("\n  ✨ New memories extracted:");
        for (const f of result.facts) {
          console.log(`     • ${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`);
        }
        for (const c of result.causal) {
          console.log(`     • ${c.causeDescription} → ${c.effectDescription}`);
        }
        console.log("");
      }

      console.log("  SHEEP: Got it! I've remembered that.\n");
      ask();
    });
  };

  ask();
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
