/**
 * Template Exchange Coordinator
 */

import { randomUUID } from "crypto";
import { createSubsystemLogger, type SubsystemLogger } from "../../../logging/subsystem.js";
import { MoltbookDiscovery } from "../moltbook/discovery.js";
import { ReputationSystem } from "../moltbook/reputation.js";
import { TemplateAnonymizer } from "../privacy/anonymizer.js";
import { TemplateEncryption, EncryptedTemplate } from "../privacy/encryption.js";
import {
  FederationMessage,
  TemplateOfferMessage,
  TemplateExchangeMessage,
  AckMessage,
} from "./messages.js";
import { MessageSigning } from "./signing.js";

export interface Template {
  id: string;
  type: "fact" | "causal" | "procedure" | "heuristic";
  content: string;
  category: string;
  confidence: number;
  evidence: string[];
}

export interface ExchangeResult {
  success: boolean;
  templateId: string;
  recipientId: string;
  error?: string;
}

export class TemplateExchange {
  private readonly signing: MessageSigning;
  private readonly anonymizer: TemplateAnonymizer;
  private readonly encryption: TemplateEncryption;
  private readonly discovery: MoltbookDiscovery;
  private readonly reputation: ReputationSystem;
  private readonly logger: SubsystemLogger;
  private readonly agentId: string;
  private sharedSecret: string;

  constructor(config: {
    agentId: string;
    signing: MessageSigning;
    discovery: MoltbookDiscovery;
    reputation: ReputationSystem;
    sharedSecret: string;
    logger?: SubsystemLogger;
  }) {
    this.agentId = config.agentId;
    this.signing = config.signing;
    this.anonymizer = new TemplateAnonymizer();
    this.encryption = new TemplateEncryption();
    this.discovery = config.discovery;
    this.reputation = config.reputation;
    this.sharedSecret = config.sharedSecret;
    this.logger = config.logger ?? createSubsystemLogger("TemplateExchange");
  }

  /**
   * Offer a template to the federation
   */
  async offerTemplate(template: Template): Promise<TemplateOfferMessage> {
    // 1. Anonymize
    const anonymized = this.anonymizer.anonymize(template.content);

    // 2. Verify safe
    const safety = this.anonymizer.verifySafe(anonymized);
    if (!safety.safe) {
      throw new Error(`Template not safe: ${safety.issues.join(", ")}`);
    }

    // 3. Create offer message
    const message: TemplateOfferMessage = {
      id: randomUUID(),
      type: "TEMPLATE_OFFER",
      version: "1.0",
      timestamp: new Date().toISOString(),
      senderId: this.agentId,
      payload: {
        templateId: template.id,
        templateType: template.type,
        category: template.category,
        preview: anonymized.anonymizedContent.slice(0, 200),
        confidence: template.confidence,
        usageCount: 1,
      },
    };

    // 4. Sign
    const dataToSign = JSON.stringify({ ...message, signature: undefined });
    message.signature = this.signing.sign(dataToSign);

    this.logger.info(`Created template offer: ${template.id}`);

    return message;
  }

  /**
   * Send template to specific agent
   */
  async sendTemplate(
    template: Template,
    recipientId: string,
    encrypt = true,
  ): Promise<ExchangeResult> {
    // 1. Check recipient trust
    const trusted = await this.reputation.isTrusted(recipientId);
    if (!trusted) {
      return {
        success: false,
        templateId: template.id,
        recipientId,
        error: "Recipient not trusted",
      };
    }

    // 2. Anonymize
    const anonymized = this.anonymizer.anonymize(template.content);

    // 3. Verify safe
    const safety = this.anonymizer.verifySafe(anonymized);
    if (!safety.safe) {
      return {
        success: false,
        templateId: template.id,
        recipientId,
        error: `Not safe: ${safety.issues.join(", ")}`,
      };
    }

    // 4. Optionally encrypt
    let content = anonymized.anonymizedContent;
    let encrypted = false;

    if (encrypt) {
      const encryptedData = this.encryption.encrypt(
        content,
        this.agentId,
        recipientId,
        this.sharedSecret,
      );
      content = JSON.stringify(encryptedData);
      encrypted = true;
    }

    // 5. Create exchange message
    const message: TemplateExchangeMessage = {
      id: randomUUID(),
      type: "TEMPLATE_EXCHANGE",
      version: "1.0",
      timestamp: new Date().toISOString(),
      senderId: this.agentId,
      payload: {
        templateId: template.id,
        templateType: template.type,
        content,
        encrypted,
        confidence: template.confidence,
        evidence: template.evidence.slice(0, 10),
      },
    };

    // 6. Sign
    const dataToSign = JSON.stringify({ ...message, signature: undefined });
    message.signature = this.signing.sign(dataToSign);

    // 7. Record sharing
    this.reputation.recordTemplateShared(this.agentId);

    this.logger.info(`Sent template ${template.id} to ${recipientId}`);

    return {
      success: true,
      templateId: template.id,
      recipientId,
    };
  }

  /**
   * Receive and process a template
   */
  async receiveTemplate(
    message: TemplateExchangeMessage,
    senderPublicKey: string,
  ): Promise<{ accepted: boolean; template?: Template; reason?: string }> {
    // 1. Verify signature
    if (message.signature) {
      const dataToVerify = JSON.stringify({ ...message, signature: undefined });
      const valid = this.signing.verify(dataToVerify, message.signature, senderPublicKey);

      if (!valid) {
        return { accepted: false, reason: "Invalid signature" };
      }
    }

    // 2. Check sender trust
    const trusted = await this.reputation.isTrusted(message.senderId);
    if (!trusted) {
      return { accepted: false, reason: "Sender not trusted" };
    }

    // 3. Decrypt if needed
    let content = message.payload.content;

    if (message.payload.encrypted) {
      try {
        const encryptedData = JSON.parse(content) as EncryptedTemplate;
        content = this.encryption.decrypt(encryptedData, this.agentId, this.sharedSecret);
      } catch (e) {
        return { accepted: false, reason: "Decryption failed" };
      }
    }

    // 4. Build template
    const template: Template = {
      id: message.payload.templateId,
      type: message.payload.templateType,
      content,
      category: "imported",
      confidence: message.payload.confidence,
      evidence: message.payload.evidence,
    };

    // 5. Record acceptance
    this.reputation.recordTemplateAccepted(message.senderId);

    this.logger.info(`Accepted template ${template.id} from ${message.senderId}`);

    return { accepted: true, template };
  }

  /**
   * Create ACK message
   */
  createAck(
    originalMessageId: string,
    status: "received" | "accepted" | "rejected",
    reason?: string,
  ): AckMessage {
    const message: AckMessage = {
      id: randomUUID(),
      type: "ACK",
      version: "1.0",
      timestamp: new Date().toISOString(),
      senderId: this.agentId,
      payload: {
        originalMessageId,
        status,
        reason,
      },
    };

    const dataToSign = JSON.stringify({ ...message, signature: undefined });
    message.signature = this.signing.sign(dataToSign);

    return message;
  }
}
