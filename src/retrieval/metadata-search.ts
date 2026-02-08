/**
 * SHEEP AI - Metadata/Symbolic Search
 *
 * Structured metadata search using symbolic filters. This enables precise
 * queries based on structured information like persons, dates, locations,
 * subjects, and predicates.
 *
 * Unlike semantic or keyword search, metadata search uses exact matching
 * on structured fields, making it ideal for:
 * - Finding facts about specific people
 * - Filtering by date ranges
 * - Searching by location
 * - Finding facts with specific predicates
 * - Combining multiple filters for precise queries
 *
 * @module sheep/retrieval/metadata-search
 */

import type { SheepDatabase } from "../memory/database.js";
import type { Fact } from "../memory/schema.js";
import type { MetadataFilters } from "./intent-planner.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Metadata search result
 */
export type MetadataSearchResult = {
  fact: Fact;
  score: number; // Relevance score (0-1, higher is better)
  matchReasons: string[]; // Why this fact matched
};

/**
 * Options for metadata search
 */
export type MetadataSearchOptions = {
  /** Maximum number of results (default: 10) */
  topK?: number;
  /** Only return active facts (default: true) */
  activeOnly?: boolean;
  /** Minimum confidence threshold (default: 0) */
  minConfidence?: number;
  /** Sort order (default: "confidence") */
  sortBy?: "confidence" | "recent" | "relevance";
  /** Whether to use fuzzy matching for text fields (default: false) */
  fuzzyMatch?: boolean;
};

// =============================================================================
// METADATA SEARCH
// =============================================================================

/**
 * Structured metadata search
 *
 * Searches facts using structured filters. Supports:
 * - Person names (in subject or object)
 * - Date ranges (first_seen, last_confirmed, created_at)
 * - Locations (in object field)
 * - Subjects (exact match)
 * - Predicates (exact match)
 * - Confidence thresholds
 *
 * @param filters - Metadata filters to apply
 * @param db - Database instance
 * @param options - Search options
 * @returns Array of matching facts with scores
 */
export function metadataSearch(
  filters: MetadataFilters,
  db: SheepDatabase,
  options: MetadataSearchOptions = {},
): MetadataSearchResult[] {
  const topK = options.topK ?? 10;
  const activeOnly = options.activeOnly !== false;
  const minConfidence = options.minConfidence ?? 0;
  const sortBy = options.sortBy ?? "confidence";
  const fuzzyMatch = options.fuzzyMatch ?? false;

  // If no filters provided, return empty results
  if (!filters || Object.keys(filters).length === 0) {
    return [];
  }

  log.debug("Starting metadata search", {
    filters,
    topK,
    activeOnly,
    minConfidence,
  });

  // Build SQL query
  let sql = "SELECT * FROM sheep_facts WHERE 1=1";
  const params: (string | number)[] = [];
  const matchReasons: Map<string, string[]> = new Map();

  // Active facts filter
  if (activeOnly) {
    sql += " AND is_active = 1";
  }

  // Confidence threshold
  if (minConfidence > 0) {
    sql += " AND confidence >= ?";
    params.push(minConfidence);
  }

  // Person filter (search in subject or object)
  if (filters.persons && filters.persons.length > 0) {
    if (fuzzyMatch) {
      // Use LIKE for fuzzy matching
      const personConditions = filters.persons
        .map(() => "(subject LIKE ? OR object LIKE ?)")
        .join(" OR ");
      sql += ` AND (${personConditions})`;
      for (const person of filters.persons) {
        params.push(`%${person}%`, `%${person}%`);
      }
    } else {
      // Use IN for exact matching
      const placeholders = filters.persons.map(() => "?").join(",");
      sql += ` AND (subject IN (${placeholders}) OR object IN (${placeholders}))`;
      params.push(...filters.persons, ...filters.persons);
    }
  }

  // Subject filter (exact match)
  if (filters.subjects && filters.subjects.length > 0) {
    if (fuzzyMatch) {
      const subjectConditions = filters.subjects.map(() => "subject LIKE ?").join(" OR ");
      sql += ` AND (${subjectConditions})`;
      params.push(...filters.subjects.map((s) => `%${s}%`));
    } else {
      const placeholders = filters.subjects.map(() => "?").join(",");
      sql += ` AND subject IN (${placeholders})`;
      params.push(...filters.subjects);
    }
  }

  // Predicate filter (exact match)
  if (filters.predicates && filters.predicates.length > 0) {
    if (fuzzyMatch) {
      const predicateConditions = filters.predicates.map(() => "predicate LIKE ?").join(" OR ");
      sql += ` AND (${predicateConditions})`;
      params.push(...filters.predicates.map((p) => `%${p}%`));
    } else {
      const placeholders = filters.predicates.map(() => "?").join(",");
      sql += ` AND predicate IN (${placeholders})`;
      params.push(...filters.predicates);
    }
  }

  // Location filter (search in object field)
  if (filters.locations && filters.locations.length > 0) {
    if (fuzzyMatch) {
      const locationConditions = filters.locations.map(() => "object LIKE ?").join(" OR ");
      sql += ` AND (${locationConditions})`;
      params.push(...filters.locations.map((l) => `%${l}%`));
    } else {
      const placeholders = filters.locations.map(() => "?").join(",");
      sql += ` AND object IN (${placeholders})`;
      params.push(...filters.locations);
    }
  }

  // Date range filter
  if (filters.dateRange) {
    const { start, end } = filters.dateRange;
    // Search in first_seen, last_confirmed, or created_at
    sql += ` AND (
      (first_seen >= ? AND first_seen <= ?) OR
      (last_confirmed >= ? AND last_confirmed <= ?) OR
      (created_at >= ? AND created_at <= ?)
    )`;
    params.push(start, end, start, end, start, end);
  }

  // Sort order
  switch (sortBy) {
    case "recent":
      sql += " ORDER BY created_at DESC, confidence DESC";
      break;
    case "relevance":
      // Relevance = confidence * recency factor
      sql += " ORDER BY confidence DESC, created_at DESC";
      break;
    case "confidence":
    default:
      sql += " ORDER BY confidence DESC, created_at DESC";
      break;
  }

  // Limit results
  sql += " LIMIT ?";
  params.push(topK);

  try {
    const rows = db.db.prepare(sql).all(...params) as Record<string, unknown>[];

    // Convert rows to Fact objects and calculate match reasons
    const results: MetadataSearchResult[] = rows.map((row, index) => {
      // Convert row to Fact
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

      // Determine match reasons
      const reasons: string[] = [];
      if (filters.persons?.some((p) => fact.subject.includes(p) || fact.object.includes(p))) {
        reasons.push("person_match");
      }
      if (filters.subjects?.includes(fact.subject)) {
        reasons.push("subject_match");
      }
      if (filters.predicates?.includes(fact.predicate)) {
        reasons.push("predicate_match");
      }
      if (filters.locations?.some((l) => fact.object.includes(l))) {
        reasons.push("location_match");
      }
      if (filters.dateRange) {
        const factDate = new Date(fact.createdAt);
        const startDate = new Date(filters.dateRange.start);
        const endDate = new Date(filters.dateRange.end);
        if (factDate >= startDate && factDate <= endDate) {
          reasons.push("date_match");
        }
      }

      // Calculate score based on confidence and match count
      // More matches = higher score, normalized by confidence
      const matchScore =
        reasons.length /
        Math.max(1, Object.keys(filters).filter((k) => filters[k as keyof MetadataFilters]).length);
      const score = fact.confidence * 0.7 + matchScore * 0.3;

      return {
        fact,
        score: Math.min(1, score), // Cap at 1
        matchReasons: reasons,
      };
    });

    log.debug("Metadata search completed", {
      filters,
      resultsCount: results.length,
    });

    return results;
  } catch (err) {
    log.error("Metadata search failed", {
      filters,
      error: String(err),
    });
    return [];
  }
}

