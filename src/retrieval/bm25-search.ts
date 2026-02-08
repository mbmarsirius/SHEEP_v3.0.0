/**
 * SHEEP AI - BM25 Keyword Search using SQLite FTS5
 *
 * Implements BM25 (Best Matching 25) ranking for keyword-based fact retrieval.
 * Uses SQLite's FTS5 extension for fast full-text search with BM25 scoring.
 *
 * @module sheep/retrieval/bm25-search
 */

import type { SheepDatabase } from "../memory/database.js";
import type { Fact } from "../memory/schema.js";
import { createSubsystemLogger } from "../stubs/logging.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Search result with BM25 score
 */
export type BM25SearchResult = {
  fact: Fact;
  score: number; // BM25 score (0-1, higher is better)
  rank: number; // BM25 rank (lower is better, from FTS5)
};

/**
 * Options for BM25 search
 */
export type BM25SearchOptions = {
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum score threshold (0-1, default: 0.1) */
  minScore?: number;
  /** Only return active facts (default: true) */
  activeOnly?: boolean;
};

// =============================================================================
// FTS5 QUERY BUILDING
// =============================================================================

/**
 * Build FTS5 query from raw search string
 *
 * Converts user input into FTS5 query syntax:
 * - Multiple words become AND queries: "hello world" -> "hello" AND "world"
 * - Supports phrase matching with quotes
 *
 * @param raw - Raw search query string
 * @returns FTS5 query string or null if invalid
 */
export function buildFtsQuery(raw: string): string | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  // Handle quoted phrases
  const phraseMatches = raw.match(/"([^"]+)"/g);
  const phrases: string[] = [];
  let remaining = raw;

  if (phraseMatches) {
    for (const match of phraseMatches) {
      const phrase = match.slice(1, -1); // Remove quotes
      phrases.push(`"${phrase.replace(/"/g, '""')}"`); // Escape quotes for FTS5
      remaining = remaining.replace(match, "").trim();
    }
  }

  // Extract individual tokens from remaining text
  const tokens =
    remaining
      .match(/[A-Za-z0-9_]+/g)
      ?.map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 1) ?? [];

  if (phrases.length === 0 && tokens.length === 0) {
    return null;
  }

  // Combine phrases and tokens with AND
  const allTerms = [...phrases, ...tokens.map((t) => `"${t}"`)];
  return allTerms.join(" AND ");
}

/**
 * Convert BM25 rank to normalized score (0-1)
 *
 * FTS5's bm25() function returns a rank where lower values are better.
 * This function converts it to a score where higher values are better.
 *
 * @param rank - BM25 rank from FTS5 (lower is better)
 * @returns Normalized score (0-1, higher is better)
 */
export function bm25RankToScore(rank: number): number {
  // BM25 rank is typically negative, with values closer to 0 being better
  // Convert to a score: 1 / (1 + |rank|)
  const normalized = Number.isFinite(rank) ? Math.max(0, Math.abs(rank)) : 999;
  return 1 / (1 + normalized);
}

// =============================================================================
// KEYWORD EXTRACTION
// =============================================================================

/**
 * Common English stopwords to filter out
 */
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "can",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "and",
  "but",
  "if",
  "or",
  "because",
  "until",
  "while",
  "this",
  "that",
  "these",
  "those",
  "what",
  "which",
  "who",
  "whom",
  "i",
  "me",
  "my",
  "myself",
  "we",
  "our",
  "ours",
  "you",
  "your",
  "yours",
  "he",
  "him",
  "his",
  "she",
  "her",
  "hers",
  "it",
  "its",
  "they",
  "them",
  "their",
  "theirs",
]);

/**
 * Extract keywords from text for indexing
 *
 * Removes stopwords, normalizes case, and filters short tokens.
 * Used to populate the keywords column in sheep_facts for better search.
 *
 * @param text - Input text to extract keywords from
 * @returns Array of keyword strings
 */
