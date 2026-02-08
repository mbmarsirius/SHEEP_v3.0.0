/**
 * Message Signing (Ed25519)
 */

import { sign, verify, generateKeyPair } from "crypto";
import { promisify } from "util";

const generateKeyPairAsync = promisify(generateKeyPair);

export interface KeyPair {
  publicKey: string; // Base64
  privateKey: string; // Base64
}

export class MessageSigning {
  private privateKey?: Buffer;
  private publicKey?: Buffer;

  /**
   * Generate new key pair
   */
  async generateKeyPair(): Promise<KeyPair> {
    const { publicKey, privateKey } = await generateKeyPairAsync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });

    this.publicKey = publicKey;
    this.privateKey = privateKey;

    return {
      publicKey: publicKey.toString("base64"),
      privateKey: privateKey.toString("base64"),
    };
  }

  /**
   * Load existing key pair
   */
  loadKeyPair(keyPair: KeyPair): void {
    this.publicKey = Buffer.from(keyPair.publicKey, "base64");
    this.privateKey = Buffer.from(keyPair.privateKey, "base64");
  }

  /**
   * Sign a message
   */
  sign(data: string): string {
    if (!this.privateKey) {
      throw new Error("No private key loaded");
    }

    const signature = sign(null, Buffer.from(data), {
      key: this.privateKey,
      format: "der",
      type: "pkcs8",
    });

    return signature.toString("base64");
  }

  /**
   * Verify a signature
   */
  verify(data: string, signature: string, publicKey: string): boolean {
    const pubKeyBuffer = Buffer.from(publicKey, "base64");
    const sigBuffer = Buffer.from(signature, "base64");

    return verify(
      null,
      Buffer.from(data),
      {
        key: pubKeyBuffer,
        format: "der",
        type: "spki",
      },
      sigBuffer,
    );
  }

  /**
   * Get public key
   */
  getPublicKey(): string {
    if (!this.publicKey) {
      throw new Error("No key pair generated");
    }
    return this.publicKey.toString("base64");
  }
}
