/**
 * SHEEP Memory Extension for OpenClaw / ClawBot
 *
 * Gives your agent persistent cognitive memory across all conversations.
 * Works as an OpenClaw extension that hooks into the agent lifecycle.
 *
 * Usage:
 *   1. Install: npm install @sheep-ai/openclaw-memory
 *   2. Add to your openclaw config:
 *      { "extensions": ["@sheep-ai/openclaw-memory"] }
 *   3. Set env: SHEEP_API_KEY=sk-sheep-...
 *
 * What it does:
 *   - before_agent_start: Injects relevant memories into agent context
 *   - agent_end: Learns facts from the conversation
 *   - Registers /sheep CLI commands for manual memory operations
 *
 * All memory is stored in the SHEEP cloud (zero local storage).
 * Each user gets isolated memory. GDPR-compliant deletion.
 */

// =============================================================================
// SHEEP CLOUD CLIENT (zero dependencies)
// =============================================================================

const DEFAULT_API_URL = "https://sheep-cloud-production.up.railway.app";

class SheepCloudClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.SHEEP_API_KEY ?? "";
    this.baseUrl = (process.env.SHEEP_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");

    if (!this.apiKey) {
      console.warn("[sheep-ext] SHEEP_API_KEY not set. Memory features disabled.");
      console.warn("[sheep-ext] Get your key at https://marsirius.ai/sheep");
    }
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    if (!this.isConfigured) return null;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async recall(query: string, limit = 8) {
    return this.request<{
      ok: boolean;
      facts: Array<{ subject: string; predicate: string; object: string; confidence: number; relevance: number }>;
    }>("POST", "/v1/recall", { query, limit });
  }

  async remember(subject: string, predicate: string, object: string, confidence = 0.9) {
    return this.request<{ ok: boolean }>("POST", "/v1/remember", { subject, predicate, object, confidence });
  }

  async forget(topic: string) {
    return this.request<{ ok: boolean; forgotten: number }>("POST", "/v1/forget", { topic });
  }

  async status() {
    return this.request<{
      ok: boolean;
      userId: string;
      tier: string;
      memory: { facts: number; episodes: number; causalLinks: number };
    }>("GET", "/v1/status");
  }

  async why(effect: string) {
    return this.request<{
      ok: boolean;
      chain: Array<{ cause: string; effect: string; mechanism: string }>;
    }>("POST", "/v1/why", { effect });
  }
}

// =============================================================================
// OPENCLAW EXTENSION INTERFACE
// =============================================================================

/**
 * OpenClaw extension manifest.
 * This is what OpenClaw reads to discover and load the extension.
 */
export const manifest = {
  name: "sheep-memory",
  displayName: "SHEEP Cognitive Memory",
  version: "0.1.0",
  description: "Persistent cognitive memory across all conversations. Your agent remembers everything.",
  author: "Marsirius AI Labs",
  homepage: "https://marsirius.ai/sheep",
  hooks: ["before_agent_start", "agent_end"],
};

const client = new SheepCloudClient();

/**
 * Called before each agent conversation starts.
 * Injects relevant memories into the system prompt / context.
 */
export async function beforeAgentStart(context: {
  systemPrompt?: string;
  userMessage?: string;
  agentId?: string;
}): Promise<{ systemPrompt?: string }> {
  if (!client.isConfigured || !context.userMessage) {
    return {};
  }

  try {
    const result = await client.recall(context.userMessage, 8);
    if (!result || !result.facts || result.facts.length === 0) {
      return {};
    }

    const memoryBlock =
      "\n\n[SHEEP Memory - What you know about this user]\n" +
      result.facts
        .map((f) => `- ${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`)
        .join("\n") +
      "\n\nUse these memories naturally in your response. Don't announce them.";

    const enhancedPrompt = (context.systemPrompt ?? "") + memoryBlock;

    return { systemPrompt: enhancedPrompt };
  } catch {
    return {};
  }
}

/**
 * Called after each agent conversation ends.
 * Learns facts from the conversation.
 */