export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // Replace punctuation with spaces
    .split(/\s+/) // Split on whitespace
    .filter((word) => word.length > 2 && !STOPWORDS.has(word)) // Filter short words and stopwords
    .filter((word, index, arr) => arr.indexOf(word) === index); // Remove duplicates
}

/**
 * Extract keywords as a space-separated string (for storage)
 */
export function extractKeywordsString(text: string): string {
  return extractKeywords(text).join(" ");
}

// =============================================================================
// BM25 SEARCH
// =============================================================================

/**
 * Perform BM25 keyword search on facts using FTS5
 *
 * Uses SQLite's FTS5 extension with built-in BM25 ranking algorithm.
 * BM25 is a probabilistic ranking function that considers:
 * - Term frequency (TF): How often terms appear in a document
 * - Inverse document frequency (IDF): How rare terms are across all documents
 * - Document length normalization: Prevents longer documents from dominating
 *
 * @param db - SheepDatabase instance
 * @param query - Search query string
 * @param options - Search options
 * @returns Array of search results with facts and scores
 */
export function bm25Search(
  db: SheepDatabase,
  query: string,
  options: BM25SearchOptions = {},
): BM25SearchResult[] {
  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? 0.1;
  const activeOnly = options.activeOnly !== false;

  if (limit <= 0) {
    return [];
  }

  // Build FTS5 query
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) {
    log.warn("Invalid search query", { query });
    return [];
  }

  try {
    // Query FTS5 table with BM25 ranking
    // Join with sheep_facts using rowid (FTS5 uses SQLite rowid for content_rowid)
    const sql = `
      SELECT 
        f.*,
        bm25(sheep_facts_fts) AS rank
      FROM sheep_facts_fts
      JOIN sheep_facts f ON f.rowid = sheep_facts_fts.rowid
      WHERE sheep_facts_fts MATCH ?
        ${activeOnly ? "AND f.is_active = 1" : ""}
      ORDER BY rank ASC
      LIMIT ?
    `;

    const rows = db.db.prepare(sql).all(ftsQuery, limit) as Array<
      Record<string, unknown> & { rank: number }
    >;

    // Convert to Fact objects and calculate scores
    const results: BM25SearchResult[] = [];

    for (const row of rows) {
      try {
        // Convert database row to Fact object
        // Using the same structure as rowToFact but inline since it's private
        const fact: Fact = {
          id: row.id as string,
          subject: row.subject as string,
          predicate: row.predicate as string,
          object: row.object as string,
          confidence: row.confidence as number,
          evidence: JSON.parse((row.evidence as string) || "[]"),
          firstSeen: row.first_seen as string,
          lastConfirmed: row.last_confirmed as string,
          contradictions: JSON.parse((row.contradictions as string) || "[]"),
          userAffirmed: row.user_affirmed === 1,
          isActive: row.is_active === 1,
          retractedReason: (row.retracted_reason as string) ?? undefined,
          accessCount: row.access_count as number,
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        };

        const score = bm25RankToScore(row.rank);

        if (score >= minScore) {
          results.push({
            fact,
            score,
            rank: row.rank,
          });
        }
      } catch (err) {
        log.warn("Failed to convert row to fact", {
          error: String(err),
          rowId: row.id,
        });
      }
    }

    log.debug("BM25 search completed", {
      query,
      ftsQuery,
      resultsCount: results.length,
      limit,
    });

    return results;
  } catch (err) {
    log.error("BM25 search failed", {
      query,
      ftsQuery,
      error: String(err),
    });
    return [];
  }
}

/**
 * Search facts by keyword and return just the Fact objects
 *
 * Convenience wrapper around bm25Search that returns only facts.
 *
 * @param db - SheepDatabase instance
 * @param query - Search query string
 * @param options - Search options
 * @returns Array of Fact objects
 */
export function searchFacts(
  db: SheepDatabase,
  query: string,
  options: BM25SearchOptions = {},
): Fact[] {
  return bm25Search(db, query, options).map((result) => result.fact);
}
