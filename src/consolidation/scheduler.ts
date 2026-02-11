/**
 * SHEEP AI - Consolidation Scheduler
 *
 * The "sleep" scheduler - runs consolidation cycles automatically.
 * Supports three trigger modes:
 * 1. Idle detection: When no activity for 2+ hours
 * 2. Cron scheduling: At configurable times (default 3 AM)
 * 3. Manual trigger: Via CLI or API
 *
 * @module sheep/consolidation/scheduler
 */

import type { OpenClawConfig } from "../stubs/config.js";
import { createSubsystemLogger } from "../stubs/logging.js";
// Standalone: no Moltbot dependency. Returns all configured agents.
function getIdleAgents(_idleThresholdMs: number): string[] {
  const agentId = process.env.SHEEP_AGENT_ID ?? process.env.AGENT_ID ?? "default";
  return [agentId];
}
import { runConsolidation, type ConsolidationResult } from "./consolidator.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/**
 * Scheduler configuration
 */
export type SchedulerConfig = {
  /** Enable idle-based consolidation (default: true) */
  enableIdleConsolidation?: boolean;
  /** Idle threshold in milliseconds (default: 2 hours) */
  idleThresholdMs?: number;
  /** Enable cron-based consolidation (default: true) */
  enableCronConsolidation?: boolean;
  /** Cron hour to run consolidation (0-23, default: 3 = 3 AM) */
  cronHour?: number;
  /** Cron minute to run consolidation (0-59, default: 0) */
  cronMinute?: number;
  /** Minimum time between consolidation runs in ms (default: 1 hour) */
  minConsolidationIntervalMs?: number;
  /** Moltbot config for LLM access */
  config?: OpenClawConfig;
};

/**
 * Internal scheduler configuration (with defaults applied)
 */
type ResolvedSchedulerConfig = Required<Omit<SchedulerConfig, "config">> & {
  config?: OpenClawConfig;
};

/**
 * Scheduler state
 */
type SchedulerState = {
  isRunning: boolean;
  idleCheckInterval: ReturnType<typeof setInterval> | null;
  cronCheckInterval: ReturnType<typeof setInterval> | null;
  lastConsolidationTime: Map<string, number>;
  activeConsolidations: Set<string>;
  config: ResolvedSchedulerConfig;
};

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: Required<Omit<SchedulerConfig, "config">> = {
  enableIdleConsolidation: true,
  idleThresholdMs: 2 * 60 * 60 * 1000, // 2 hours
  enableCronConsolidation: true,
  cronHour: 3, // 3 AM
  cronMinute: 0,
  minConsolidationIntervalMs: 60 * 60 * 1000, // 1 hour
};

// =============================================================================
// SCHEDULER SINGLETON
// =============================================================================

let schedulerState: SchedulerState | null = null;

/**
 * Start the consolidation scheduler
 */
export function startScheduler(config: SchedulerConfig = {}): void {
  if (schedulerState?.isRunning) {
    log.warn("SHEEP scheduler already running");
    return;
  }

  const fullConfig: ResolvedSchedulerConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  schedulerState = {
    isRunning: true,
    idleCheckInterval: null,
    cronCheckInterval: null,
    lastConsolidationTime: new Map(),
    activeConsolidations: new Set(),
    config: fullConfig,
  };

  log.info("Starting SHEEP consolidation scheduler", {
    idleEnabled: fullConfig.enableIdleConsolidation,
    idleThresholdMs: fullConfig.idleThresholdMs,
    cronEnabled: fullConfig.enableCronConsolidation,
    cronTime: `${fullConfig.cronHour}:${String(fullConfig.cronMinute).padStart(2, "0")}`,
  });

  // Start idle detection (check every 10 minutes)
  if (fullConfig.enableIdleConsolidation) {
    schedulerState.idleCheckInterval = setInterval(
      () => checkIdleAndConsolidate(fullConfig),
      10 * 60 * 1000, // 10 minutes
    );
  }

  // Start cron check (check every minute)
  if (fullConfig.enableCronConsolidation) {
    schedulerState.cronCheckInterval = setInterval(
      () => checkCronAndConsolidate(fullConfig),
      60 * 1000, // 1 minute
    );
  }
}

/**
 * Stop the consolidation scheduler
 */
