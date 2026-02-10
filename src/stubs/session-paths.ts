/**
 * Stub: Session paths (replaces config/sessions/paths.js)
 */
import { join } from "node:path";

export function resolveSessionDir(agentId: string): string {
  return join(process.env.HOME ?? "", ".openclaw", "agents", agentId, "sessions");
}

export function resolveSessionFilePath(sessionId: string, agentId: string): string {
  return join(resolveSessionDir(agentId), `${sessionId}.jsonl`);
}

/** Alias: session transcripts are stored in the sessions directory as JSONL files */
export function resolveSessionTranscriptsDirForAgent(agentId: string): string {
  return resolveSessionDir(agentId);
}
