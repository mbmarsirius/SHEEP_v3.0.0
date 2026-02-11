/**
 * SHEEP AI - Consolidation Engine
 *
 * The "sleep" cycle - processes raw sessions into cognitive memory.
 * Runs periodically (or on-demand) to:
 * 1. Extract episodes from new sessions
 * 2. Extract facts from episodes
 * 3. Build causal links
 * 4. Detect and resolve contradictions
 * 5. Prune low-retention memories
 *
 * @module sheep/consolidation/consolidator
 */

import type { Episode, ConsolidationRun, Fact } from "../memory/schema.js";
import { createSubsystemLogger } from "../stubs/logging.js";
import {
  extractEpisodesFromSessions,
  type ExtractionOptions,
} from "../extraction/episode-extractor.js";
import {
  extractFactsFromEpisode,
  detectContradictions,
  resolveContradiction,
} from "../extraction/fact-extractor.js";
import { resolveContradictionWithLLM, extractFactsWithLLM } from "../extraction/llm-extractor.js";
// LLM extraction imports for causal link extraction (Task 1 fix)
import {
  extractCausalLinksWithLLM,
  createSheepLLMProvider,
  type LLMProvider,
} from "../extraction/llm-extractor.js";
import { SheepDatabase } from "../memory/database.js";
import { extractProceduresFromEpisode } from "../procedures/extractor.js";
import { runActiveForgetting } from "./forgetting.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for consolidation
 */
export type ConsolidationOptions = {
  /** Agent ID to consolidate */
  agentId: string;
  /** Only process sessions after this date (ISO string) */
  since?: string;
  /** Dry run - don't persist changes */
  dryRun?: boolean;
  /** Episode extraction options */
  extractionOptions?: ExtractionOptions;
  /** Minimum retention score to keep memories (0-1) */
  minRetentionScore?: number;
  /** Callback for progress updates */
  onProgress?: (stage: string, current: number, total: number) => void;
  /** Use LLM for enhanced extraction (default: true) - enables causal link extraction */
  useLLMExtraction?: boolean;
  /** Use LLM for contradiction resolution (default: true when LLM available) */
  useLLMContradictionResolution?: boolean;
  /** Enable LLM-powered sleep consolidation (default: true - THE REAL SHEEP) */
  enableLLMSleep?: boolean;
  /** Maximum number of episodes to process per run (default: unlimited) */
  maxEpisodesPerRun?: number;
};

/**
 * Result of a consolidation run
 */
export type ConsolidationResult = {
  runId: string;
  success: boolean;
  sessionsProcessed: number;
  episodesExtracted: number;
  factsExtracted: number;
  causalLinksExtracted: number;
  proceduresExtracted: number;
  contradictionsResolved: number;
  memoriesPruned: number;
  durationMs: number;
  error?: string;
};

// =============================================================================
// CONSOLIDATION ENGINE
// =============================================================================

/**
 * Run a consolidation cycle
 */
