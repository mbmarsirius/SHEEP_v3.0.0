/**
 * SHEEP AI - Agentic Multi-Round Retrieval
 *
 * EverMemOS-style Agentic Retrieval: Multi-round retrieval for complex queries.
 * Uses LLM to determine if retrieved information is sufficient and generates
 * follow-up queries to fill information gaps.
 *
 * This enables answering complex, multi-hop questions that require multiple
 * retrieval rounds to gather all necessary information.
 *
 * @module sheep/retrieval/agentic-retrieval
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { LLMProvider } from "../extraction/llm-extractor.js";
import type { SheepDatabase } from "../memory/database.js";
import type { RetrievalResult } from "./hybrid-retrieval.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { hybridRetrieve } from "./hybrid-retrieval.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Sufficiency check result
 */
export type SufficiencyResult = {
  /** Whether the retrieved information is sufficient */
  isSufficient: boolean;
  /** List of missing information items */
  missingInfo: string[];
  /** Confidence in sufficiency assessment (0-1) */
  confidence: number;
};

/**
 * Options for agentic retrieval
 */
export type AgenticRetrievalOptions = {
  /** Maximum number of retrieval rounds (default: 3) */
  maxRounds?: number;
  /** Top K results per round (default: 20) */
  topKPerRound?: number;
  /** Top K results for follow-up queries (default: 10) */
  topKFollowUp?: number;
  /** Minimum sufficiency confidence to stop early (default: 0.8) */
  minSufficiencyConfidence?: number;
  /** Maximum total results to return (default: 50) */
  maxTotalResults?: number;
  /** Whether to use intent planning (default: true) */
  usePlanning?: boolean;
};

/**
 * Agentic retrieval result with metadata
 */
export type AgenticRetrievalResult = {
  results: RetrievalResult[];
  rounds: number;
  sufficiencyChecks: SufficiencyResult[];
  followUpQueries: string[];
};

// =============================================================================
// RESULT MERGING & DEDUPLICATION
// =============================================================================

/**
 * Merge and deduplicate retrieval results
 *
 * Combines results from multiple rounds, keeping the highest score for each fact.
 */
function mergeAndDeduplicate(results: RetrievalResult[]): RetrievalResult[] {
  const merged = new Map<string, RetrievalResult>();

  for (const result of results) {
    const factId = result.fact.id;
    const existing = merged.get(factId);

    if (!existing) {
      merged.set(factId, result);
    } else {
      // Keep the result with higher score
      if (result.score > existing.score) {
        // Merge sources from both results
        merged.set(factId, {
          ...result,
          sources: {
            ...existing.sources,
            ...result.sources,
          },
        });
      } else {
        // Keep existing but merge sources
        existing.sources = {
          ...existing.sources,
          ...result.sources,
        };
      }
    }
  }

  // Sort by score (highest first)
  return Array.from(merged.values()).sort((a, b) => b.score - a.score);
}

// =============================================================================
// SUFFICIENCY CHECKING
// =============================================================================

/**
 * Check if retrieved information is sufficient to answer the query
 *
 * Uses LLM to analyze whether the retrieved facts can fully answer the query.
 * Returns information about what's missing if insufficient.
 */
