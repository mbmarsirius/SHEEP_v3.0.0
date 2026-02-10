/**
 * SHEEP AI - Data Export (GDPR Data Portability)
 * GDPR Article 20: Right to data portability
 *
 * Users can export ALL their data in a machine-readable format.
 */

import { createSubsystemLogger } from "../stubs/logging.js";

const log = createSubsystemLogger("privacy");

export type ExportFormat = "json" | "csv";

export type ExportResult = {
  format: ExportFormat;
  data: string;
  metadata: {
    exportedAt: string;
    factCount: number;
    episodeCount: number;
    causalLinkCount: number;
    procedureCount: number;
    foresightCount: number;
    version: string;
  };
};

/**
 * Export all user data in the requested format.
 * GDPR Article 20: "in a structured, commonly used and machine-readable format"
 */
export function exportAllData(db: any, userId: string, format: ExportFormat = "json"): ExportResult {
  const exportedAt = new Date().toISOString();

  // Gather all data
  const facts = db.findFacts({ activeOnly: false });
  const episodes = db.queryEpisodes({ limit: 100000 });
  const causalLinks = db.findCausalLinks({});
  const procedures = db.getAllProcedures?.() ?? [];

  let foresights: any[] = [];
  try { foresights = db.getActiveForesights?.("user") ?? []; } catch { /* */ }

  const metadata = {
    exportedAt,
    factCount: facts.length,
    episodeCount: episodes.length,
    causalLinkCount: causalLinks.length,
    procedureCount: procedures.length,
    foresightCount: foresights.length,
    version: "3.0.0",
  };

  if (format === "json") {
    const exportData = {
      metadata,
      facts: facts.map((f: any) => ({
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        confidence: f.confidence,
        evidence: f.evidence,
        timestamp: f.timestamp,
        isActive: f.isActive,
        createdAt: f.createdAt,
      })),
      episodes: episodes.map((e: any) => ({
        summary: e.summary,
        topic: e.topic,
        keywords: e.keywords,
        timestamp: e.timestamp,
        emotionalSalience: e.emotionalSalience,
        utilityScore: e.utilityScore,
      })),
      causalLinks: causalLinks.map((l: any) => ({
        cause: l.causeDescription,
        effect: l.effectDescription,
        mechanism: l.mechanism,
        confidence: l.confidence,
      })),
      procedures: procedures.map((p: any) => ({
        trigger: p.trigger,
        action: p.action,
        outcome: p.expectedOutcome,
        successRate: p.successRate,
      })),
      foresights: foresights.map((f: any) => ({
        description: f.description,
        evidence: f.evidence,
        startTime: f.startTime,
        endTime: f.endTime,
        confidence: f.confidence,
      })),
    };

    log.info("Data exported (GDPR Art. 20)", { userId, format, ...metadata });

    return { format, data: JSON.stringify(exportData, null, 2), metadata };
  }

  // CSV format -- flatten into rows
  const rows: string[] = ["type,subject,predicate,object,confidence,timestamp"];

  for (const f of facts) {
    rows.push(`fact,"${esc(f.subject)}","${esc(f.predicate)}","${esc(f.object)}",${f.confidence},"${f.timestamp ?? ""}"`);
  }
  for (const e of episodes) {
    rows.push(`episode,"${esc(e.topic ?? "")}","summary","${esc(e.summary)}",,"${e.timestamp}"`);
  }
  for (const l of causalLinks) {
    rows.push(`causal,"${esc(l.causeDescription)}","causes","${esc(l.effectDescription)}",${l.confidence},`);
  }

  log.info("Data exported (GDPR Art. 20)", { userId, format, ...metadata });

  return { format, data: rows.join("\n"), metadata };
}

function esc(s: string): string {
  return (s ?? "").replace(/"/g, '""').replace(/\n/g, " ");
}