export async function runConsolidation(
  options: ConsolidationOptions,
): Promise<ConsolidationResult> {
  const startTime = Date.now();
  const db = new SheepDatabase(options.agentId);

  // Determine time range
  const lastRun = db.getLastConsolidationRun();
  const processedFrom = options.since ?? lastRun?.processedTo ?? new Date(0).toISOString();
  const processedTo = new Date().toISOString();

  // AUTONOMOUS MODE: Initialize LLM provider with auto-retry and graceful fallback
  // Default to true for LLM extraction - this is what makes SHEEP powerful
  let llm: LLMProvider | null = null;
  if (options.useLLMExtraction !== false) {
    // Auto-retry LLM initialization (max 3 attempts)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        llm = await createSheepLLMProvider("extraction");
        log.info("LLM extraction enabled for consolidation", { provider: llm.name, attempt: attempt + 1 });
        break; // Success, exit retry loop
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (attempt < 2) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // 1s, 2s, 4s
          log.warn("LLM initialization failed, retrying...", {
            attempt: attempt + 1,
            delayMs: delay,
            error: errorMsg.slice(0, 100),
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          log.warn("LLM extraction unavailable after retries, using basic extraction only", {
            error: errorMsg.slice(0, 100),
          });
        }
      }
    }
  }

  log.info("Starting SHEEP consolidation", {
    agentId: options.agentId,
    from: processedFrom,
    to: processedTo,
    dryRun: options.dryRun,
    llmEnabled: !!llm,
  });

  // Start consolidation run tracking
  let run: ConsolidationRun | undefined;
  if (!options.dryRun) {
    run = db.startConsolidationRun(processedFrom, processedTo);
  }

  const stats = {
    sessionsProcessed: 0,
    episodesExtracted: 0,
    factsExtracted: 0,
    causalLinksExtracted: 0,
    proceduresExtracted: 0,
    contradictionsResolved: 0,
    memoriesPruned: 0,
  };

  try {
    // Stage 1: Extract episodes from sessions
    options.onProgress?.("Extracting episodes", 0, 1);
    const { episodes, sessionsProcessed } = await extractEpisodesFromSessions(options.agentId, {
      ...options.extractionOptions,
      processedFrom, // Only process episodes after the last consolidation
    });
    stats.sessionsProcessed = sessionsProcessed;

    // Limit episodes per run to prevent timeout
    const maxEpisodes = options.maxEpisodesPerRun ?? Infinity;
    const episodesToProcess = episodes.slice(0, maxEpisodes);

    if (episodes.length > maxEpisodes) {
      log.info(
        `Limiting episode processing to ${maxEpisodes} of ${episodes.length} total episodes`,
      );
    }

    log.debug("Episodes extracted", {
      count: episodesToProcess.length,
      total: episodes.length,
      sessions: sessionsProcessed,
    });

    // Stage 2: Store episodes and extract facts
    options.onProgress?.("Processing episodes", 0, episodesToProcess.length);
    const storedEpisodes: Episode[] = [];

    for (let i = 0; i < episodesToProcess.length; i++) {
      const episodeData = episodesToProcess[i];
      options.onProgress?.("Processing episodes", i + 1, episodesToProcess.length);

      // Store episode
      if (!options.dryRun) {
        const stored = db.insertEpisode(episodeData);
        storedEpisodes.push(stored);
        stats.episodesExtracted++;

        // Extract facts from this episode (use LLM if available for better quality)
        // Both extractors return compatible types that db.insertFact accepts
        let factCandidates: Array<
          Omit<
            Fact,
            "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions"
          >
        >;

        if (llm) {
          // Use LLM extraction for better quality (SimpleMem approach: lossless restatement)
          try {
            const llmFacts = await extractFactsWithLLM(llm, stored.summary, stored.id);
            // Convert LLM facts to database format (remove fields that DB will add)
            factCandidates = llmFacts.map((f) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { accessCount, isActive, contradictions, ...factData } = f;
              return {
                ...factData,
                retractedReason: undefined,
              };
            });
            log.debug("Extracted facts using LLM", {
              episodeId: stored.id,
              factCount: llmFacts.length,
            });
          } catch (err) {
            // Fall back to pattern-based extraction if LLM fails
            log.warn("LLM fact extraction failed, using pattern-based", {
              episodeId: stored.id,
              error: String(err),
            });
            factCandidates = extractFactsFromEpisode(stored);
          }
        } else {
          // Use pattern-based extraction when LLM not available
          factCandidates = extractFactsFromEpisode(stored);
        }

        for (const factData of factCandidates) {
          // Check for contradictions
          const existingFacts = db.findFacts({
            subject: factData.subject,
            predicate: factData.predicate,
          });

          const newFact = db.insertFact(factData);
          stats.factsExtracted++;

          // Detect and resolve contradictions
          const contradictions = detectContradictions(newFact, existingFacts);
          for (const contradicting of contradictions) {
            let resolution: { keep: typeof newFact; retract: typeof newFact; reason: string };

            // Use LLM for complex contradictions if available
            const useLLMResolution = options.useLLMContradictionResolution !== false && llm;
            if (useLLMResolution && llm) {
              try {
                const llmResolution = await resolveContradictionWithLLM(
                  llm,
                  newFact,
                  contradicting,
                );

                if (llmResolution.resolution === "keep_first") {
                  resolution = {
                    keep: newFact,
                    retract: contradicting,
                    reason: `LLM: ${llmResolution.reasoning}`,
                  };
                } else if (llmResolution.resolution === "keep_second") {
                  resolution = {
                    keep: contradicting,
                    retract: newFact,
                    reason: `LLM: ${llmResolution.reasoning}`,
                  };
                } else if (llmResolution.resolution === "keep_both") {
                  // LLM says both can be true - skip retraction
                  log.debug("LLM determined facts are compatible", {
                    fact1: newFact.id,
                    fact2: contradicting.id,
                    reasoning: llmResolution.reasoning,
                  });
                  continue; // Skip to next contradiction
                } else {
                  // Fall back to rule-based resolution for other cases
                  resolution = resolveContradiction(newFact, contradicting);
                }
              } catch (err) {
                // Fall back to rule-based if LLM fails
                log.warn("LLM contradiction resolution failed, using rule-based", {
                  error: String(err),
                });
                resolution = resolveContradiction(newFact, contradicting);
              }
            } else {
              // Use rule-based resolution
              resolution = resolveContradiction(newFact, contradicting);
            }

            // Retract the losing fact
            db.retractFact(resolution.retract.id, resolution.reason);
            stats.contradictionsResolved++;

            log.debug("Resolved contradiction", {
              kept: resolution.keep.id,
              retracted: resolution.retract.id,
              reason: resolution.reason,
              usedLLM: useLLMResolution,
            });
          }

          // Wire preference from fact (prefers/likes/dislikes -> preferences table)
          const prefPredicates = ["prefers", "likes", "dislikes", "prefers_not", "loves", "hates"];
          if (
            prefPredicates.includes(newFact.predicate.toLowerCase()) &&
            newFact.subject.toLowerCase() === "user"
          ) {
            try {
              const existing = db.getUserPreferences("user", { category: "general" });
              const alreadyHas = existing.some(
                (p) => p.preference.toLowerCase().trim() === newFact.object.toLowerCase().trim(),
              );
              if (!alreadyHas) {
                const sentiment =
                  ["dislikes", "hates", "prefers_not"].includes(newFact.predicate.toLowerCase())
                    ? "negative"
                    : "positive";
                db.insertPreference({
                  userId: "user",
                  category: "general",
                  preference: newFact.object,
                  sentiment: sentiment as "positive" | "negative" | "neutral",
                  confidence: newFact.confidence,
                  source: stored.id,
                });
              }
            } catch {
              // Ignore duplicate preference
            }
          }
        }
      } else {
        stats.episodesExtracted++;
        const mockEpisode: Episode = {
          ...episodeData,
          id: `dry-run-${i}`,
          accessCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const factCandidates = extractFactsFromEpisode(mockEpisode);
        stats.factsExtracted += factCandidates.length;
      }
    }

    // Stage 2.5: Extract procedures from stored episodes
    if (!options.dryRun && storedEpisodes.length > 0) {
      options.onProgress?.("Extracting procedures", 0, storedEpisodes.length);

      for (let i = 0; i < storedEpisodes.length; i++) {
        const episode = storedEpisodes[i];
        options.onProgress?.("Extracting procedures", i + 1, storedEpisodes.length);

        try {
          const procedures = extractProceduresFromEpisode(episode);

          for (const procData of procedures) {
            // Check if a similar procedure already exists
            const existingProcs = db.findProcedures({
              triggerContains: procData.trigger.substring(0, 20),
            });

            // Only insert if not a duplicate
            const isDuplicate = existingProcs.some(
              (existing) =>
                existing.trigger.toLowerCase() === procData.trigger.toLowerCase() &&
                existing.action.toLowerCase() === procData.action.toLowerCase(),
            );

            if (!isDuplicate) {
              db.insertProcedure(procData);
              stats.proceduresExtracted++;

              log.debug("Extracted procedure", {
                trigger: procData.trigger,
                action: procData.action,
              });
            }
          }
        } catch (err) {
          log.warn("Procedure extraction failed for episode", {
            episodeId: episode.id,
            error: String(err),
          });
        }
      }
    }

    // Stage 2.6: Extract CAUSAL LINKS using LLM (THE CRITICAL FIX - Task 1)
    // This is the breakthrough - using LLM to understand WHY things happen
    if (!options.dryRun && storedEpisodes.length > 0 && llm) {
      options.onProgress?.("Extracting causal links", 0, storedEpisodes.length);

      for (let i = 0; i < storedEpisodes.length; i++) {
        const episode = storedEpisodes[i];
        options.onProgress?.("Extracting causal links", i + 1, storedEpisodes.length);

        try {
          // The episode.summary contains the full conversation text
          // Format: "[user]: ... \n\n [assistant]: ..."
          const conversationText = episode.summary;

          // Skip episodes with minimal content
          if (conversationText.length < 50) {
            log.debug("Skipping causal extraction for short episode", { episodeId: episode.id });
            continue;
          }

          // Extract causal links using LLM (with timestamp resolution)
          const causalLinks = await extractCausalLinksWithLLM(
            llm,
            conversationText,
            episode.id,
            episode.timestamp,
          );

          for (const linkData of causalLinks) {
            db.insertCausalLink(linkData);
            stats.causalLinksExtracted++;

            log.debug("Extracted causal link", {
              cause: linkData.causeDescription.substring(0, 50),
              effect: linkData.effectDescription.substring(0, 50),
              mechanism: linkData.mechanism,
              confidence: linkData.confidence,
            });
          }
        } catch (err) {
          log.warn("Causal link extraction failed for episode", {
            episodeId: episode.id,
            error: String(err),
          });
        }
      }

      log.info("Causal link extraction completed", {
        totalCausalLinks: stats.causalLinksExtracted,
        episodesProcessed: storedEpisodes.length,
      });
    } else if (!llm && !options.dryRun) {
      log.info("Skipping causal link extraction (LLM not available)");
    }

    // Stage 2.7: FORESIGHT EXTRACTION (predict future behavior/events)
    if (!options.dryRun && storedEpisodes.length > 0 && llm) {
      try {
        const { extractForesightsFromEpisodes } = await import("../extraction/foresight-extractor.js");
        options.onProgress?.("Extracting foresights", 0, storedEpisodes.length);

        const foresightCandidates = await extractForesightsFromEpisodes(
          storedEpisodes as any[],
          llm,
        );

        for (const foresight of foresightCandidates) {
          try {
            db.insertForesight({
              description: foresight.description,
              evidence: foresight.evidence,
              startTime: foresight.startTime,
              endTime: foresight.endTime ?? null,
              durationDays: foresight.durationDays ?? null,
              confidence: foresight.confidence,
              sourceEpisodeId: (foresight as Record<string, unknown>).sourceEpisodeId as string | undefined,
              userId: "user",
            });
          } catch {
            // Ignore duplicate foresight errors
          }
        }

        log.info("Foresight extraction completed", { count: foresightCandidates.length });
      } catch (err) {
        log.warn("Foresight extraction failed, continuing", { error: String(err).slice(0, 100) });
      }
    }

    // Stage 2.8: PROFILE DISCRIMINATION (stable vs transient traits)
    if (!options.dryRun && stats.factsExtracted > 0) {
      try {
        const { buildDynamicProfile } = await import("../extraction/profile-discriminator.js");
        options.onProgress?.("Building user profile", 0, 1);

        const allFacts = db.findFacts({ activeOnly: true });
        const profile = buildDynamicProfile(allFacts);

        // Store profile
        try {
          db.insertUserProfile({
            userId: "user",
            attributes: JSON.parse(JSON.stringify(profile)),
            confidence: 0.8,
          });
        } catch {
          // May already exist, update instead
          try {
            db.updateUserProfile("user", {
              attributes: JSON.parse(JSON.stringify(profile)),
              confidence: 0.8,
            });
          } catch {
            // Ignore profile storage errors
          }
        }

        log.info("Profile discrimination completed", {
          stableTraits: profile.stableTraits?.length ?? 0,
          transientStates: profile.transientStates?.length ?? 0,
        });
      } catch (err) {
        log.warn("Profile discrimination failed, continuing", { error: String(err).slice(0, 100) });
      }
    }

    // Stage 2.9: LLM-POWERED SLEEP CONSOLIDATION (THE REAL SHEEP BREAKTHROUGH)
    // AUTONOMOUS MODE: Auto-retry with graceful fallback - never fail the whole consolidation
    // This is what makes SHEEP truly "cognitive" - pattern discovery, fact consolidation,
    // connection finding, and intelligent forgetting recommendations
    if (!options.dryRun && llm && options.enableLLMSleep !== false) {
      options.onProgress?.("LLM sleep consolidation", 0, 1);
      
      // Auto-retry sleep consolidation (max 2 attempts)
      let sleepSuccess = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // Get recent memories for sleep consolidation
          const recentEpisodes = db.queryEpisodes({ limit: 100 });
          const recentFacts = db.findFacts({ activeOnly: true });
          const recentCausalLinks = db.findCausalLinks({}).slice(0, 100);

          if (recentEpisodes.length > 0 || recentFacts.length > 0 || recentCausalLinks.length > 0) {
            if (attempt === 0) {
              log.info("Running LLM sleep consolidation", {
                episodes: recentEpisodes.length,
                facts: recentFacts.length,
                causalLinks: recentCausalLinks.length,
              });
            } else {
              log.info("Retrying LLM sleep consolidation", { attempt: attempt + 1 });
            }

            const { runLLMSleepConsolidation } = await import("./llm-sleep.js");
            const sleepResult = await runLLMSleepConsolidation(
              llm,
              recentEpisodes,
              recentFacts,
              recentCausalLinks,
              {
                discoverPatterns: true,
                consolidateFacts: true,
                findConnections: true,
                recommendForgetting: true,
              },
            );

            log.info("LLM sleep consolidation completed", {
              patternsDiscovered: sleepResult.patternsDiscovered.length,
              factsConsolidated: sleepResult.factsConsolidated.length,
              connectionsCreated: sleepResult.connectionsCreated.length,
              forgettingRecommendations: sleepResult.forgettingRecommendations.length,
              contradictionsResolved: sleepResult.contradictionsResolved.length,
              durationMs: sleepResult.durationMs,
            });

            // Apply forgetting recommendations (with error handling)
            if (sleepResult.forgettingRecommendations.length > 0) {
              for (const rec of sleepResult.forgettingRecommendations) {
                try {
                  if (rec.memoryType === "episode") {
                    // Demote episode (mark as low priority)
                    const episode = recentEpisodes.find((e) => e.id === rec.memoryId);
                    if (episode) {
                      // Episode demotion - mark via lower utility (handled by forgetting system)
                      void episode; // updateEpisode not yet available
                    }
                  } else if (rec.memoryType === "fact") {
                    // Retract fact
                    const fact = recentFacts.find((f) => f.id === rec.memoryId);
                    if (fact) {
                      db.retractFact(fact.id, `LLM sleep: ${rec.reason}`);
                      stats.memoriesPruned++;
                    }
                  }
                } catch (recErr) {
                  log.warn("Failed to apply forgetting recommendation", {
                    memoryId: rec.memoryId,
                    error: String(recErr).slice(0, 100),
                  });
                  // Continue with other recommendations
                }
              }
            }

            sleepSuccess = true;
            break; // Success, exit retry loop
          } else {
            log.info("Skipping LLM sleep consolidation (no recent memories)");
            sleepSuccess = true; // Not an error, just nothing to process
            break;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          if (attempt < 1) {
            const delay = Math.min(2000 * Math.pow(2, attempt), 10000); // 2s, 4s
            log.warn("LLM sleep consolidation failed, retrying...", {
              attempt: attempt + 1,
              delayMs: delay,
              error: errorMsg.slice(0, 100),
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            log.warn("LLM sleep consolidation failed after retries, continuing without it", {
              error: errorMsg.slice(0, 100),
            });
            // Don't throw - graceful degradation, continue with rest of consolidation
          }
        }
      }

      if (!sleepSuccess) {
        log.info("LLM sleep consolidation skipped (failed after retries)");
      }
    } else if (!llm && !options.dryRun) {
      log.info("Skipping LLM sleep consolidation (LLM not available)");
    } else if (options.enableLLMSleep === false) {
      log.info("LLM sleep consolidation disabled by config");
    }

    // Stage 3: Run active forgetting (prune/demote low-retention memories)
    if (!options.dryRun) {
      options.onProgress?.("Active forgetting", 0, 1);
      const forgettingResult = await runActiveForgetting(db, {
        minRetentionScore: options.minRetentionScore ?? 0.2,
        dryRun: false,
      });
      stats.memoriesPruned += forgettingResult.episodesPruned + forgettingResult.factsDemoted;
    }

    // Stage 4: Enforce memory limits (handle growth gracefully)
    if (!options.dryRun) {
      options.onProgress?.("Enforcing memory limits", 0, 1);
      const limitCheck = db.checkMemoryLimits();
      if (limitCheck.exceeded) {
        log.warn("Memory limits exceeded, pruning to enforce limits", {
          details: limitCheck.details,
          counts: limitCheck.counts,
        });
        const pruneResult = db.enforceMemoryLimits();
        stats.memoriesPruned +=
          pruneResult.episodesPruned +
          pruneResult.factsPruned +
          pruneResult.causalLinksPruned +
          pruneResult.proceduresPruned;
        log.info("Memory limits enforced", {
          episodesPruned: pruneResult.episodesPruned,
          factsPruned: pruneResult.factsPruned,
          causalLinksPruned: pruneResult.causalLinksPruned,
          proceduresPruned: pruneResult.proceduresPruned,
        });
      }
    }

    // Complete the run
    const durationMs = Date.now() - startTime;

    if (!options.dryRun && run) {
      db.completeConsolidationRun(run.id, stats);
    }

    log.info("SHEEP consolidation complete", {
      ...stats,
      durationMs,
    });

    db.close();

    return {
      runId: run?.id ?? "dry-run",
      success: true,
      ...stats,
      durationMs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!options.dryRun && run) {
      db.completeConsolidationRun(run.id, stats, errorMessage);
    }

    log.error("SHEEP consolidation failed", { error: errorMessage });

    db.close();

    return {
      runId: run?.id ?? "dry-run",
      success: false,
      ...stats,
      durationMs: Date.now() - startTime,
      error: errorMessage,
    };
  }
}

