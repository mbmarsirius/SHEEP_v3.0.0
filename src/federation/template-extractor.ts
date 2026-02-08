/**
 * SHEEP AI - Pattern Distillation: Template Extractor
 *
 * Phase 1: Federation Layer
 *
 * Extracts anonymized causal templates from local causal graph.
 * Templates are generalized patterns that can be shared without revealing
 * individual user data.
 *
 * Example template:
 *   [concern_type] → [separation_strategy] → [outcome]
 *
 * This allows sharing wisdom ("users with X concern often find Y helpful")
 * without sharing personal information.
 *
 * @module sheep/federation/template-extractor
 */

import type { CausalLink } from "../memory/schema.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * A causal template - anonymized pattern that can be shared
 */
export type CausalTemplate = {
  /** Unique template ID */
  id: string;
  /** Template structure with placeholders */
  template: string;
  /** Example: "concern_type → separation_strategy → outcome" */
  example: string;
  /** Confidence based on local evidence */
  confidence: number;
  /** Number of local causal links supporting this template */
  localEvidenceCount: number;
  /** Categories this template applies to */
  categories: string[];
  /** When this template was extracted */
  extractedAt: string;
};

/**
 * Options for template extraction
 */
export type TemplateExtractionOptions = {
  /** Minimum confidence threshold (default: 0.6) */
  minConfidence?: number;
  /** Minimum evidence count (default: 2) */
  minEvidenceCount?: number;
  /** Categories to include (default: all) */
  includeCategories?: string[];
  /** Whether to anonymize PII (default: true) */
  anonymizePII?: boolean;
};

// =============================================================================
// TEMPLATE EXTRACTION
// =============================================================================

/**
 * Extract causal templates from local causal links
 */
