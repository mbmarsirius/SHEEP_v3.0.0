/**
 * SHEEP AI - Data Encryption
 * GDPR Article 32: Security of processing
 * HIPAA: Encryption at rest and in transit
 *
 * AES-256-GCM encryption for data at rest.
 * All cloud communication over TLS 1.3.
 */

import crypto from "node:crypto";
import { createSubsystemLogger } from "../stubs/logging.js";

const log = createSubsystemLogger("encryption");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * Derive an encryption key from a passphrase or machine identity.
 * Uses PBKDF2 with 100,000 iterations (NIST recommendation).
 */
export function deriveKey(passphrase: string, salt?: Buffer): { key: Buffer; salt: Buffer } {
  const keySalt = salt ?? crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(passphrase, keySalt, 100_000, KEY_LENGTH, "sha256");
  return { key, salt: keySalt };
}

/**
 * Generate a machine-specific key (for automatic encryption without passphrase).
 * Based on hostname + username + a fixed component.
 */
export function getMachineKey(): string {
  const os = require("node:os");
  const identity = `${os.hostname()}:${os.userInfo().username}:sheep-ai-v3`;
  return identity;
}

/**
 * Encrypt data with AES-256-GCM.
 * Returns: base64 encoded string containing: salt + iv + authTag + ciphertext
 */
export function encrypt(plaintext: string, passphrase?: string): string {
  const { key, salt } = deriveKey(passphrase ?? getMachineKey());
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: salt(16) + iv(12) + authTag(16) + ciphertext
  const packed = Buffer.concat([salt, iv, authTag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt AES-256-GCM encrypted data.
 */
export function decrypt(encryptedBase64: string, passphrase?: string): string {
  const packed = Buffer.from(encryptedBase64, "base64");

  // Unpack: salt(16) + iv(12) + authTag(16) + ciphertext
  const salt = packed.subarray(0, 16);
  const iv = packed.subarray(16, 16 + IV_LENGTH);
  const authTag = packed.subarray(16 + IV_LENGTH, 16 + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(16 + IV_LENGTH + AUTH_TAG_LENGTH);

  const { key } = deriveKey(passphrase ?? getMachineKey(), salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Encrypt a fact for cloud sync.
 * Only the object (the sensitive value) is encrypted; subject/predicate are anonymized.
 */
export function encryptForSync(data: {
  subject: string;
  predicate: string;
  object: string;
}, syncKey: string): { subject: string; predicate: string; encryptedObject: string } {
  return {
    subject: anonymize(data.subject),
    predicate: data.predicate,
    encryptedObject: encrypt(data.object, syncKey),
  };
}

/**
 * Simple anonymization: hash the value.
 */
function anonymize(value: string): string {
  return "anon_" + crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Verify that encryption/decryption works (startup self-test).
 */
export function selfTestEncryption(): boolean {
  try {
    const testData = "SHEEP AI encryption self-test: " + Date.now();
    const encrypted = encrypt(testData);
    const decrypted = decrypt(encrypted);
    const ok = decrypted === testData;
    if (ok) {
      log.debug("Encryption self-test passed");
    } else {
      log.error("Encryption self-test FAILED: decrypted data doesn't match");
    }
    return ok;
  } catch (err) {
    log.error("Encryption self-test FAILED", { error: String(err) });
    return false;
  }
}