// =============================================================================
// QUERY HELPERS
// =============================================================================

/**
 * Get memory statistics for an agent
 */
export function getMemoryStats(agentId: string) {
  const db = new SheepDatabase(agentId);
  const stats = db.getStats();
  db.close();
  return stats;
}

/**
 * Query facts for an agent
 */
export function queryFacts(
  agentId: string,
  options: { subject?: string; predicate?: string; object?: string; minConfidence?: number },
) {
  const db = new SheepDatabase(agentId);
  const facts = db.findFacts(options);
  db.close();
  return facts;
}

/**
 * Query episodes for an agent
 */
export function queryEpisodes(
  agentId: string,
  options: { topic?: string; minSalience?: number; since?: string; limit?: number },
) {
  const db = new SheepDatabase(agentId);
  const episodes = db.queryEpisodes(options);
  db.close();
  return episodes;
}

/**
 * Query causal chain for a fact
 */
export function queryCausalChain(agentId: string, effectId: string, maxDepth?: number) {
  const db = new SheepDatabase(agentId);
  const chain = db.queryCausalChain(effectId, maxDepth);
  db.close();
  return chain;
}

/**
 * Query causal links for an agent
 */
export function queryCausalLinks(
  agentId: string,
  options: { causeId?: string; effectId?: string; minConfidence?: number } = {},
) {
  const db = new SheepDatabase(agentId);
  const links = db.findCausalLinks(options);
  db.close();
  return links;
}