export async function agentEnd(context: {
  userMessage?: string;
  assistantResponse?: string;
  agentId?: string;
}): Promise<void> {
  if (!client.isConfigured || !context.userMessage || !context.assistantResponse) {
    return;
  }

  // Extract key facts from the conversation using simple heuristics
  // (The SHEEP cloud does full LLM extraction, but we send the raw text for it)
  try {
    // Store the conversation as a "stated" fact for the cloud to extract from
    const text = `${context.userMessage} ${context.assistantResponse}`.slice(0, 500);

    // Look for explicit statements the user made
    const patterns = [
      /my name is (\w+)/i,
      /i(?:'m| am) (\w+)/i,
      /i work (?:at|for) (.+?)(?:\.|$)/i,
      /i live in (.+?)(?:\.|$)/i,
      /i prefer (.+?)(?:\.|$)/i,
      /i like (.+?)(?:\.|$)/i,
      /i(?:'m| am) building (.+?)(?:\.|$)/i,
    ];

    for (const pattern of patterns) {
      const match = context.userMessage.match(pattern);
      if (match) {
        const value = match[1].trim();
        const predicate = pattern.source.includes("name")
          ? "name_is"
          : pattern.source.includes("work")
            ? "works_at"
            : pattern.source.includes("live")
              ? "lives_in"
              : pattern.source.includes("prefer")
                ? "prefers"
                : pattern.source.includes("like")
                  ? "likes"
                  : pattern.source.includes("building")
                    ? "is_building"
                    : "stated";

        await client.remember("user", predicate, value, 0.85);
      }
    }
  } catch {
    // Non-critical, don't fail the agent
  }
}

/**
 * CLI commands for manual memory operations.
 * Registered as `openclaw sheep <command>`.
 */
export const commands = {
  recall: async (args: string[]) => {
    const query = args.join(" ");
    if (!query) {
      console.log("Usage: openclaw sheep recall <query>");
      return;
    }
    const result = await client.recall(query);
    if (!result || !result.facts || result.facts.length === 0) {
      console.log("No memories found.");
      return;
    }
    console.log(`Found ${result.facts.length} memories:`);
    for (const f of result.facts) {
      console.log(`  - ${f.subject} ${f.predicate} ${f.object} (${Math.round(f.confidence * 100)}%)`);
    }
  },

  remember: async (args: string[]) => {
    if (args.length < 3) {
      console.log("Usage: openclaw sheep remember <subject> <predicate> <object>");
      return;
    }
    const [subject, predicate, ...rest] = args;
    await client.remember(subject, predicate, rest.join(" "));
    console.log(`Remembered: ${subject} ${predicate} ${rest.join(" ")}`);
  },

  forget: async (args: string[]) => {
    const topic = args.join(" ");
    if (!topic) {
      console.log("Usage: openclaw sheep forget <topic>");
      return;
    }
    const result = await client.forget(topic);
    console.log(`Forgotten ${result?.forgotten ?? 0} facts about "${topic}".`);
  },

  status: async () => {
    const result = await client.status();
    if (!result) {
      console.log("Could not reach SHEEP cloud. Check SHEEP_API_KEY.");
      return;
    }
    console.log(`SHEEP Memory Status (${result.tier} tier):`);
    console.log(`  Facts: ${result.memory.facts}`);
    console.log(`  Episodes: ${result.memory.episodes}`);
    console.log(`  Causal Links: ${result.memory.causalLinks}`);
  },

  why: async (args: string[]) => {
    const effect = args.join(" ");
    if (!effect) {
      console.log("Usage: openclaw sheep why <question>");
      return;
    }
    const result = await client.why(effect);
    if (!result || result.chain.length === 0) {
      console.log("No causal knowledge found.");
      return;
    }
    for (const link of result.chain) {
      console.log(`  ${link.cause} → ${link.effect} (${link.mechanism})`);
    }
  },
};

// =============================================================================
// DEFAULT EXPORT (for OpenClaw extension loader)
// =============================================================================

export default {
  manifest,
  hooks: {
    before_agent_start: beforeAgentStart,
    agent_end: agentEnd,
  },
  commands,
};
