/**
 * Stub: OpenClaw config types (replaces config/types.js)
 */
export type OpenClawConfig = {
  sheep?: {
    enabled?: boolean;
    extractionModel?: string;
    fastModel?: string;
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
  [key: string]: unknown;
};

export function loadConfig(): OpenClawConfig {
  return {};
}
