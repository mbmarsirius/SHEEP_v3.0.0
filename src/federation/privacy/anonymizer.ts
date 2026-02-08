/**
 * Template Anonymizer
 *
 * Removes/replaces PII and sensitive data before federation sharing.
 */

import { createHash } from "crypto";
import { PIIDetector, PIIMatch, PIIType } from "./pii-detector.js";

export interface AnonymizedTemplate {
  originalHash: string; // SHA-256 of original (for dedup)
  anonymizedContent: string;
  anonymizedAt: Date;
  piiRemoved: number;
  redactions: Redaction[];
}

export interface Redaction {
  type: PIIType | "name" | "location" | "date";
  placeholder: string;
  originalLength: number;
}

export class TemplateAnonymizer {
  private readonly piiDetector: PIIDetector;
  private nameCounter = 0;
  private locationCounter = 0;

  constructor() {
    this.piiDetector = new PIIDetector();
  }

  /**
   * Anonymize a template
   */
  anonymize(content: string): AnonymizedTemplate {
    const originalHash = createHash("sha256").update(content).digest("hex");
    let anonymized = content;
    const redactions: Redaction[] = [];

    // 1. Remove PII detected by patterns
    const piiMatches = this.piiDetector.detect(content);

    // Sort by position (descending) to replace from end to start
    piiMatches.sort((a, b) => b.start - a.start);

    for (const match of piiMatches) {
      const placeholder = this.getPlaceholder(match.type);
      anonymized = anonymized.slice(0, match.start) + placeholder + anonymized.slice(match.end);

      redactions.push({
        type: match.type,
        placeholder,
        originalLength: match.value.length,
      });
    }

    // 2. Replace common names with generic placeholders
    anonymized = this.replaceNames(anonymized, redactions);

    // 3. Replace specific locations with generic
    anonymized = this.replaceLocations(anonymized, redactions);

    // 4. Replace specific dates with relative
    anonymized = this.replaceDates(anonymized, redactions);

    return {
      originalHash,
      anonymizedContent: anonymized,
      anonymizedAt: new Date(),
      piiRemoved: piiMatches.length,
      redactions,
    };
  }

  /**
   * Verify template is safe to share
   */
  verifySafe(template: AnonymizedTemplate): { safe: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check for remaining PII
    const remainingPII = this.piiDetector.detect(template.anonymizedContent);
    if (remainingPII.length > 0) {
      issues.push(`Found ${remainingPII.length} PII items after anonymization`);
    }

    // Check for suspicious patterns
    if (template.anonymizedContent.includes("password")) {
      issues.push("Contains 'password' keyword");
    }

    if (template.anonymizedContent.includes("secret")) {
      issues.push("Contains 'secret' keyword");
    }

    return {
      safe: issues.length === 0,
      issues,
    };
  }

  private getPlaceholder(type: PIIType): string {
    switch (type) {
      case "email":
        return "[EMAIL]";
      case "phone":
        return "[PHONE]";
      case "ssn":
        return "[SSN]";
      case "credit_card":
        return "[CARD]";
      case "ip_address":
        return "[IP]";
      case "api_key":
        return "[API_KEY]";
      case "password":
        return "[REDACTED]";
      case "url_with_auth":
        return "[URL]";
      default:
        return "[REDACTED]";
    }
  }

  private replaceNames(text: string, redactions: Redaction[]): string {
    // Common first names (simplified list)
    const names = /\b(John|Jane|Mike|Sarah|David|Lisa|James|Mary|Robert|Jennifer)\b/gi;

    return text.replace(names, (match) => {
      const placeholder = `[PERSON_${++this.nameCounter}]`;
      redactions.push({ type: "name", placeholder, originalLength: match.length });
      return placeholder;
    });
  }

  private replaceLocations(text: string, redactions: Redaction[]): string {
    // Common cities (simplified)
    const locations =
      /\b(New York|Los Angeles|Chicago|San Francisco|Seattle|Boston|Miami|Austin|Denver|Portland)\b/gi;

    return text.replace(locations, (match) => {
      const placeholder = `[LOCATION_${++this.locationCounter}]`;
      redactions.push({ type: "location", placeholder, originalLength: match.length });
      return placeholder;
    });
  }

  private replaceDates(text: string, redactions: Redaction[]): string {
    // Specific dates -> relative
    const datePattern =
      /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?,?\s*\d{4}\b/gi;

    return text.replace(datePattern, (match) => {
      redactions.push({ type: "date", placeholder: "[DATE]", originalLength: match.length });
      return "[DATE]";
    });
  }
}