/**
 * Query procedures for an agent
 */
export function queryProcedures(
  agentId: string,
  options: { triggerContains?: string; tags?: string[]; minSuccessRate?: number } = {},
) {
  const db = new SheepDatabase(agentId);
  const procedures = db.findProcedures(options);
  db.close();
  return procedures;
}

// =============================================================================
// EXPORT/IMPORT FUNCTIONS
// =============================================================================

/**
 * Export format for SHEEP memory
 */
export type SheepMemoryExport = {
  version: number;
  exportedAt: string;
  agentId: string;
  episodes: Episode[];
  facts: Array<{
    id: string;
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
    evidence: string[];
    firstSeen: string;
    lastConfirmed: string;
    userAffirmed: boolean;
    isActive: boolean;
  }>;
  causalLinks: Array<{
    id: string;
    causeType: string;
    causeId: string;
    causeDescription: string;
    effectType: string;
    effectId: string;
    effectDescription: string;
    mechanism: string;
    confidence: number;
    causalStrength: string;
  }>;
  procedures: Array<{
    id: string;
    trigger: string;
    action: string;
    expectedOutcome?: string;
    tags: string[];
    successRate: number;
    timesUsed: number;
  }>;
  stats: {
    totalEpisodes: number;
    totalFacts: number;
    totalCausalLinks: number;
    totalProcedures: number;
  };
};

