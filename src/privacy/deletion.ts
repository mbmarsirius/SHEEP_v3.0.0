/**
 * SHEEP AI - Data Deletion (GDPR Right to Erasure)
 * GDPR Article 17: Right to erasure ("right to be forgotten")
 *
 * Users can delete all their data, specific topics, or data before a date.
 * All deletions are logged in the audit trail.
 */

import { createSubsystemLogger } from "../stubs/logging.js";

const log = createSubsystemLogger("privacy");

export type DeletionResult = {
  factsDeleted: number;
  episodesDeleted: number;
  causalLinksDeleted: number;
  proceduresDeleted: number;
  foresightsDeleted: number;
  profilesDeleted: number;
  totalDeleted: number;
  timestamp: string;
  reason: string;
};

/**
 * Delete ALL user data. GDPR Article 17 - complete erasure.
 */
export function deleteAllUserData(db: any, userId: string, reason: string = "user_request"): DeletionResult {
  const timestamp = new Date().toISOString();
  let totalDeleted = 0;

  // Delete facts
  const factsDeleted = execCount(db, "DELETE FROM sheep_facts WHERE 1=1");
  totalDeleted += factsDeleted;

  // Delete episodes
  const episodesDeleted = execCount(db, "DELETE FROM sheep_episodes WHERE 1=1");
  totalDeleted += episodesDeleted;

  // Delete causal links
  const causalLinksDeleted = execCount(db, "DELETE FROM sheep_causal_links WHERE 1=1");
  totalDeleted += causalLinksDeleted;

  // Delete procedures
  const proceduresDeleted = execCount(db, "DELETE FROM sheep_procedures WHERE 1=1");
  totalDeleted += proceduresDeleted;

  // Delete foresights
  let foresightsDeleted = 0;
  try {
    foresightsDeleted = execCount(db, "DELETE FROM sheep_foresights WHERE 1=1");
    totalDeleted += foresightsDeleted;
  } catch { /* table might not exist */ }

  // Delete user profiles
  let profilesDeleted = 0;
  try {
    profilesDeleted = execCount(db, "DELETE FROM sheep_user_profiles WHERE 1=1");
    totalDeleted += profilesDeleted;
  } catch { /* table might not exist */ }

  // Delete memory changes log
  try { db.db.exec("DELETE FROM sheep_memory_changes WHERE 1=1"); } catch { /* */ }

  // Delete consent record
  try { db.db.exec(`DELETE FROM sheep_consent WHERE user_id = '${userId}'`); } catch { /* */ }

  // Log deletion in audit trail
  logDeletion(db, {
    action: "delete_all",
    userId,
    reason,
    itemsDeleted: totalDeleted,
    timestamp,
  });

  const result: DeletionResult = {
    factsDeleted,
    episodesDeleted,
    causalLinksDeleted,
    proceduresDeleted,
    foresightsDeleted,
    profilesDeleted,
    totalDeleted,
    timestamp,
    reason,
  };

  log.info("All user data deleted (GDPR Art. 17)", { userId, totalDeleted });
  return result;
}

/**
 * Delete data related to a specific topic.
 */
export function deleteByTopic(db: any, topic: string, reason: string = "user_request"): DeletionResult {
  const timestamp = new Date().toISOString();
  const topicLower = topic.toLowerCase();
  let factsDeleted = 0;
  let episodesDeleted = 0;

  // Delete matching facts
  const facts = db.findFacts({ activeOnly: false });
  for (const fact of facts) {
    const text = `${fact.subject} ${fact.predicate} ${fact.object}`.toLowerCase();
    if (text.includes(topicLower)) {
      try {
        db.db.prepare("DELETE FROM sheep_facts WHERE id = ?").run(fact.id);
        factsDeleted++;
      } catch { /* */ }
    }
  }

  // Delete matching episodes
  const episodes = db.queryEpisodes({ limit: 10000 });
  for (const ep of episodes) {
    const text = `${ep.summary} ${ep.topic}`.toLowerCase();
    if (text.includes(topicLower)) {
      try {
        db.db.prepare("DELETE FROM sheep_episodes WHERE id = ?").run(ep.id);
        episodesDeleted++;
      } catch { /* */ }
    }
  }

  const totalDeleted = factsDeleted + episodesDeleted;

  logDeletion(db, {
    action: "delete_by_topic",
    topic,
    reason,
    itemsDeleted: totalDeleted,
    timestamp,
  });

  log.info("Topic data deleted", { topic, factsDeleted, episodesDeleted });
  return {
    factsDeleted,
    episodesDeleted,
    causalLinksDeleted: 0,
    proceduresDeleted: 0,
    foresightsDeleted: 0,
    profilesDeleted: 0,
    totalDeleted,
    timestamp,
    reason,
  };
}

/**
 * Delete data before a specific date.
 */
export function deleteBeforeDate(db: any, beforeDate: string, reason: string = "user_request"): DeletionResult {
  const timestamp = new Date().toISOString();

  const factsDeleted = execCount(db, `DELETE FROM sheep_facts WHERE created_at < '${beforeDate}'`);
  const episodesDeleted = execCount(db, `DELETE FROM sheep_episodes WHERE timestamp < '${beforeDate}'`);
  const causalLinksDeleted = execCount(db, `DELETE FROM sheep_causal_links WHERE created_at < '${beforeDate}'`);
  const proceduresDeleted = execCount(db, `DELETE FROM sheep_procedures WHERE created_at < '${beforeDate}'`);

  const totalDeleted = factsDeleted + episodesDeleted + causalLinksDeleted + proceduresDeleted;

  logDeletion(db, {
    action: "delete_before_date",
    beforeDate,
    reason,
    itemsDeleted: totalDeleted,
    timestamp,
  });

  log.info("Data before date deleted", { beforeDate, totalDeleted });
  return {
    factsDeleted,
    episodesDeleted,
    causalLinksDeleted,
    proceduresDeleted,
    foresightsDeleted: 0,
    profilesDeleted: 0,
    totalDeleted,
    timestamp,
    reason,
  };
}

// Helpers

function execCount(db: any, sql: string): number {
  try {
    const result = db.db.prepare(sql).run();
    return result.changes ?? 0;
  } catch {
    return 0;
  }
}

function logDeletion(db: any, entry: Record<string, unknown>): void {
  try {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS sheep_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);
    db.db.prepare(
      "INSERT INTO sheep_audit_log (action, details, timestamp) VALUES (?, ?, ?)",
    ).run(entry.action, JSON.stringify(entry), entry.timestamp as string);
  } catch {
    // Audit logging should never crash the main flow
    log.warn("Failed to write audit log", { entry });
  }
}
