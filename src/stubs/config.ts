/**
 * SHEEP AI - Configuration Loader (Standalone)
 *
 * Loads config from environment variables and optional ~/.sheep/config.json.
 * No Moltbot/OpenClaw dependency.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type OpenClawConfig = {
  sheep?: {
    enabled?: boolean;
    extractionModel?: string;
    fastModel?: string;
    brainModel?: string;
    muscleModel?: string;
    reflexModel?: string;
    lightningModel?: string;
    autoConsolidate?: "disabled" | "idle" | "scheduled";
    consolidateSchedule?: string;
    idleThresholdMinutes?: number;
    enableSemanticSearch?: boolean;
    enableLLMSleep?: boolean;
  };
  agents?: {
    defaults?: {
      model?: { primary?: string; fallbacks?: string[] } | string;
      workspace?: string;
    };
    list?: Array<{ id: string; name?: string }>;
  };
  models?: {
    providers?: Record<string, unknown>;
  };
  telegram?: {
    botToken?: string;
  };
  [key: string]: unknown;
};

let _cachedConfig: OpenClawConfig | null = null;

/**
 * Load SHEEP configuration from environment + optional config file.
 * Config file location: ~/.sheep/config.json
 */
export function loadConfig(): OpenClawConfig {
  if (_cachedConfig) return _cachedConfig;

  let fileConfig: OpenClawConfig = {};

  // Try to load from ~/.sheep/config.json
  const configPath = path.join(os.homedir(), ".sheep", "config.json");
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(raw) as OpenClawConfig;
      console.log(`[SHEEP] Loaded config from ${configPath}`);
    }
  } catch (err) {
    console.warn(`[SHEEP] Failed to load config from ${configPath}: ${err}`);
  }

  // Build config with env var overrides
  const config: OpenClawConfig = {
    ...fileConfig,
    sheep: {
      enabled: envBool("SHEEP_ENABLED", true),
      autoConsolidate: (process.env.SHEEP_AUTO_CONSOLIDATE as "disabled" | "idle" | "scheduled") ?? fileConfig.sheep?.autoConsolidate ?? "idle",
      idleThresholdMinutes: envInt("SHEEP_IDLE_THRESHOLD_MINUTES", fileConfig.sheep?.idleThresholdMinutes ?? 120),
      enableSemanticSearch: envBool("SHEEP_SEMANTIC_SEARCH", fileConfig.sheep?.enableSemanticSearch ?? true),
      enableLLMSleep: envBool("SHEEP_LLM_SLEEP", fileConfig.sheep?.enableLLMSleep ?? true),
      brainModel: process.env.SHEEP_BRAIN_MODEL ?? fileConfig.sheep?.brainModel,
      muscleModel: process.env.SHEEP_MUSCLE_MODEL ?? fileConfig.sheep?.muscleModel,
      reflexModel: process.env.SHEEP_REFLEX_MODEL ?? fileConfig.sheep?.reflexModel,
      lightningModel: process.env.SHEEP_LIGHTNING_MODEL ?? fileConfig.sheep?.lightningModel,
      ...fileConfig.sheep,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? fileConfig.telegram?.botToken,
    },
  };

  _cachedConfig = config;
  return config;
}

/** Reset cached config (for testing) */
export function resetConfig(): void {
  _cachedConfig = null;
}

function envBool(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  return val === "true" || val === "1";
}

function envInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