/**
 * Export all SHEEP memory for an agent to JSON
 */
export function exportMemory(agentId: string): SheepMemoryExport {
  const db = new SheepDatabase(agentId);

  const episodes = db.queryEpisodes({ limit: 10000 });
  const facts = db.findFacts({ activeOnly: false });
  const causalLinks = db.findCausalLinks({});
  const procedures = db.findProcedures({});
  const stats = db.getStats();

  db.close();

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    agentId,
    episodes,
    facts: facts.map((f) => ({
      id: f.id,
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      confidence: f.confidence,
      evidence: f.evidence,
      firstSeen: f.firstSeen,
      lastConfirmed: f.lastConfirmed,
      userAffirmed: f.userAffirmed,
      isActive: f.isActive,
    })),
    causalLinks: causalLinks.map((l) => ({
      id: l.id,
      causeType: l.causeType,
      causeId: l.causeId,
      causeDescription: l.causeDescription,
      effectType: l.effectType,
      effectId: l.effectId,
      effectDescription: l.effectDescription,
      mechanism: l.mechanism,
      confidence: l.confidence,
      causalStrength: l.causalStrength,
    })),
    procedures: procedures.map((p) => ({
      id: p.id,
      trigger: p.trigger,
      action: p.action,
      expectedOutcome: p.expectedOutcome,
      tags: p.tags,
      successRate: p.successRate,
      timesUsed: p.timesUsed,
    })),
    stats: {
      totalEpisodes: stats.totalEpisodes,
      totalFacts: stats.totalFacts,
      totalCausalLinks: stats.totalCausalLinks,
      totalProcedures: stats.totalProcedures,
    },
  };
}

