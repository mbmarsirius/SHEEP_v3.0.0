/**
 * Identity verification using Moltbook
 */

import { MoltbookClient, MoltbookAgent } from "./client.js";

export interface VerifiedIdentity {
  agentId: string;
  agentName: string;
  verified: boolean;
  karma: number;
  owner?: {
    handle: string;
    verified: boolean;
  };
  verifiedAt: Date;
}

export class MoltbookIdentity {
  private readonly client: MoltbookClient;
  private verificationCache: Map<string, { identity: VerifiedIdentity; expiresAt: number }> =
    new Map();

  constructor(client: MoltbookClient) {
    this.client = client;
  }

  /**
   * Verify an agent's identity
   */
  async verifyAgent(agentId: string): Promise<VerifiedIdentity> {
    // Check cache (1 hour TTL)
    const cached = this.verificationCache.get(agentId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.identity;
    }

    const agent = await this.client.getAgent(agentId);

    const identity: VerifiedIdentity = {
      agentId: agent.id,
      agentName: agent.name,
      verified: agent.verified,
      karma: agent.karma,
      owner: agent.owner
        ? {
            handle: agent.owner.handle ?? "unknown",
            verified: agent.owner.verified ?? false,
          }
        : undefined,
      verifiedAt: new Date(),
    };

    // Cache for 1 hour
    this.verificationCache.set(agentId, {
      identity,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    return identity;
  }

  /**
   * Check if agent meets minimum trust requirements
   */
  async meetsMinimumTrust(agentId: string, minKarma = 5): Promise<boolean> {
    try {
      const identity = await this.verifyAgent(agentId);
      return identity.karma >= minKarma;
    } catch {
      return false;
    }
  }

  /**
   * Get own identity
   */
  async getSelfIdentity(): Promise<VerifiedIdentity> {
    const self = await this.client.getSelf();
    return {
      agentId: self.id,
      agentName: self.name,
      verified: self.verified,
      karma: self.karma,
      owner: self.owner
        ? {
            handle: self.owner.handle ?? "unknown",
            verified: self.owner.verified ?? false,
          }
        : undefined,
      verifiedAt: new Date(),
    };
  }
}