export function extractCausalTemplates(
  causalLinks: CausalLink[],
  options: TemplateExtractionOptions = {},
): CausalTemplate[] {
  const {
    minConfidence = 0.6,
    minEvidenceCount = 2,
    includeCategories,
    anonymizePII = true,
  } = options;

  log.info("Extracting causal templates", {
    causalLinksCount: causalLinks.length,
    minConfidence,
    minEvidenceCount,
  });

  // Group causal links by pattern
  const patternGroups = new Map<string, CausalLink[]>();

  for (const link of causalLinks) {
    // Create pattern signature from structure
    const pattern = createPatternSignature(link, anonymizePII);

    if (!patternGroups.has(pattern)) {
      patternGroups.set(pattern, []);
    }
    patternGroups.get(pattern)!.push(link);
  }

  // Convert groups to templates
  const templates: CausalTemplate[] = [];

  for (const [pattern, links] of patternGroups) {
    // Filter by evidence count
    if (links.length < minEvidenceCount) {
      continue;
    }

    // Calculate average confidence
    const avgConfidence = links.reduce((sum, l) => sum + l.confidence, 0) / links.length;

    // Filter by confidence
    if (avgConfidence < minConfidence) {
      continue;
    }

    // Extract template structure
    const template = extractTemplateStructure(links[0], anonymizePII);
    const example = createExampleTemplate(links[0], anonymizePII);

    // Determine categories
    const categories = extractCategories(links);

    templates.push({
      id: `template-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      template,
      example,
      confidence: avgConfidence,
      localEvidenceCount: links.length,
      categories,
      extractedAt: new Date().toISOString(),
    });
  }

  log.info("Extracted causal templates", {
    templatesCount: templates.length,
  });

  return templates;
}

/**
 * Create pattern signature from causal link
 */
function createPatternSignature(link: CausalLink, anonymizePII: boolean): string {
  // Normalize cause and effect types
  const causeType = normalizeType(link.causeDescription, anonymizePII);
  const effectType = normalizeType(link.effectDescription, anonymizePII);
  const mechanismType = normalizeMechanism(link.mechanism, anonymizePII);

  return `${causeType}→${effectType}→${mechanismType}`;
}

/**
 * Extract template structure from causal link
 */
function extractTemplateStructure(link: CausalLink, anonymizePII: boolean): string {
  const causePlaceholder = extractPlaceholder(link.causeDescription, anonymizePII);
  const effectPlaceholder = extractPlaceholder(link.effectDescription, anonymizePII);
  const mechanismPlaceholder = extractPlaceholder(link.mechanism, anonymizePII);

  return `${causePlaceholder} → ${effectPlaceholder} → ${mechanismPlaceholder}`;
}

/**
 * Create example template string
 */
function createExampleTemplate(link: CausalLink, anonymizePII: boolean): string {
  const cause = anonymizePII ? anonymizeText(link.causeDescription) : link.causeDescription;
  const effect = anonymizePII ? anonymizeText(link.effectDescription) : link.effectDescription;
  const mechanism = anonymizePII ? anonymizeText(link.mechanism) : link.mechanism;

  return `${cause} → ${effect} → ${mechanism}`;
}

/**
 * Normalize text to type category
 */
function normalizeType(text: string, anonymizePII: boolean): string {
  const normalized = anonymizePII ? anonymizeText(text) : text;
  return normalized.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/**
 * Normalize mechanism to category
 */
function normalizeMechanism(text: string, anonymizePII: boolean): string {
  const normalized = anonymizePII ? anonymizeText(text) : text;
  return normalized.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/**
 * Extract placeholder from text
 */
function extractPlaceholder(text: string, anonymizePII: boolean): string {
  const normalized = anonymizePII ? anonymizeText(text) : text;

  // Detect common patterns
  if (
    normalized.includes("concern") ||
    normalized.includes("issue") ||
    normalized.includes("problem")
  ) {
    return "[concern_type]";
  }
  if (
    normalized.includes("switch") ||
    normalized.includes("change") ||
    normalized.includes("adopt")
  ) {
    return "[action_taken]";
  }
  if (
    normalized.includes("strategy") ||
    normalized.includes("approach") ||
    normalized.includes("method")
  ) {
    return "[strategy_type]";
  }
  if (
    normalized.includes("outcome") ||
    normalized.includes("result") ||
    normalized.includes("improvement")
  ) {
    return "[outcome_type]";
  }

  // Generic placeholder
  return "[entity_type]";
}

/**
 * Anonymize text by removing PII
 */
function anonymizeText(text: string): string {
  let anonymized = text;

  // Remove email addresses
  anonymized = anonymized.replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, "[email]");

  // Remove phone numbers
  anonymized = anonymized.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "[phone]");

  // Remove URLs
  anonymized = anonymized.replace(/https?:\/\/[^\s]+/g, "[url]");

  // Remove potential names (capitalized words that might be names)
  // This is heuristic - may need refinement
  const words = anonymized.split(/\s+/);
  const anonymizedWords = words.map((word) => {
    // Skip if it's a common word or already anonymized
    if (word.match(/^\[.*\]$/) || word.length < 3) {
      return word;
    }
    // If it looks like a name (capitalized, not at start of sentence)
    if (word[0] === word[0].toUpperCase() && word.length > 2) {
      // Check if it's a common word
      const commonWords = [
        "the",
        "and",
        "for",
        "are",
        "but",
        "not",
        "you",
        "all",
        "can",
        "her",
        "was",
        "one",
        "our",
        "out",
        "day",
        "get",
        "has",
        "him",
        "his",
        "how",
        "its",
        "may",
        "new",
        "now",
        "old",
        "see",
        "two",
        "way",
        "who",
        "boy",
        "did",
        "man",
        "try",
        "use",
        "she",
        "her",
        "many",
        "some",
        "time",
        "very",
        "when",
        "come",
        "here",
        "just",
        "like",
        "long",
        "make",
        "over",
        "such",
        "take",
        "than",
        "them",
        "well",
        "were",
      ];
      if (!commonWords.includes(word.toLowerCase())) {
        return "[name]";
      }
    }
    return word;
  });

  return anonymizedWords.join(" ");
}

/**
 * Extract categories from causal links
 */
function extractCategories(links: CausalLink[]): string[] {
  const categories = new Set<string>();

  for (const link of links) {
    // Extract categories from mechanism and descriptions
    const text =
      `${link.causeDescription} ${link.effectDescription} ${link.mechanism}`.toLowerCase();

    if (text.includes("security") || text.includes("privacy") || text.includes("safe")) {
      categories.add("security");
    }
    if (text.includes("performance") || text.includes("speed") || text.includes("fast")) {
      categories.add("performance");
    }
    if (text.includes("cost") || text.includes("price") || text.includes("expensive")) {
      categories.add("cost");
    }
    if (text.includes("quality") || text.includes("better") || text.includes("improve")) {
      categories.add("quality");
    }
    if (text.includes("preference") || text.includes("like") || text.includes("prefer")) {
      categories.add("preference");
    }
  }

  return Array.from(categories);
}

// =============================================================================
// EXPORTS
// =============================================================================

// Types already exported at definition above