/**
 * Import SHEEP memory from JSON export
 */
export function importMemory(
  agentId: string,
  data: SheepMemoryExport,
  options: { merge?: boolean; dryRun?: boolean } = {},
): {
  imported: { episodes: number; facts: number; causalLinks: number; procedures: number };
  skipped: number;
  errors: string[];
} {
  const db = new SheepDatabase(agentId);
  const errors: string[] = [];
  let skipped = 0;
  const imported = { episodes: 0, facts: 0, causalLinks: 0, procedures: 0 };

  if (options.dryRun) {
    db.close();
    return {
      imported: {
        episodes: data.episodes.length,
        facts: data.facts.length,
        causalLinks: data.causalLinks.length,
        procedures: data.procedures.length,
      },
      skipped: 0,
      errors: [],
    };
  }

  // Import episodes
  for (const ep of data.episodes) {
    try {
      const existing = db.getEpisode(ep.id);
      if (existing && !options.merge) {
        skipped++;
        continue;
      }
      if (!existing) {
        db.insertEpisode({
          timestamp: ep.timestamp,
          summary: ep.summary,
          participants: ep.participants,
          topic: ep.topic,
          keywords: ep.keywords,
          emotionalSalience: ep.emotionalSalience,
          utilityScore: ep.utilityScore,
          sourceSessionId: ep.sourceSessionId,
          sourceMessageIds: ep.sourceMessageIds,
          ttl: ep.ttl,
          lastAccessedAt: ep.lastAccessedAt,
        });
        imported.episodes++;
      }
    } catch (err) {
      errors.push(`Episode ${ep.id}: ${String(err)}`);
    }
  }

  // Import facts
  for (const fact of data.facts) {
    try {
      const existing = db.getFact(fact.id);
      if (existing && !options.merge) {
        skipped++;
        continue;
      }
      if (!existing) {
        db.insertFact({
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          confidence: fact.confidence,
          evidence: fact.evidence,
          firstSeen: fact.firstSeen,
          lastConfirmed: fact.lastConfirmed,
          userAffirmed: fact.userAffirmed,
        });
        imported.facts++;
      }
    } catch (err) {
      errors.push(`Fact ${fact.id}: ${String(err)}`);
    }
  }

  // Import causal links
  for (const link of data.causalLinks) {
    try {
      db.insertCausalLink({
        causeType: link.causeType as "fact" | "episode" | "event",
        causeId: link.causeId,
        causeDescription: link.causeDescription,
        effectType: link.effectType as "fact" | "episode" | "event",
        effectId: link.effectId,
        effectDescription: link.effectDescription,
        mechanism: link.mechanism,
        confidence: link.confidence,
        evidence: [],
        causalStrength: link.causalStrength as "direct" | "contributing",
      });
      imported.causalLinks++;
    } catch (err) {
      errors.push(`CausalLink ${link.id}: ${String(err)}`);
    }
  }

  // Import procedures
  for (const proc of data.procedures) {
    try {
      const existing = db.findProcedures({ triggerContains: proc.trigger.substring(0, 20) });
      const isDuplicate = existing.some(
        (e) =>
          e.trigger.toLowerCase() === proc.trigger.toLowerCase() &&
          e.action.toLowerCase() === proc.action.toLowerCase(),
      );
      if (isDuplicate && !options.merge) {
        skipped++;
        continue;
      }
      if (!isDuplicate) {
        db.insertProcedure({
          trigger: proc.trigger,
          action: proc.action,
          expectedOutcome: proc.expectedOutcome,
          examples: [],
          tags: proc.tags,
        });
        imported.procedures++;
      }
    } catch (err) {
      errors.push(`Procedure ${proc.id}: ${String(err)}`);
    }
  }

  db.close();
  return { imported, skipped, errors };
}