async function checkSufficiency(
  query: string,
  results: RetrievalResult[],
  llm: LLMProvider,
): Promise<SufficiencyResult> {
  if (results.length === 0) {
    return {
      isSufficient: false,
      missingInfo: ["No information retrieved"],
      confidence: 0.5,
    };
  }

  // Format results for LLM
  const factsText = results
    .slice(0, 20) // Limit to top 20 for prompt size
    .map(
      (r, i) =>
        `${i + 1}. ${r.fact.subject} ${r.fact.predicate} ${r.fact.object} (confidence: ${r.fact.confidence.toFixed(2)}, score: ${r.score.toFixed(3)})`,
    )
    .join("\n");

  const prompt = `You are analyzing whether retrieved information is sufficient to answer a user query.

Query: "${query}"

Retrieved information (${results.length} facts):
${factsText}

Your task:
1. Determine if this information can fully answer the query
2. If not, identify what specific information is missing

Consider:
- Does the information directly address the query?
- Are there gaps or ambiguities?
- Would additional context help?

Return ONLY a JSON object with this exact structure:
{
  "isSufficient": true/false,
  "missingInfo": ["missing item 1", "missing item 2", ...],
  "confidence": 0.0-1.0
}

Do not include any explanation or markdown formatting. Only return the JSON object.`;

  try {
    const response = await llm.complete(prompt, {
      jsonMode: true,
      maxTokens: 300,
      temperature: 0.3,
    });

    // Check for empty response (common with Kimi K2.5)
    if (!response || typeof response !== "string" || response.trim().length === 0) {
      log.warn("Sufficiency check returned empty response", {
        llmName: llm.name,
        resultsCount: results.length,
      });
      // Default to insufficient to continue retrieval
      return {
        isSufficient: false,
        missingInfo: ["Sufficiency check returned empty response"],
        confidence: 0.5,
      };
    }

    // Parse JSON response with improved error handling
    let sufficiency: any;
    try {
      // Try multiple cleaning strategies
      let cleaned = response.trim();

      // Remove markdown code blocks
      cleaned = cleaned
        .replace(/```json\n?/gi, "")
        .replace(/```\n?/g, "")
        .trim();

      // Try to extract JSON if wrapped in text
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleaned = jsonMatch[0];
      }

      // Final check before parsing
      if (!cleaned || cleaned.length === 0) {
        throw new Error("Empty response after cleaning");
      }

      sufficiency = JSON.parse(cleaned);

      // Validate structure
      if (typeof sufficiency !== "object" || sufficiency === null) {
        throw new Error("Parsed result is not an object");
      }
    } catch (parseErr) {
      log.warn("Failed to parse sufficiency check response", {
        responseLength: response?.length || 0,
        responsePreview: response?.slice(0, 300) || "null/empty",
        error: String(parseErr),
        errorType: parseErr instanceof Error ? parseErr.name : typeof parseErr,
        llmName: llm.name,
      });
      console.error(`[SHEEP] Sufficiency parse error: ${String(parseErr)}`);
      console.error(`[SHEEP] Response preview: ${response?.slice(0, 300) || "null/empty"}`);

      // Quick fix: Default to insufficient to continue retrieval
      return {
        isSufficient: false,
        missingInfo: ["Failed to parse sufficiency check - continuing retrieval"],
        confidence: 0.5,
      };
    }

    return {
      isSufficient: sufficiency.isSufficient === true,
      missingInfo: Array.isArray(sufficiency.missingInfo)
        ? sufficiency.missingInfo.filter((item: any) => typeof item === "string")
        : [],
      confidence: Math.max(0, Math.min(1, sufficiency.confidence ?? 0.7)),
    };
  } catch (err) {
    log.error("Sufficiency check failed", {
      error: String(err),
      llmName: llm.name,
    });
    // Fallback: assume insufficient to continue retrieval
    return {
      isSufficient: false,
      missingInfo: ["Sufficiency check failed - continuing retrieval"],
      confidence: 0.5,
    };
  }
}

// =============================================================================
// FOLLOW-UP QUERY GENERATION
// =============================================================================

/**
 * Generate follow-up queries to fill information gaps
 *
 * Uses LLM to generate targeted queries based on missing information.
 */
