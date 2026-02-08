/**
 * Reputation system using Moltbook karma + SHEEP-specific metrics
 */

import { SheepDatabase } from "../../memory/database.js";
import { MoltbookClient } from "./client.js";

export interface AgentReputation {
  agentId: string;
  moltbookKarma: number;
  sheepScore: number; // SHEEP-specific reputation
  templatesShared: number;
  templatesAccepted: number;
  templateRejections: number;
  lastInteraction?: Date;
  combinedScore: number; // Weighted combination
}

export class ReputationSystem {
  private readonly client: MoltbookClient;
  private readonly db: SheepDatabase;
  private localScores: Map<string, Omit<AgentReputation, "moltbookKarma" | "combinedScore">> =
    new Map();

  constructor(client: MoltbookClient, db: SheepDatabase) {
    this.client = client;
    this.db = db;
  }

  /**
   * Get agent's full reputation
   */
  async getReputation(agentId: string): Promise<AgentReputation> {
    const agent = await this.client.getAgent(agentId);
    const local = this.localScores.get(agentId) ?? {
      agentId,
      sheepScore: 50, // Default neutral score
      templatesShared: 0,
      templatesAccepted: 0,
      templateRejections: 0,
    };

    const combinedScore = this.calculateCombinedScore(agent.karma, local.sheepScore);

    return {
      ...local,
      moltbookKarma: agent.karma,
      combinedScore,
    };
  }

  /**
   * Record template interaction (for local SHEEP reputation)
   */
  recordTemplateAccepted(agentId: string): void {
    const current = this.localScores.get(agentId) ?? this.defaultScore(agentId);
    current.templatesAccepted++;
    current.sheepScore = Math.min(100, current.sheepScore + 2);
    current.lastInteraction = new Date();
    this.localScores.set(agentId, current);
  }

  recordTemplateRejected(agentId: string): void {
    const current = this.localScores.get(agentId) ?? this.defaultScore(agentId);
    current.templateRejections++;
    current.sheepScore = Math.max(0, current.sheepScore - 5);
    current.lastInteraction = new Date();
    this.localScores.set(agentId, current);
  }

  recordTemplateShared(agentId: string): void {
    const current = this.localScores.get(agentId) ?? this.defaultScore(agentId);
    current.templatesShared++;
    current.lastInteraction = new Date();
    this.localScores.set(agentId, current);
  }

  private defaultScore(agentId: string): Omit<AgentReputation, "moltbookKarma" | "combinedScore"> {
    return {
      agentId,
      sheepScore: 50,
      templatesShared: 0,
      templatesAccepted: 0,
      templateRejections: 0,
    };
  }

  private calculateCombinedScore(moltbookKarma: number, sheepScore: number): number {
    // 60% Moltbook karma, 40% SHEEP score
    const normalizedKarma = Math.min((moltbookKarma / 100) * 100, 100);
    return Math.round(normalizedKarma * 0.6 + sheepScore * 0.4);
  }

  /**
   * Check if agent is trusted enough for federation
   */
  async isTrusted(agentId: string, minScore = 30): Promise<boolean> {
    const rep = await this.getReputation(agentId);
    return rep.combinedScore >= minScore;
  }
}