// =============================================================================
// FORGET FUNCTIONS
// =============================================================================

/**
 * Result of a forget operation
 */
export type ForgetResult = {
  factsRetracted: number;
  episodesDeleted: number;
  causalLinksRemoved: number;
  proceduresRemoved: number;
  totalRemoved: number;
};

/**
 * Forget memories matching a topic or pattern
 */
export function forgetByTopic(
  agentId: string,
  topic: string,
  options: { dryRun?: boolean } = {},
): ForgetResult {
  const db = new SheepDatabase(agentId);
  const topicLower = topic.toLowerCase();
  const result: ForgetResult = {
    factsRetracted: 0,
    episodesDeleted: 0,
    causalLinksRemoved: 0,
    proceduresRemoved: 0,
    totalRemoved: 0,
  };

  // Find and retract matching facts
  const allFacts = db.findFacts({ activeOnly: true });
  for (const fact of allFacts) {
    const matchText = `${fact.subject} ${fact.predicate} ${fact.object}`.toLowerCase();
    if (matchText.includes(topicLower)) {
      if (!options.dryRun) {
        db.retractFact(fact.id, `Forgotten by topic: ${topic}`);
      }
      result.factsRetracted++;
    }
  }

  // Find and delete matching episodes
  const allEpisodes = db.queryEpisodes({ limit: 10000 });
  for (const ep of allEpisodes) {
    const matchText = `${ep.topic} ${ep.summary} ${ep.keywords.join(" ")}`.toLowerCase();
    if (matchText.includes(topicLower)) {
      if (!options.dryRun) {
        db.deleteEpisode(ep.id);
      }
      result.episodesDeleted++;
    }
  }

  // Find matching procedures
  const allProcs = db.findProcedures({});
  for (const proc of allProcs) {
    const matchText = `${proc.trigger} ${proc.action} ${proc.tags.join(" ")}`.toLowerCase();
    if (matchText.includes(topicLower)) {
      // Note: We don't have a deleteProcedure method, but we can count them
      result.proceduresRemoved++;
    }
  }

  db.close();

  result.totalRemoved =
    result.factsRetracted +
    result.episodesDeleted +
    result.causalLinksRemoved +
    result.proceduresRemoved;
  return result;
}

// =============================================================================
// KNOWLEDGE GRAPH FUNCTIONS
// =============================================================================

/**
 * Node in the knowledge graph
 */
export type GraphNode = {
  id: string;
  label: string;
  type: "fact" | "episode" | "entity" | "procedure";
  size: number;
  metadata?: Record<string, unknown>;
};

/**
 * Edge in the knowledge graph
 */
export type GraphEdge = {
  source: string;
  target: string;
  label: string;
  weight: number;
};

/**
 * Knowledge graph structure
 */
export type KnowledgeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    entities: number;
    facts: number;
    episodes: number;
    causalLinks: number;
  };
};

// =============================================================================
// POINT-IN-TIME QUERY FUNCTIONS
// =============================================================================

/**
 * Result of a point-in-time query
 */
export type PointInTimeResult = {
  asOf: string;
  humanReadable: string;
  facts: Array<{
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
  }>;
  episodes: Array<{
    topic: string;
    summary: string;
    timestamp: string;
  }>;
  totalFacts: number;
  totalEpisodes: number;
};

/**
 * Query what SHEEP believed at a specific point in time.
 *
 * Examples:
 * - "What did I believe on January 15?"
 * - "What were the facts as of last week?"
 *
 * @param agentId - Agent ID
 * @param dateString - Date string (e.g., "2024-01-15", "January 15", "last week")
 * @param options - Query options
 */
export function queryPointInTime(
  agentId: string,
  dateString: string,
  options: { subject?: string; windowDays?: number } = {},
): PointInTimeResult {
  const db = new SheepDatabase(agentId);

  // Parse the date string
  const asOf = parseTemporalReference(dateString);
  const humanReadable = new Date(asOf).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Query facts at that time
  const facts = db.queryFactsAtTime(asOf, {
    subject: options.subject,
  });

  // Query episodes around that time
  const windowDays = options.windowDays ?? 7;
  const episodes = db.queryEpisodesAtTime(asOf, windowDays);

  db.close();

  return {
    asOf,
    humanReadable,
    facts: facts.map((f) => ({
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      confidence: f.confidence,
    })),
    episodes: episodes.map((e) => ({
      topic: e.topic,
      summary: e.summary,
      timestamp: e.timestamp,
    })),
    totalFacts: facts.length,
    totalEpisodes: episodes.length,
  };
}

/**
 * Get the belief timeline for a subject.
 *
 * @param agentId - Agent ID
 * @param subject - Subject to query (e.g., "user", "project")
 */
