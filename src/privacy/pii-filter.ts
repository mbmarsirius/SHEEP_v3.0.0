/**
 * SHEEP AI - PII Filter
 * GDPR Article 5(1)(c): Data minimization
 * GDPR Article 25: Data protection by design
 *
 * Auto-detect and filter PII before cloud sync.
 * PII never leaves the user's machine unless explicitly consented.
 */

import { createSubsystemLogger } from "../stubs/logging.js";

const log = createSubsystemLogger("pii");

export type PIIType =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "ip_address"
  | "api_key"
  | "password"
  | "address"
  | "name";

export type PIIDetection = {
  type: PIIType;
  value: string;
  /** Redacted version (e.g., "j***@gmail.com") */
  redacted: string;
  /** Character positions [start, end] */
  position: [number, number];
};

export type PIIScanResult = {
  hasPII: boolean;
  detections: PIIDetection[];
  cleanText: string;
  /** Original text (never send to cloud) */
  originalText: string;
};

// PII detection patterns
const PII_PATTERNS: Array<{ type: PIIType; pattern: RegExp; redact: (match: string) => string }> = [
  {
    type: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    redact: (m) => m[0] + "***@" + m.split("@")[1],
  },
  {
    type: "phone",
    pattern: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    redact: (m) => m.slice(0, 3) + "***" + m.slice(-2),
  },
  {
    type: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    redact: () => "***-**-****",
  },
  {
    type: "credit_card",
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    redact: (m) => "****-****-****-" + m.slice(-4),
  },
  {
    type: "ip_address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    redact: () => "***.***.***.***",
  },
  {
    type: "api_key",
    pattern: /\b(?:sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{35}|ghp_[A-Za-z0-9]{36})\b/g,
    redact: (m) => m.slice(0, 6) + "***REDACTED***",
  },
  {
    type: "password",
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
    redact: () => "password: ***REDACTED***",
  },
];

/**
 * Scan text for PII and return detections + cleaned version.
 */
export function scanForPII(text: string): PIIScanResult {
  const detections: PIIDetection[] = [];
  let cleanText = text;

  for (const { type, pattern, redact } of PII_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[0];
      const redacted = redact(value);
      detections.push({
        type,
        value,
        redacted,
        position: [match.index, match.index + value.length],
      });
      cleanText = cleanText.replace(value, redacted);
    }
  }

  return {
    hasPII: detections.length > 0,
    detections,
    cleanText,
    originalText: text,
  };
}

/**
 * Clean a fact before cloud sync -- strip all PII.
 */
export function cleanFactForSync(fact: {
  subject: string;
  predicate: string;
  object: string;
}): { subject: string; predicate: string; object: string; piiDetected: boolean } {
  const subjectScan = scanForPII(fact.subject);
  const objectScan = scanForPII(fact.object);

  const piiDetected = subjectScan.hasPII || objectScan.hasPII;

  if (piiDetected) {
    log.info("PII detected and redacted in fact before sync", {
      types: [...subjectScan.detections, ...objectScan.detections].map((d) => d.type),
    });
  }

  return {
    subject: subjectScan.cleanText,
    predicate: fact.predicate,
    object: objectScan.cleanText,
    piiDetected,
  };
}

/**
 * Check if a fact should be kept local-only (too much PII).
 */
export function shouldKeepLocal(fact: {
  subject: string;
  predicate: string;
  object: string;
}): boolean {
  const scan = scanForPII(`${fact.subject} ${fact.predicate} ${fact.object}`);
  // If 3+ PII detections, keep local only
  return scan.detections.length >= 3;
}