/**
 * Search facts by subject
 */
export function searchBySubject(
  subject: string,
  db: SheepDatabase,
  options: MetadataSearchOptions = {},
): MetadataSearchResult[] {
  return metadataSearch({ subjects: [subject] }, db, options);
}

/**
 * Search facts by predicate
 */
export function searchByPredicate(
  predicate: string,
  db: SheepDatabase,
  options: MetadataSearchOptions = {},
): MetadataSearchResult[] {
  return metadataSearch({ predicates: [predicate] }, db, options);
}

/**
 * Search facts by person (in subject or object)
 */
export function searchByPerson(
  person: string,
  db: SheepDatabase,
  options: MetadataSearchOptions = {},
): MetadataSearchResult[] {
  return metadataSearch({ persons: [person] }, db, options);
}

/**
 * Search facts by date range
 */
export function searchByDateRange(
  start: string,
  end: string,
  db: SheepDatabase,
  options: MetadataSearchOptions = {},
): MetadataSearchResult[] {
  return metadataSearch(
    {
      dateRange: { start, end },
    },
    db,
    options,
  );
}

/**
 * Search facts by location
 */
export function searchByLocation(
  location: string,
  db: SheepDatabase,
  options: MetadataSearchOptions = {},
): MetadataSearchResult[] {
  return metadataSearch({ locations: [location] }, db, options);
}

/**
 * Combine multiple metadata searches with AND logic
 */
export function combineMetadataSearches(
  filters: MetadataFilters[],
  db: SheepDatabase,
  options: MetadataSearchOptions = {},
): MetadataSearchResult[] {
  if (filters.length === 0) {
    return [];
  }

  // Get results for each filter set
  const allResults = filters.map((filter) =>
    metadataSearch(filter, db, { ...options, topK: options.topK ? options.topK * 2 : 20 }),
  );

  // Find intersection (facts that match ALL filters)
  const factCounts = new Map<string, { result: MetadataSearchResult; count: number }>();

  for (const results of allResults) {
    for (const result of results) {
      const existing = factCounts.get(result.fact.id);
      if (existing) {
        existing.count++;
        // Update score to average
        existing.result.score = (existing.result.score + result.score) / 2;
        // Merge match reasons
        existing.result.matchReasons = [
          ...new Set([...existing.result.matchReasons, ...result.matchReasons]),
        ];
      } else {
        factCounts.set(result.fact.id, {
          result,
          count: 1,
        });
      }
    }
  }

  // Only return facts that matched all filters
  const topK = options.topK ?? 10;
  return Array.from(factCounts.values())
    .filter((entry) => entry.count === filters.length)
    .map((entry) => entry.result)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