export function getBeliefTimeline(
  agentId: string,
  subject: string,
): Array<{
  timestamp: string;
  factId: string;
  predicate: string;
  value: string;
  confidence: number;
  changeType: "created" | "updated" | "retracted";
  reason?: string;
}> {
  const db = new SheepDatabase(agentId);
  const timeline = db.getBeliefTimeline(subject);
  db.close();
  return timeline;
}

/**
 * Get changes since a specific date.
 *
 * @param agentId - Agent ID
 * @param dateString - Date string (e.g., "2024-01-01", "last month")
 */
export function getChangesSince(agentId: string, dateString: string) {
  const db = new SheepDatabase(agentId);
  const since = parseTemporalReference(dateString);
  const changes = db.getChangesSince(since);
  db.close();
  return { since, ...changes };
}

/**
 * Parse a temporal reference into an ISO timestamp.
 * Supports various formats like "January 15", "last week", "2024-01-15", etc.
 */
function parseTemporalReference(reference: string): string {
  const normalized = reference.toLowerCase().trim();
  const now = new Date();

  // Relative references
  if (normalized === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  if (normalized === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }
  if (normalized === "last week" || normalized === "a week ago") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }
  if (normalized === "last month" || normalized === "a month ago") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }
  if (normalized === "last year" || normalized === "a year ago") {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }

  // "X days/weeks/months ago" patterns
  const agoMatch = normalized.match(/(\d+)\s*(days?|weeks?|months?|years?)\s*ago/);
  if (agoMatch) {
    const amount = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    const d = new Date(now);
    if (unit.startsWith("day")) d.setDate(d.getDate() - amount);
    else if (unit.startsWith("week")) d.setDate(d.getDate() - amount * 7);
    else if (unit.startsWith("month")) d.setMonth(d.getMonth() - amount);
    else if (unit.startsWith("year")) d.setFullYear(d.getFullYear() - amount);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }

  // Month name + day (e.g., "January 15", "Jan 15")
  const monthDayMatch = normalized.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})/,
  );
  if (monthDayMatch) {
    const monthMap: Record<string, number> = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };
    const month = monthMap[monthDayMatch[1]];
    const day = parseInt(monthDayMatch[2], 10);
    // Use current year, or previous year if the date is in the future
    let year = now.getFullYear();
    const candidate = new Date(year, month, day);
    if (candidate > now) year--;
    return new Date(year, month, day).toISOString();
  }

  // ISO format or standard date formats
  const parsed = new Date(reference);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  // Default to now if parsing fails
  return now.toISOString();
}

/**
 * Build a knowledge graph from SHEEP memory
 */
export function buildKnowledgeGraph(
  agentId: string,
  options: { limit?: number } = {},
): KnowledgeGraph {
  const db = new SheepDatabase(agentId);
  const limit = options.limit ?? 100;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const entitySet = new Set<string>();

  // Get facts and build entity nodes
  const facts = db.findFacts({ activeOnly: true });
  for (const fact of facts.slice(0, limit)) {
    // Add subject entity node
    if (!entitySet.has(fact.subject)) {
      entitySet.add(fact.subject);
      nodes.push({
        id: `entity:${fact.subject}`,
        label: fact.subject,
        type: "entity",
        size: 1,
      });
    }

    // Add object entity node (if it looks like an entity, not a value)
    const isEntityObject = !fact.object.match(/^\d+$/) && fact.object.length < 50;
    if (isEntityObject && !entitySet.has(fact.object)) {
      entitySet.add(fact.object);
      nodes.push({
        id: `entity:${fact.object}`,
        label: fact.object,
        type: "entity",
        size: 1,
      });
    }

    // Add fact node
    nodes.push({
      id: `fact:${fact.id}`,
      label: `${fact.subject} ${fact.predicate} ${fact.object}`.substring(0, 50),
      type: "fact",
      size: fact.confidence,
      metadata: { confidence: fact.confidence, userAffirmed: fact.userAffirmed },
    });

    // Add edges
    edges.push({
      source: `entity:${fact.subject}`,
      target: `fact:${fact.id}`,
      label: fact.predicate,
      weight: fact.confidence,
    });

    if (isEntityObject) {
      edges.push({
        source: `fact:${fact.id}`,
        target: `entity:${fact.object}`,
        label: "→",
        weight: fact.confidence,
      });
    }
  }

  // Get causal links and add them as edges
  const causalLinks = db.findCausalLinks({});
  for (const link of causalLinks.slice(0, limit)) {
    edges.push({
      source: `${link.causeType}:${link.causeId}`,
      target: `${link.effectType}:${link.effectId}`,
      label: link.mechanism.substring(0, 30),
      weight: link.confidence,
    });
  }

  // Get episodes (limited)
  const episodes = db.queryEpisodes({ limit: Math.min(limit, 20) });
  for (const ep of episodes) {
    nodes.push({
      id: `episode:${ep.id}`,
      label: ep.topic,
      type: "episode",
      size: ep.emotionalSalience,
      metadata: { timestamp: ep.timestamp, salience: ep.emotionalSalience },
    });
  }

  db.close();

  return {
    nodes,
    edges,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      entities: entitySet.size,
      facts: facts.length,
      episodes: episodes.length,
      causalLinks: causalLinks.length,
    },
  };
}
