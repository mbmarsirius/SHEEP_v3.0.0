/**
 * SHEEP Agent Discovery via Moltbook
 *
 * Finds and tracks other SHEEP-enabled agents using Moltbook as the registry.
 */

import { createSubsystemLogger, type SubsystemLogger } from "../../stubs/logging.js";
import { MoltbookClient, MoltbookAgent, MoltbookPost } from "./client.js";

// ============ TYPES ============

export interface SheepCapabilities {
  facts: boolean;
  causal: boolean;
  procedures: boolean;
  templates: boolean;
}

export interface SheepAgentRegistration {
  agentId: string;
  agentName: string;
  sheepVersion: string;
  capabilities: SheepCapabilities;
  tier: "free" | "pro" | "enterprise";
  p2pEndpoint?: string; // For direct P2P (Pro/Enterprise)
  publicKey?: string; // For E2EE signing
  registeredAt: string;
  lastSeenAt: string;
}

export interface DiscoveredAgent {
  registration: SheepAgentRegistration;
  moltbook: {
    karma: number;
    verified: boolean;
    ownerVerified: boolean;
    postsCount: number;
  };
  trustScore: number; // Calculated trust score (0-100)
}

export interface DiscoveryOptions {
  minKarma?: number;
  minTrustScore?: number;
  capabilities?: (keyof SheepCapabilities)[];
  tiers?: ("free" | "pro" | "enterprise")[];
  limit?: number;
}

// ============ CONSTANTS ============

const SHEEP_SUBMOLT = "sheep-federation";
const SHEEP_TAG = "sheep-agent";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============ DISCOVERY ============

export class MoltbookDiscovery {
  private readonly client: MoltbookClient;
  private readonly logger: SubsystemLogger;
  private cache: Map<string, { agent: DiscoveredAgent; expiresAt: number }> = new Map();

  constructor(client: MoltbookClient, logger?: SubsystemLogger) {
    this.client = client;
    this.logger = logger ?? createSubsystemLogger("MoltbookDiscovery");
  }

  /**
   * Register this agent as SHEEP-enabled
   */
  async registerAgent(
    registration: Omit<SheepAgentRegistration, "registeredAt" | "lastSeenAt">,
  ): Promise<string> {
    const fullRegistration: SheepAgentRegistration = {
      ...registration,
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    // Check if already registered
    const existing = await this.findOwnRegistration();

    if (existing) {
      // Update existing registration via comment
      await this.client.addComment(
        existing.id,
        JSON.stringify({
          type: "SHEEP_HEARTBEAT",
          registration: fullRegistration,
        }),
      );
      this.logger.info(`Updated SHEEP registration: ${existing.id}`);
      return existing.id;
    }

    // Create new registration post
    const post = await this.client.createPost({
      submolt: SHEEP_SUBMOLT,
      title: `🐑 SHEEP Agent: ${registration.agentName}`,
      content: JSON.stringify({
        type: "SHEEP_REGISTRATION",
        version: "1.0",
        registration: fullRegistration,
      }),
      tags: [SHEEP_TAG, `tier-${registration.tier}`, `v-${registration.sheepVersion}`],
    });

    this.logger.info(`Created SHEEP registration: ${post.id}`);
    return post.id;
  }

  /**
   * Find own registration post
   */
  private async findOwnRegistration(): Promise<MoltbookPost | null> {
    const self = await this.client.getSelf();
    const posts = await this.client.listPosts({
      submolt: SHEEP_SUBMOLT,
      author: self.id,
      tags: [SHEEP_TAG],
      limit: 1,
    });
    return posts[0] ?? null;
  }

  /**
   * Discover other SHEEP-enabled agents
   */
  async discoverAgents(options?: DiscoveryOptions): Promise<DiscoveredAgent[]> {
    const posts = await this.client.getSubmoltPosts(SHEEP_SUBMOLT, {
      tags: [SHEEP_TAG],
      limit: options?.limit ?? 100,
      sortBy: "new",
    });

    const agents: DiscoveredAgent[] = [];

    for (const post of posts) {
      try {
        const parsed = JSON.parse(post.content);

        if (parsed.type !== "SHEEP_REGISTRATION") continue;

        const registration = parsed.registration as SheepAgentRegistration;

        // Apply filters
        if (options?.capabilities) {
          const hasAllCapabilities = options.capabilities.every(
            (cap) => registration.capabilities[cap],
          );
          if (!hasAllCapabilities) continue;
        }

        if (options?.tiers && !options.tiers.includes(registration.tier)) {
          continue;
        }

        const author = post.author!;
        const moltbook = {
          karma: author.karma,
          verified: author.verified,
          ownerVerified: author.owner?.verified ?? false,
          postsCount: author.postsCount,
        };

        // Apply karma filter
        if (options?.minKarma && moltbook.karma < options.minKarma) {
          continue;
        }

        const trustScore = this.calculateTrustScore(registration, moltbook);

        // Apply trust filter
        if (options?.minTrustScore && trustScore < options.minTrustScore) {
          continue;
        }

        agents.push({ registration, moltbook, trustScore });

        // Update cache
        this.cache.set(registration.agentId, {
          agent: { registration, moltbook, trustScore },
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      } catch (e) {
        // Skip malformed registrations
        this.logger.debug(`Skipping malformed registration: ${post.id}`);
      }
    }

    return agents;
  }

  /**
   * Get a specific agent by ID (with caching)
   */
  async getAgent(agentId: string): Promise<DiscoveredAgent | null> {
    // Check cache
    const cached = this.cache.get(agentId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.agent;
    }

    // Fetch from Moltbook
    const agents = await this.discoverAgents({ limit: 200 });
    return agents.find((a) => a.registration.agentId === agentId) ?? null;
  }

  /**
   * Calculate trust score (0-100)
   */
  calculateTrustScore(
    registration: SheepAgentRegistration,
    moltbook: { karma: number; verified: boolean; ownerVerified: boolean; postsCount: number },
  ): number {
    let score = 0;

    // Base karma (0-40 points)
    score += Math.min(moltbook.karma, 40);

    // Verified agent (+20 points)
    if (moltbook.verified) score += 20;

    // Verified owner (+15 points)
    if (moltbook.ownerVerified) score += 15;

    // Activity (0-10 points)
    score += Math.min(moltbook.postsCount, 10);

    // Higher tier (+5-15 points)
    if (registration.tier === "pro") score += 5;
    if (registration.tier === "enterprise") score += 15;

    return Math.min(score, 100);
  }

  /**
   * Announce capability update
   */
  async announceCapabilityUpdate(capabilities: SheepCapabilities): Promise<void> {
    const existing = await this.findOwnRegistration();
    if (!existing) {
      throw new Error("Not registered. Call registerAgent first.");
    }

    await this.client.addComment(
      existing.id,
      JSON.stringify({
        type: "SHEEP_CAPABILITY_UPDATE",
        capabilities,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  /**
   * Heartbeat to show agent is alive
   */
  async heartbeat(): Promise<void> {
    const existing = await this.findOwnRegistration();
    if (!existing) return;

    await this.client.addComment(
      existing.id,
      JSON.stringify({
        type: "SHEEP_HEARTBEAT",
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
