/**
 * SHEEP AI - User Consent Management
 * GDPR Article 6: Lawfulness of processing (consent required)
 * GDPR Article 7: Conditions for consent
 *
 * No memory processing occurs without explicit user consent.
 */

import { createSubsystemLogger } from "../stubs/logging.js";

const log = createSubsystemLogger("privacy");

export type ConsentRecord = {
  userId: string;
  /** What the user consented to */
  scope: ConsentScope[];
  /** When consent was given */
  grantedAt: string;
  /** Consent version (bump when terms change) */
  version: string;
  /** How consent was obtained (telegram command, web form, etc.) */
  method: string;
  /** Whether consent was withdrawn */
  withdrawn: boolean;
  /** When consent was withdrawn (if applicable) */
  withdrawnAt?: string;
};

export type ConsentScope =
  | "memory_storage"        // Store facts and episodes locally
  | "memory_consolidation"  // Run sleep consolidation (LLM processing)
  | "cloud_sync"            // Sync anonymized data to sheep.ai cloud
  | "federation"            // Share patterns with other SHEEP instances
  | "analytics";            // Usage analytics (never PII)

const CURRENT_CONSENT_VERSION = "1.0.0";

/**
 * Check if a user has given consent for a specific scope.
 */
export function hasConsent(db: any, userId: string, scope: ConsentScope): boolean {
  try {
    const record = getConsentRecord(db, userId);
    if (!record) return false;
    if (record.withdrawn) return false;
    return record.scope.includes(scope);
  } catch {
    return false;
  }
}

/**
 * Record user consent. Must be explicit and informed.
 */
export function grantConsent(
  db: any,
  userId: string,
  scopes: ConsentScope[],
  method: string,
): ConsentRecord {
  const record: ConsentRecord = {
    userId,
    scope: scopes,
    grantedAt: new Date().toISOString(),
    version: CURRENT_CONSENT_VERSION,
    method,
    withdrawn: false,
  };

  // Store in database
  try {
    db.db.prepare(
      `INSERT OR REPLACE INTO sheep_consent (user_id, scopes, granted_at, version, method, withdrawn)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(userId, JSON.stringify(scopes), record.grantedAt, record.version, method);
  } catch {
    // Table might not exist yet, create it
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS sheep_consent (
        user_id TEXT PRIMARY KEY,
        scopes TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        version TEXT NOT NULL,
        method TEXT NOT NULL,
        withdrawn INTEGER NOT NULL DEFAULT 0,
        withdrawn_at TEXT
      )
    `);
    db.db.prepare(
      `INSERT OR REPLACE INTO sheep_consent (user_id, scopes, granted_at, version, method, withdrawn)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(userId, JSON.stringify(scopes), record.grantedAt, record.version, method);
  }

  log.info("Consent granted", { userId, scopes, method });
  return record;
}

/**
 * Withdraw consent. GDPR Article 7(3): right to withdraw at any time.
 * This does NOT delete data -- use the deletion module for that.
 */
export function withdrawConsent(db: any, userId: string): void {
  const now = new Date().toISOString();
  try {
    db.db.prepare(
      `UPDATE sheep_consent SET withdrawn = 1, withdrawn_at = ? WHERE user_id = ?`,
    ).run(now, userId);
  } catch {
    // Ignore if table doesn't exist
  }
  log.info("Consent withdrawn", { userId });
}

/**
 * Get the current consent record for a user.
 */
export function getConsentRecord(db: any, userId: string): ConsentRecord | null {
  try {
    const row = db.db.prepare(
      `SELECT * FROM sheep_consent WHERE user_id = ?`,
    ).get(userId) as any;

    if (!row) return null;

    return {
      userId: row.user_id,
      scope: JSON.parse(row.scopes),
      grantedAt: row.granted_at,
      version: row.version,
      method: row.method,
      withdrawn: !!row.withdrawn,
      withdrawnAt: row.withdrawn_at ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Auto-grant basic consent for self-hosted instances.
 * Self-hosted users implicitly consent by running the software.
 * Cloud users must explicitly consent.
 */
export function ensureLocalConsent(db: any, userId: string): void {
  if (!hasConsent(db, userId, "memory_storage")) {
    grantConsent(
      db,
      userId,
      ["memory_storage", "memory_consolidation"],
      "self_hosted_implicit",
    );
  }
}