export function stopScheduler(): void {
  if (!schedulerState) {
    return;
  }

  if (schedulerState.idleCheckInterval) {
    clearInterval(schedulerState.idleCheckInterval);
  }
  if (schedulerState.cronCheckInterval) {
    clearInterval(schedulerState.cronCheckInterval);
  }

  log.info("Stopped SHEEP consolidation scheduler");
  schedulerState = null;
}

/**
 * Check if the scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerState?.isRunning ?? false;
}

// =============================================================================
// IDLE DETECTION
// =============================================================================

/**
 * Check for idle agents and run consolidation
 */
async function checkIdleAndConsolidate(config: ResolvedSchedulerConfig): Promise<void> {
  if (!schedulerState) return;

  const idleAgents = getIdleAgents(config.idleThresholdMs);

  for (const agentId of idleAgents) {
    // Check if already running for this agent
    if (schedulerState.activeConsolidations.has(agentId)) {
      continue;
    }

    // Check minimum interval
    const lastRun = schedulerState.lastConsolidationTime.get(agentId) ?? 0;
    if (Date.now() - lastRun < config.minConsolidationIntervalMs) {
      continue;
    }

    log.info("SHEEP idle consolidation triggered", { agentId });
    await runConsolidationForAgent(agentId, "idle", config);
  }
}

// =============================================================================
// CRON SCHEDULING
// =============================================================================

/**
 * Track if we've run cron today to avoid duplicate runs
 */
const cronRunDates = new Map<string, string>();

/**
 * Check if it's time to run cron consolidation
 */
async function checkCronAndConsolidate(config: ResolvedSchedulerConfig): Promise<void> {
  if (!schedulerState) return;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const today = now.toISOString().split("T")[0];

  // Check if it's the right time (within the minute window)
  if (currentHour !== config.cronHour || currentMinute !== config.cronMinute) {
    return;
  }

  // Get all known agents (from the integration cache)
  const idleAgents = getIdleAgents(0); // Get all agents, regardless of idle status

  for (const agentId of idleAgents) {
    // Check if we've already run cron for this agent today
    if (cronRunDates.get(agentId) === today) {
      continue;
    }

    // Check if already running for this agent
    if (schedulerState.activeConsolidations.has(agentId)) {
      continue;
    }

    log.info("SHEEP cron consolidation triggered", {
      agentId,
      time: `${currentHour}:${currentMinute}`,
    });
    cronRunDates.set(agentId, today);
    await runConsolidationForAgent(agentId, "cron", config);
  }

  // Cleanup old cron dates (keep only today)
  for (const [key, date] of cronRunDates.entries()) {
    if (date !== today) {
      cronRunDates.delete(key);
    }
  }
}

// =============================================================================
// CONSOLIDATION EXECUTION
// =============================================================================

/**
 * Run consolidation for a specific agent
 */
async function runConsolidationForAgent(
  agentId: string,
  trigger: "idle" | "cron" | "manual",
  _config: ResolvedSchedulerConfig,
): Promise<ConsolidationResult | null> {
  if (!schedulerState) return null;

  // Mark as running
  schedulerState.activeConsolidations.add(agentId);
  schedulerState.lastConsolidationTime.set(agentId, Date.now());

  try {
    const result = await runConsolidation({
      agentId,
      enableLLMSleep: true, // AUTONOMOUS MODE: Enable real LLM sleep consolidation
      onProgress: (stage, current, total) => {
        log.info(`SHEEP consolidation progress: ${stage}`, { agentId, current, total });
      },
    });

    log.info("SHEEP consolidation completed", {
      agentId,
      trigger,
      success: result.success,
      episodes: result.episodesExtracted,
      facts: result.factsExtracted,
      procedures: result.proceduresExtracted,
      durationMs: result.durationMs,
    });

    return result;
  } catch (err) {
    log.error("SHEEP consolidation failed", { agentId, trigger, error: String(err) });
    return null;
  } finally {
    schedulerState?.activeConsolidations.delete(agentId);
  }
}

// =============================================================================
// MANUAL TRIGGER
// =============================================================================

/**
 * Manually trigger consolidation for an agent
 */
