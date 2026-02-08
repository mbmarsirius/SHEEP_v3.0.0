/**
 * PII (Personally Identifiable Information) Detection
 *
 * Detects and flags PII in templates before sharing.
 * CRITICAL: No PII should ever be shared via federation.
 */

export interface PIIMatch {
  type: PIIType;
  value: string;
  start: number;
  end: number;
  confidence: number;
}

export type PIIType =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "ip_address"
  | "address"
  | "name"
  | "date_of_birth"
  | "api_key"
  | "password"
  | "url_with_auth";

export class PIIDetector {
  private readonly patterns: Map<PIIType, RegExp[]> = new Map([
    ["email", [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi]],
    [
      "phone",
      [
        /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
        /\b\+\d{1,3}[-.\s]?\d{3,14}\b/g,
        /\b\(\d{3}\)\s*\d{3}[-.\s]?\d{4}\b/g,
      ],
    ],
    ["ssn", [/\b\d{3}[-]?\d{2}[-]?\d{4}\b/g]],
    [
      "credit_card",
      [
        /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
      ],
    ],
    [
      "ip_address",
      [
        /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
      ],
    ],
    [
      "api_key",
      [
        /\b(?:sk[-_])?[A-Za-z0-9]{20,}\b/g, // Generic API keys
        /\bghp_[A-Za-z0-9]{36}\b/g, // GitHub tokens
        /\bsk-[A-Za-z0-9]{48}\b/g, // OpenAI keys
        /\bAIza[A-Za-z0-9_-]{35}\b/g, // Google API keys
      ],
    ],
    ["password", [/(?:password|passwd|pwd)[\s:=]+["']?([^"'\s]+)["']?/gi]],
    ["url_with_auth", [/https?:\/\/[^:]+:[^@]+@[^\s]+/gi]],
  ]);

  /**
   * Detect all PII in text
   */
  detect(text: string): PIIMatch[] {
    const matches: PIIMatch[] = [];

    for (const [type, patterns] of this.patterns) {
      for (const pattern of patterns) {
        // Reset regex state
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(text)) !== null) {
          matches.push({
            type,
            value: match[0],
            start: match.index,
            end: match.index + match[0].length,
            confidence: this.getConfidence(type, match[0]),
          });
        }
      }
    }

    return matches;
  }

  /**
   * Check if text contains any PII
   */
  containsPII(text: string): boolean {
    return this.detect(text).length > 0;
  }

  /**
   * Get confidence score for a match
   */
  private getConfidence(type: PIIType, value: string): number {
    switch (type) {
      case "email":
        return value.includes("@") ? 0.95 : 0.5;
      case "phone":
        return value.replace(/\D/g, "").length >= 10 ? 0.9 : 0.6;
      case "ssn":
        return 0.85;
      case "credit_card":
        return this.luhnCheck(value) ? 0.95 : 0.5;
      case "api_key":
        return value.length > 30 ? 0.8 : 0.5;
      default:
        return 0.7;
    }
  }

  /**
   * Luhn algorithm for credit card validation
   */
  private luhnCheck(value: string): boolean {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 13) return false;

    let sum = 0;
    let isEven = false;

    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits[i], 10);

      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }
}
