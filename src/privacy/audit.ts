/**
 * SHEEP AI - Audit Logging
 * GDPR Article 5(2): Accountability principle
 * HIPAA: Access logging requirement
 *
 * Tamper-evident audit trail for all data operations.
 * Uses hash chaining for integrity verification.
 */

import crypto from "node:crypto";
import { createSubsystemLogger } from "../stubs/logging.js";

const log = createSubsystemLogger("audit");

export type AuditEntry = {
  id?: number;
  action: AuditAction;
  userId: string;
  details: string;
  timestamp: string;
  /** SHA-256 hash of previous entry + this entry (tamper-evident chain) */
  chainHash: string;
};

export type AuditAction =
  | "data_access"         // Reading user data
  | "data_modify"         // Modifying user data
  | "data_delete"         // Deleting user data
  | "data_export"         // Exporting user data
  | "consent_grant"       // User granted consent
  | "consent_withdraw"    // User withdrew consent
  | "cloud_sync_start"    // Started syncing to cloud
  | "cloud_sync_complete" // Completed cloud sync
  | "consolidation_run"   // Sleep consolidation executed
  | "fact_extraction"     // Facts extracted from conversation
  | "pii_detected"        // PII detected and handled
  | "license_check";      // License validation performed

let lastHash = "GENESIS";

/**
 * Initialize the audit log table.
 */
export function initAuditLog(db: any): void {
  try {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS sheep_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        user_id TEXT NOT NULL,
        details TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        chain_hash TEXT NOT NULL
      )
    `);

    // Recover last hash for chain continuity
    const lastRow = db.db.prepare(
      "SELECT chain_hash FROM sheep_audit_log ORDER BY id DESC LIMIT 1",
    ).get() as { chain_hash: string } | undefined;

    if (lastRow) {
      lastHash = lastRow.chain_hash;
    }
  } catch {
    // Audit should never prevent startup
  }
}

/**
 * Log an auditable event. Thread-safe hash chaining.
 */
export function auditLog(db: any, action: AuditAction, userId: string, details: string): void {
  const timestamp = new Date().toISOString();

  // Create tamper-evident hash chain
  const entryData = `${lastHash}|${action}|${userId}|${details}|${timestamp}`;
  const chainHash = crypto.createHash("sha256").update(entryData).digest("hex");

  try {
    db.db.prepare(
      `INSERT INTO sheep_audit_log (action, user_id, details, timestamp, chain_hash)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(action, userId, details, timestamp, chainHash);

    lastHash = chainHash;
  } catch {
    // Audit logging must never crash the main application
    log.warn("Failed to write audit entry", { action, userId });
  }
}

/**
 * Verify the integrity of the audit log (detect tampering).
 */
export function verifyAuditChain(db: any): { valid: boolean; entries: number; brokenAt?: number } {
  try {
    const rows = db.db.prepare(
      "SELECT * FROM sheep_audit_log ORDER BY id ASC",
    ).all() as any[];

    let prevHash = "GENESIS";
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const entryData = `${prevHash}|${row.action}|${row.user_id}|${row.details}|${row.timestamp}`;
      const expectedHash = crypto.createHash("sha256").update(entryData).digest("hex");

      if (expectedHash !== row.chain_hash) {
        return { valid: false, entries: rows.length, brokenAt: i };
      }
      prevHash = row.chain_hash;
    }

    return { valid: true, entries: rows.length };
  } catch {
    return { valid: false, entries: 0 };
  }
}

/**
 * Get recent audit entries (for admin/debugging).
 */
export function getRecentAuditEntries(db: any, limit: number = 50): AuditEntry[] {
  try {
    const rows = db.db.prepare(
      "SELECT * FROM sheep_audit_log ORDER BY id DESC LIMIT ?",
    ).all(limit) as any[];

    return rows.map((r: any) => ({
      id: r.id,
      action: r.action,
      userId: r.user_id,
      details: r.details,
      timestamp: r.timestamp,
      chainHash: r.chain_hash,
    }));
  } catch {
    return [];
  }
}