async function generateFollowUpQueries(
  originalQuery: string,
  currentResults: RetrievalResult[],
  missingInfo: string[],
  llm: LLMProvider,
): Promise<string[]> {
  if (missingInfo.length === 0) {
    return [];
  }

  // Format current results for context
  const resultsSummary = currentResults
    .slice(0, 10)
    .map((r) => `${r.fact.subject} ${r.fact.predicate} ${r.fact.object}`)
    .join("\n");

  const prompt = `You are generating follow-up search queries to fill information gaps.

Original query: "${originalQuery}"

Already retrieved information:
${resultsSummary || "None"}

Missing information:
${missingInfo.map((item, i) => `${i + 1}. ${item}`).join("\n")}

Generate 2-4 specific search queries that would help retrieve the missing information.
Each query should be:
- Specific and targeted
- Different from the original query
- Focused on one aspect of the missing information

Return ONLY a JSON array of query strings:
["query 1", "query 2", "query 3"]

Do not include any explanation or markdown formatting. Only return the JSON array.`;

  try {
    const response = await llm.complete(prompt, {
      jsonMode: true,
      maxTokens: 200,
      temperature: 0.5,
    });

    // Check for empty response (common with Kimi K2.5)
    if (!response || typeof response !== "string" || response.trim().length === 0) {
      log.warn("Follow-up query generation returned empty response", {
        llmName: llm.name,
        missingInfoCount: missingInfo.length,
      });
      // Fallback: generate simple queries from missing info
      return missingInfo.slice(0, 3).map((item) => `${originalQuery} ${item}`);
    }

    // Parse JSON response with improved error handling
    let queries: any;
    try {
      // Try multiple cleaning strategies
      let cleaned = response.trim();

      // Remove markdown code blocks
      cleaned = cleaned
        .replace(/```json\n?/gi, "")
        .replace(/```\n?/g, "")
        .trim();

      // Try to extract JSON array if wrapped in text
      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        cleaned = arrayMatch[0];
      }

      // Final check before parsing
      if (!cleaned || cleaned.length === 0) {
        throw new Error("Empty response after cleaning");
      }

      queries = JSON.parse(cleaned);

      // Validate structure
      if (!Array.isArray(queries)) {
        throw new Error("Parsed result is not an array");
      }
    } catch (parseErr) {
      log.warn("Failed to parse follow-up queries response", {
        responseLength: response?.length || 0,
        responsePreview: response?.slice(0, 300) || "null/empty",
        error: String(parseErr),
        errorType: parseErr instanceof Error ? parseErr.name : typeof parseErr,
        llmName: llm.name,
      });
      console.error(`[SHEEP] Follow-up queries parse error: ${String(parseErr)}`);
      console.error(`[SHEEP] Response preview: ${response?.slice(0, 300) || "null/empty"}`);

      // Fallback: generate simple queries from missing info
      return missingInfo.slice(0, 3).map((item) => `${originalQuery} ${item}`);
    }

    // Validate and return queries
    if (Array.isArray(queries)) {
      return queries.filter((q) => typeof q === "string" && q.length > 0).slice(0, 4); // Limit to 4 queries
    }

    return [];
  } catch (err) {
    log.error("Follow-up query generation failed", {
      error: String(err),
      llmName: llm.name,
    });
    // Fallback: generate simple queries
    return missingInfo.slice(0, 3).map((item) => `${originalQuery} ${item}`);
  }
}

// =============================================================================
// AGENTIC RETRIEVAL
// =============================================================================

/**
 * EverMemOS-style Agentic Multi-Round Retrieval
 *
 * Performs multi-round retrieval for complex queries:
 * 1. Initial retrieval round
 * 2. Check sufficiency using LLM
 * 3. Generate follow-up queries if insufficient
 * 4. Execute follow-up searches
 * 5. Repeat until sufficient or max rounds reached
 *
 * This enables answering complex, multi-hop questions that require
 * gathering information from multiple angles.
 *
 * @param query - User query string
 * @param db - Database instance
 * @param embeddingProvider - Embedding provider for vector search
 * @param llm - LLM provider for sufficiency checking and query generation
 * @param options - Retrieval options
 * @returns Retrieval results with metadata about rounds and queries
 */
