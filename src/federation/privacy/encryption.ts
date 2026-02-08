/**
 * Template Encryption (AES-256-GCM)
 *
 * Encrypts templates before sharing via Moltbook transport.
 * Only the intended recipient can decrypt.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

export interface EncryptedTemplate {
  ciphertext: string; // Base64 encoded
  iv: string; // Base64 encoded
  tag: string; // Auth tag, Base64
  recipientId: string; // Intended recipient
  senderId: string;
  algorithm: "aes-256-gcm";
}

export class TemplateEncryption {
  private readonly algorithm = "aes-256-gcm" as const;

  /**
   * Derive shared key from agent IDs (simplified - in production use ECDH)
   */
  private deriveKey(senderId: string, recipientId: string, sharedSecret: string): Buffer {
    const combined = `${senderId}:${recipientId}:${sharedSecret}`;
    return createHash("sha256").update(combined).digest();
  }

  /**
   * Encrypt template for specific recipient
   */
  encrypt(
    content: string,
    senderId: string,
    recipientId: string,
    sharedSecret: string,
  ): EncryptedTemplate {
    const key = this.deriveKey(senderId, recipientId, sharedSecret);
    const iv = randomBytes(16);

    const cipher = createCipheriv(this.algorithm, key, iv);

    let ciphertext = cipher.update(content, "utf8", "base64");
    ciphertext += cipher.final("base64");

    const tag = cipher.getAuthTag();

    return {
      ciphertext,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      recipientId,
      senderId,
      algorithm: this.algorithm,
    };
  }

  /**
   * Decrypt template
   */
  decrypt(encrypted: EncryptedTemplate, recipientId: string, sharedSecret: string): string {
    if (encrypted.recipientId !== recipientId) {
      throw new Error("Not intended recipient");
    }

    const key = this.deriveKey(encrypted.senderId, recipientId, sharedSecret);
    const iv = Buffer.from(encrypted.iv, "base64");
    const tag = Buffer.from(encrypted.tag, "base64");

    const decipher = createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(tag);

    let plaintext = decipher.update(encrypted.ciphertext, "base64", "utf8");
    plaintext += decipher.final("utf8");

    return plaintext;
  }
}
