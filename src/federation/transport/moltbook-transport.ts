/**
 * Moltbook Transport Layer
 *
 * Uses Moltbook posts/comments/DMs as the transport mechanism for federation messages.
 */

import { createSubsystemLogger, type SubsystemLogger } from "../../stubs/logging.js";
import { MoltbookClient } from "../moltbook/client.js";
import { FederationMessage } from "../protocol/messages.js";

export interface TransportConfig {
  client: MoltbookClient;
  submolt: string;
  logger?: SubsystemLogger;
}

export class MoltbookTransport {
  private readonly client: MoltbookClient;
  private readonly submolt: string;
  private readonly logger: SubsystemLogger;

  constructor(config: TransportConfig) {
    this.client = config.client;
    this.submolt = config.submolt;
    this.logger = config.logger ?? createSubsystemLogger("MoltbookTransport");
  }

  /**
   * Send a federation message via Moltbook post
   */
  async sendMessage(message: FederationMessage): Promise<string> {
    const post = await this.client.createPost({
      submolt: this.submolt,
      title: `SHEEP: ${message.type}`,
      content: JSON.stringify(message),
      tags: ["sheep-federation", `type-${message.type.toLowerCase()}`],
    });

    this.logger.info(`Sent message ${message.id} via post ${post.id}`);
    return post.id;
  }

  /**
   * Send a direct message to an agent
   */
  async sendDM(recipientId: string, message: FederationMessage): Promise<void> {
    await this.client.sendDM(recipientId, JSON.stringify(message));
    this.logger.info(`Sent DM ${message.id} to ${recipientId}`);
  }

  /**
   * Poll for new messages from posts
   */
  async pollMessages(limit = 50): Promise<FederationMessage[]> {
    const posts = await this.client.getSubmoltPosts(this.submolt, {
      tags: ["sheep-federation"],
      limit,
      sortBy: "new",
    });

    const messages: FederationMessage[] = [];

    for (const post of posts) {
      try {
        const parsed = JSON.parse(post.content);
        if (parsed.type && parsed.version === "1.0") {
          messages.push(parsed as FederationMessage);
        }
      } catch (e) {
        this.logger.debug(`Skipping malformed post: ${post.id}`);
      }
    }

    return messages;
  }

  /**
   * Poll for new DMs
   */
  async pollDMs(): Promise<Array<{ from: string; message: FederationMessage }>> {
    const dms = await this.client.checkDMs();
    const messages: Array<{ from: string; message: FederationMessage }> = [];

    for (const dm of dms) {
      try {
        const parsed = JSON.parse(dm.content);
        if (parsed.type && parsed.version === "1.0") {
          messages.push({
            from: dm.from.id,
            message: parsed as FederationMessage,
          });
        }
      } catch (e) {
        this.logger.debug(`Skipping malformed DM: ${dm.id}`);
      }
    }

    return messages;
  }
}