export async function agenticRetrieve(
  query: string,
  db: SheepDatabase,
  embeddingProvider: EmbeddingProvider,
  llm: LLMProvider,
  options: AgenticRetrievalOptions = {},
): Promise<AgenticRetrievalResult> {
  const maxRounds = options.maxRounds ?? 3;
  const topKPerRound = options.topKPerRound ?? 20;
  const topKFollowUp = options.topKFollowUp ?? 10;
  const minSufficiencyConfidence = options.minSufficiencyConfidence ?? 0.8;
  const maxTotalResults = options.maxTotalResults ?? 50;
  const usePlanning = options.usePlanning !== false;

  log.info("Starting agentic retrieval", {
    query: query.slice(0, 50),
    maxRounds,
    topKPerRound,
  });

  let results: RetrievalResult[] = [];
  let rounds = 0;
  const sufficiencyChecks: SufficiencyResult[] = [];
  const followUpQueries: string[] = [];

  while (rounds < maxRounds) {
    rounds++;
    log.debug(`Agentic retrieval round ${rounds}/${maxRounds}`, {
      currentResults: results.length,
    });

    // Step 1: Get current results (or initial results in first round)
    const newResults = await hybridRetrieve(
      query,
      db,
      embeddingProvider,
      undefined, // No LLM for planning in follow-up rounds
      {
        topK: rounds === 1 ? topKPerRound : topKFollowUp,
        usePlanning: rounds === 1 && usePlanning, // Only plan in first round
      },
    );

    // Merge with existing results
    results = mergeAndDeduplicate([...results, ...newResults]);

    // Limit total results
    if (results.length > maxTotalResults) {
      results = results.slice(0, maxTotalResults);
    }

    log.debug(`Round ${rounds} completed`, {
      newResults: newResults.length,
      totalResults: results.length,
    });

    // Step 2: Check sufficiency
    const sufficiency = await checkSufficiency(query, results, llm);
    sufficiencyChecks.push(sufficiency);

    log.debug(`Sufficiency check round ${rounds}`, {
      isSufficient: sufficiency.isSufficient,
      confidence: sufficiency.confidence,
      missingInfo: sufficiency.missingInfo.length,
    });

    // Step 3: Stop if sufficient
    if (sufficiency.isSufficient && sufficiency.confidence >= minSufficiencyConfidence) {
      log.info("Agentic retrieval completed - sufficient information", {
        rounds,
        totalResults: results.length,
        confidence: sufficiency.confidence,
      });
      break;
    }

    // Step 4: Generate follow-up queries if not sufficient and not last round
    if (rounds < maxRounds && sufficiency.missingInfo.length > 0) {
      const followUps = await generateFollowUpQueries(query, results, sufficiency.missingInfo, llm);

      log.debug(`Generated ${followUps.length} follow-up queries`, {
        queries: followUps,
      });

      // Step 5: Execute follow-up searches
      for (const followUpQuery of followUps) {
        followUpQueries.push(followUpQuery);

        try {
          const additionalResults = await hybridRetrieve(
            followUpQuery,
            db,
            embeddingProvider,
            undefined,
            {
              topK: topKFollowUp,
              usePlanning: false, // Don't plan follow-up queries
            },
          );

          results = mergeAndDeduplicate([...results, ...additionalResults]);

          // Limit total results
          if (results.length > maxTotalResults) {
            results = results.slice(0, maxTotalResults);
          }
        } catch (err) {
          log.warn("Follow-up query failed", {
            query: followUpQuery,
            error: String(err),
          });
        }
      }
    }
  }

  log.info("Agentic retrieval completed", {
    query: query.slice(0, 50),
    rounds,
    totalResults: results.length,
    followUpQueries: followUpQueries.length,
    finalSufficiency: sufficiencyChecks[sufficiencyChecks.length - 1]?.isSufficient,
  });

  return {
    results,
    rounds,
    sufficiencyChecks,
    followUpQueries,
  };
}

/**
 * Simple agentic retrieve that returns just results
 *
 * Convenience wrapper that returns only the results array.
 */
export async function agenticRetrieveSimple(
  query: string,
  db: SheepDatabase,
  embeddingProvider: EmbeddingProvider,
  llm: LLMProvider,
  options: AgenticRetrievalOptions = {},
): Promise<RetrievalResult[]> {
  const result = await agenticRetrieve(query, db, embeddingProvider, llm, options);
  return result.results;
}