export async function triggerConsolidation(
  agentId: string,
  options: { force?: boolean } = {},
): Promise<ConsolidationResult | null> {
  // Initialize scheduler state if not already running
  if (!schedulerState) {
    schedulerState = {
      isRunning: false,
      idleCheckInterval: null,
      cronCheckInterval: null,
      lastConsolidationTime: new Map(),
      activeConsolidations: new Set(),
      config: { ...DEFAULT_CONFIG },
    };
  }

  // Check if already running
  if (schedulerState.activeConsolidations.has(agentId)) {
    log.warn("SHEEP consolidation already running for agent", { agentId });
    return null;
  }

  // Check minimum interval (unless forced)
  if (!options.force) {
    const lastRun = schedulerState.lastConsolidationTime.get(agentId) ?? 0;
    if (Date.now() - lastRun < DEFAULT_CONFIG.minConsolidationIntervalMs) {
      log.warn("SHEEP consolidation rate limited", { agentId, lastRunAgoMs: Date.now() - lastRun });
      return null;
    }
  }

  log.info("SHEEP manual consolidation triggered", { agentId });
  return runConsolidationForAgent(agentId, "manual", schedulerState.config);
}

// =============================================================================
// SCHEDULER STATUS
// =============================================================================

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  isRunning: boolean;
  idleEnabled: boolean;
  cronEnabled: boolean;
  cronTime: string;
  activeConsolidations: string[];
  lastConsolidationTimes: Record<string, number>;
} {
  if (!schedulerState) {
    return {
      isRunning: false,
      idleEnabled: false,
      cronEnabled: false,
      cronTime: `${DEFAULT_CONFIG.cronHour}:00`,
      activeConsolidations: [],
      lastConsolidationTimes: {},
    };
  }

  return {
    isRunning: schedulerState.isRunning,
    idleEnabled: schedulerState.config.enableIdleConsolidation,
    cronEnabled: schedulerState.config.enableCronConsolidation,
    cronTime: `${schedulerState.config.cronHour}:${String(schedulerState.config.cronMinute).padStart(2, "0")}`,
    activeConsolidations: [...schedulerState.activeConsolidations],
    lastConsolidationTimes: Object.fromEntries(schedulerState.lastConsolidationTime),
  };
}

// =============================================================================
// CONFIG-BASED INITIALIZATION
// =============================================================================

/**
 * Parse simple cron expression for hour and minute.
 * Supports: "0 3 * * *" (minute hour * * *) format
 */
function parseCronSchedule(cronExpr: string): { hour: number; minute: number } {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    log.warn("Invalid cron expression, using default", { cronExpr });
    return { hour: 3, minute: 0 };
  }

  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);

  if (isNaN(minute) || isNaN(hour)) {
    log.warn("Invalid cron expression (non-numeric), using default", { cronExpr });
    return { hour: 3, minute: 0 };
  }

  return { hour: hour % 24, minute: minute % 60 };
}

/**
 * Initialize auto-consolidation based on OpenClawConfig.
 * This reads the sheep config settings and starts the appropriate scheduler mode.
 *
 * @param agentId - The agent ID to configure consolidation for
 * @param config - The OpenClawConfig containing sheep settings
 */
export function initializeAutoConsolidation(agentId: string, config: OpenClawConfig): void {
  const sheepConfig = config.sheep;

  // If SHEEP is not enabled, don't start any scheduler
  if (!sheepConfig?.enabled) {
    log.info("SHEEP disabled, skipping auto-consolidation setup", { agentId });
    return;
  }

  // Default to "idle" mode when SHEEP is enabled (not "disabled")
  // This ensures auto-consolidation works out of the box
  const mode = sheepConfig.autoConsolidate ?? "idle";

  switch (mode) {
    case "idle": {
      const idleThresholdMs = (sheepConfig.idleThresholdMinutes ?? 120) * 60 * 1000;
      log.info("Starting SHEEP idle-based consolidation", { agentId, idleThresholdMs });
      startScheduler({
        enableIdleConsolidation: true,
        enableCronConsolidation: false,
        idleThresholdMs,
        config,
      });
      break;
    }

    case "scheduled": {
      const schedule = sheepConfig.consolidateSchedule ?? "0 3 * * *";
      const { hour, minute } = parseCronSchedule(schedule);
      log.info("Starting SHEEP scheduled consolidation", { agentId, hour, minute, schedule });
      startScheduler({
        enableIdleConsolidation: false,
        enableCronConsolidation: true,
        cronHour: hour,
        cronMinute: minute,
        config,
      });
      break;
    }

    case "disabled":
    default:
      log.info("SHEEP auto-consolidation disabled", { agentId });
      break;
  }
}

/**
 * Shutdown all auto-consolidation
 */
export function shutdownAutoConsolidation(): void {
  stopScheduler();
}
