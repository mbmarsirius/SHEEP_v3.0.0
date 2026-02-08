/**
 * Stub: Logging subsystem (replaces OpenClaw's logging/subsystem.js)
 */
export type SubsystemLogger = {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  debug: (msg: string, data?: Record<string, unknown>) => void;
};

export function createSubsystemLogger(name: string): SubsystemLogger {
  const prefix = `[${name}]`;
  return {
    info: (msg, data) => console.log(prefix, msg, data ?? ""),
    warn: (msg, data) => console.warn(prefix, msg, data ?? ""),
    error: (msg, data) => console.error(prefix, msg, data ?? ""),
    debug: (msg, data) => {
      if (process.env.SHEEP_DEBUG) console.log(prefix, "[debug]", msg, data ?? "");
    },
  };
}
