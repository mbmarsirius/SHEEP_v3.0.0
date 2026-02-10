/**
 * SHEEP AI - Privacy & Compliance Module
 *
 * GDPR + HIPAA compliant data handling.
 * All privacy modules are OPEN SOURCE (builds trust).
 */

export {
  hasConsent,
  grantConsent,
  withdrawConsent,
  getConsentRecord,
  ensureLocalConsent,
  type ConsentRecord,
  type ConsentScope,
} from "./consent.js";

export {
  deleteAllUserData,
  deleteByTopic,
  deleteBeforeDate,
  type DeletionResult,
} from "./deletion.js";

export {
  exportAllData,
  type ExportFormat,
  type ExportResult,
} from "./export.js";

export {
  initAuditLog,
  auditLog,
  verifyAuditChain,
  getRecentAuditEntries,
  type AuditEntry,
  type AuditAction,
} from "./audit.js";

export {
  scanForPII,
  cleanFactForSync,
  shouldKeepLocal,
  type PIIDetection,
  type PIIScanResult,
  type PIIType,
} from "./pii-filter.js";

export {
  encrypt,
  decrypt,
  deriveKey,
  encryptForSync,
  selfTestEncryption,
} from "./encryption.js";
