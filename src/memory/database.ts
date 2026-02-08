/**
 * SHEEP AI - Cognitive Memory Database
 *
 * SQLite-based storage for SHEEP AI's hierarchical memory system.
 * Uses Node.js native sqlite module (node:sqlite) for compatibility with Moltbot.
 *
 * @module sheep/memory/database
 */

import type { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Episode,
  Fact,
  CausalLink,
  Procedure,
  MemoryChange,
  ConsolidationRun,
  MemoryStats,
  UserProfile,
  Preference,
  Relationship,
  CoreMemory,
} from "./schema.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { requireNodeSqlite } from "../../memory/sqlite.js";
import { generateId, now } from "./schema.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

const SCHEMA_VERSION = 3;

/**
 * SQL statements to create SHEEP AI tables
 */
const CREATE_TABLES_SQL = `
-- Episodes: "What happened"
CREATE TABLE IF NOT EXISTS sheep_episodes (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  summary TEXT NOT NULL,
  participants TEXT NOT NULL,
  topic TEXT NOT NULL,
  keywords TEXT NOT NULL,
  emotional_salience REAL NOT NULL,
  utility_score REAL NOT NULL,
  source_session_id TEXT NOT NULL,
  source_message_ids TEXT NOT NULL,
  ttl TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_episodes_timestamp ON sheep_episodes(timestamp);
CREATE INDEX IF NOT EXISTS idx_sheep_episodes_topic ON sheep_episodes(topic);
CREATE INDEX IF NOT EXISTS idx_sheep_episodes_source_session ON sheep_episodes(source_session_id);

-- Facts: "What I know"
CREATE TABLE IF NOT EXISTS sheep_facts (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_confirmed TEXT NOT NULL,
  contradictions TEXT NOT NULL,
  user_affirmed INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  retracted_reason TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_facts_subject ON sheep_facts(subject);
CREATE INDEX IF NOT EXISTS idx_sheep_facts_predicate ON sheep_facts(predicate);
CREATE INDEX IF NOT EXISTS idx_sheep_facts_object ON sheep_facts(object);
CREATE INDEX IF NOT EXISTS idx_sheep_facts_active ON sheep_facts(is_active);
CREATE INDEX IF NOT EXISTS idx_sheep_facts_spo ON sheep_facts(subject, predicate, object);

-- Causal Links: "Why things happen"
CREATE TABLE IF NOT EXISTS sheep_causal_links (
  id TEXT PRIMARY KEY,
  cause_type TEXT NOT NULL,
  cause_id TEXT NOT NULL,
  cause_description TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  effect_description TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL,
  temporal_delay TEXT,
  causal_strength TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_causal_cause ON sheep_causal_links(cause_type, cause_id);
CREATE INDEX IF NOT EXISTS idx_sheep_causal_effect ON sheep_causal_links(effect_type, effect_id);

-- Procedures: "How to do things"
CREATE TABLE IF NOT EXISTS sheep_procedures (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  action TEXT NOT NULL,
  expected_outcome TEXT,
  examples TEXT NOT NULL,
  success_rate REAL NOT NULL,
  times_used INTEGER NOT NULL DEFAULT 0,
  times_succeeded INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_procedures_trigger ON sheep_procedures(trigger);

-- Memory Changes: Differential Encoding
CREATE TABLE IF NOT EXISTS sheep_memory_changes (
  id TEXT PRIMARY KEY,
  change_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  trigger_episode_id TEXT,
  consolidation_run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_changes_target ON sheep_memory_changes(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_sheep_changes_created ON sheep_memory_changes(created_at);

-- Consolidation Runs: Sleep Tracking
CREATE TABLE IF NOT EXISTS sheep_consolidation_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  processed_from TEXT NOT NULL,
  processed_to TEXT NOT NULL,
  sessions_processed INTEGER NOT NULL DEFAULT 0,
  episodes_extracted INTEGER NOT NULL DEFAULT 0,
  facts_extracted INTEGER NOT NULL DEFAULT 0,
  causal_links_extracted INTEGER NOT NULL DEFAULT 0,
  procedures_extracted INTEGER NOT NULL DEFAULT 0,
  contradictions_resolved INTEGER NOT NULL DEFAULT 0,
  memories_pruned INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_message TEXT,
  log TEXT
);

CREATE INDEX IF NOT EXISTS idx_sheep_consolidation_status ON sheep_consolidation_runs(status);
CREATE INDEX IF NOT EXISTS idx_sheep_consolidation_started ON sheep_consolidation_runs(started_at);

-- Foresight Signals: Predictive Memory
CREATE TABLE IF NOT EXISTS sheep_foresights (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  evidence TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_days INTEGER,
  confidence REAL NOT NULL,
  source_episode_id TEXT,
  user_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_foresights_active ON sheep_foresights(is_active, end_time);
CREATE INDEX IF NOT EXISTS idx_sheep_foresights_user ON sheep_foresights(user_id);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS sheep_schema_version (
  version INTEGER PRIMARY KEY
);
`;

// =============================================================================
// SHEEP DATABASE CLASS
// =============================================================================

/**
 * SheepDatabase - Manages SHEEP AI's cognitive memory storage
 */
export class SheepDatabase {
  /** Exposed for direct SQL access by retrieval/extraction modules */
  public db: DatabaseSync;
  private agentId: string;

  constructor(agentId: string, basePath?: string) {
    this.agentId = agentId;

    // Default to ~/.clawdbot/sheep/<agentId>.sqlite
    const sheepDir = basePath ?? join(process.env.HOME ?? "", ".clawdbot", "sheep");
    if (!existsSync(sheepDir)) {
      mkdirSync(sheepDir, { recursive: true });
    }

    const dbPath = join(sheepDir, `${agentId}.sqlite`);
    const sqlite = requireNodeSqlite();
    this.db = new sqlite.DatabaseSync(dbPath);

    this.initialize();
  }

  /**
   * Initialize database tables
   */
  private initialize(): void {
    // Check if schema version table exists
    const tableExists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sheep_schema_version'")
      .get() as { name: string } | undefined;

    if (!tableExists) {
      // First time setup - execute each statement separately
      const statements = CREATE_TABLES_SQL.split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        this.db.exec(stmt);
      }
      this.db.prepare("INSERT INTO sheep_schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
    } else {
      // Check for migrations
      const row = this.db.prepare("SELECT version FROM sheep_schema_version").get() as
        | { version: number }
        | undefined;
      const currentVersion = row?.version ?? 0;

      if (currentVersion < SCHEMA_VERSION) {
        this.migrate(currentVersion, SCHEMA_VERSION);
      }
    }
  }

  /**
   * Run database migrations
   */
  private migrate(from: number, to: number): void {
    log.info("Running database migrations", { from, to });

    // Migration 002: Multi-view indexing (already handled inline)
    if (from < 2 && to >= 2) {
      this.applyMigration002();
    }

    // Migration 003: New memory types
    if (from < 3 && to >= 3) {
      this.applyMigration003();
    }

    this.db.prepare("UPDATE sheep_schema_version SET version = ?").run(to);
    log.info("Database migrations completed", { to });
  }

  /**
   * Apply migration 002: Multi-view indexing
   */
  private applyMigration002(): void {
    // Add semantic embedding column
    try {
      this.db.exec("ALTER TABLE sheep_facts ADD COLUMN embedding BLOB");
    } catch (err) {
      /* Column might already exist */
    }
    // Add keyword index for BM25
    try {
      this.db.exec("ALTER TABLE sheep_facts ADD COLUMN keywords TEXT");
    } catch (err) {
      /* Column might already exist */
    }
    // Add metadata JSON for symbolic search
    try {
      this.db.exec("ALTER TABLE sheep_facts ADD COLUMN metadata TEXT DEFAULT '{}'");
    } catch (err) {
      /* Column might already exist */
    }
    // Create FTS5 virtual table for keyword search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS sheep_facts_fts USING fts5(
        subject,
        predicate,
        object,
        keywords,
        content='sheep_facts',
        content_rowid='rowid'
      )
    `);

    // Triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS sheep_facts_ai AFTER INSERT ON sheep_facts BEGIN
        INSERT INTO sheep_facts_fts(rowid, subject, predicate, object, keywords)
        VALUES (new.rowid, new.subject, new.predicate, new.object, COALESCE(new.keywords, ''));
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS sheep_facts_ad AFTER DELETE ON sheep_facts BEGIN
        INSERT INTO sheep_facts_fts(sheep_facts_fts, rowid, subject, predicate, object, keywords)
        VALUES ('delete', old.rowid, old.subject, old.predicate, old.object, COALESCE(old.keywords, ''));
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS sheep_facts_au AFTER UPDATE ON sheep_facts BEGIN
        INSERT INTO sheep_facts_fts(sheep_facts_fts, rowid, subject, predicate, object, keywords)
        VALUES ('delete', old.rowid, old.subject, old.predicate, old.object, COALESCE(old.keywords, ''));
        INSERT INTO sheep_facts_fts(rowid, subject, predicate, object, keywords)
        VALUES (new.rowid, new.subject, new.predicate, new.object, COALESCE(new.keywords, ''));
      END
    `);
  }

  /**
   * Apply migration 003: New memory types
   */
  private applyMigration003(): void {
    // Read migration SQL file
    const migrationSQL = `
-- User Profiles: Structured user information
CREATE TABLE IF NOT EXISTS sheep_user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  attributes TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_user_profiles_user_id ON sheep_user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_sheep_user_profiles_confidence ON sheep_user_profiles(confidence);

-- Preferences: User preferences by category
CREATE TABLE IF NOT EXISTS sheep_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  preference TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_preferences_user_id ON sheep_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_sheep_preferences_category ON sheep_preferences(category);
CREATE INDEX IF NOT EXISTS idx_sheep_preferences_sentiment ON sheep_preferences(sentiment);
CREATE INDEX IF NOT EXISTS idx_sheep_preferences_user_category ON sheep_preferences(user_id, category);

-- Relationships: Social connections between entities
CREATE TABLE IF NOT EXISTS sheep_relationships (
  id TEXT PRIMARY KEY,
  person1 TEXT NOT NULL,
  person2 TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  strength REAL NOT NULL,
  evidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_relationships_person1 ON sheep_relationships(person1);
CREATE INDEX IF NOT EXISTS idx_sheep_relationships_person2 ON sheep_relationships(person2);
CREATE INDEX IF NOT EXISTS idx_sheep_relationships_type ON sheep_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_sheep_relationships_persons ON sheep_relationships(person1, person2);

-- Core Memories: Highly important memories that should never be forgotten
CREATE TABLE IF NOT EXISTS sheep_core_memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  importance REAL NOT NULL,
  emotional_weight REAL NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_core_memories_importance ON sheep_core_memories(importance);
CREATE INDEX IF NOT EXISTS idx_sheep_core_memories_category ON sheep_core_memories(category);
CREATE INDEX IF NOT EXISTS idx_sheep_core_memories_importance_category ON sheep_core_memories(importance, category);
`;

    // Execute migration SQL
    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        this.db.exec(stmt);
      } catch (err) {
        // Log but don't fail - tables/indexes might already exist
        log.warn("Migration statement failed (may already exist)", {
          statement: stmt.slice(0, 50),
          error: String(err),
        });
      }
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  // ===========================================================================
  // EPISODE OPERATIONS
  // ===========================================================================

  /**
   * Insert a new episode
   */
  insertEpisode(episode: Omit<Episode, "id" | "createdAt" | "updatedAt" | "accessCount">): Episode {
    const id = generateId("ep");
    const timestamp = now();
    const full: Episode = {
      ...episode,
      id,
      accessCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db
      .prepare(
        `
      INSERT INTO sheep_episodes (
        id, timestamp, summary, participants, topic, keywords,
        emotional_salience, utility_score, source_session_id, source_message_ids,
        ttl, access_count, last_accessed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        full.id,
        full.timestamp,
        full.summary,
        JSON.stringify(full.participants),
        full.topic,
        JSON.stringify(full.keywords),
        full.emotionalSalience,
        full.utilityScore,
        full.sourceSessionId,
        JSON.stringify(full.sourceMessageIds),
        full.ttl,
        full.accessCount,
        full.lastAccessedAt ?? null,
        full.createdAt,
        full.updatedAt,
      );

    return full;
  }

  /**
   * Get episode by ID
   */
  getEpisode(id: string): Episode | null {
    const row = this.db.prepare("SELECT * FROM sheep_episodes WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToEpisode(row) : null;
  }

  /**
   * Query episodes with filters
   */
  queryEpisodes(options: {
    topic?: string;
    minSalience?: number;
    since?: string;
    limit?: number;
    orderBy?: "timestamp" | "emotional_salience" | "utility_score";
  }): Episode[] {
    let sql = "SELECT * FROM sheep_episodes WHERE 1=1";
    const params: (string | number | null)[] = [];

    if (options.topic) {
      sql += " AND topic LIKE ?";
      params.push(`%${options.topic}%`);
    }
    if (options.minSalience !== undefined) {
      sql += " AND emotional_salience >= ?";
      params.push(options.minSalience);
    }
    if (options.since) {
      sql += " AND timestamp >= ?";
      params.push(options.since);
    }

    sql += ` ORDER BY ${options.orderBy ?? "timestamp"} DESC`;

    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToEpisode(row));
  }

  /**
   * Update episode access (for retention scoring)
   */
  touchEpisode(id: string): void {
    this.db
      .prepare(
        `
      UPDATE sheep_episodes 
      SET access_count = access_count + 1, 
          last_accessed_at = ?,
          updated_at = ?
      WHERE id = ?
    `,
      )
      .run(now(), now(), id);
  }

  /**
   * Delete episode
   */
  deleteEpisode(id: string): boolean {
    const result = this.db.prepare("DELETE FROM sheep_episodes WHERE id = ?").run(id);
    return result.changes > 0;
  }

  private rowToEpisode(row: Record<string, unknown>): Episode {
    return {
      id: row.id as string,
      timestamp: row.timestamp as string,
      summary: row.summary as string,
      participants: JSON.parse(row.participants as string),
      topic: row.topic as string,
      keywords: JSON.parse(row.keywords as string),
      emotionalSalience: row.emotional_salience as number,
      utilityScore: row.utility_score as number,
      sourceSessionId: row.source_session_id as string,
      sourceMessageIds: JSON.parse(row.source_message_ids as string),
      ttl: row.ttl as Episode["ttl"],
      accessCount: row.access_count as number,
      lastAccessedAt: (row.last_accessed_at as string) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ===========================================================================
  // FACT OPERATIONS
  // ===========================================================================

  /**
   * Insert a new fact
   */
  insertFact(
    fact: Omit<
      Fact,
      "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions"
    >,
  ): Fact {
    const id = generateId("fact");
    const timestamp = now();
    const full: Fact = {
      ...fact,
      id,
      contradictions: [],
      isActive: true,
      accessCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db
      .prepare(
        `
      INSERT INTO sheep_facts (
        id, subject, predicate, object, confidence, evidence,
        first_seen, last_confirmed, contradictions, user_affirmed,
        is_active, retracted_reason, access_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        full.id,
        full.subject,
        full.predicate,
        full.object,
        full.confidence,
        JSON.stringify(full.evidence),
        full.firstSeen,
        full.lastConfirmed,
        JSON.stringify(full.contradictions),
        full.userAffirmed ? 1 : 0,
        full.isActive ? 1 : 0,
        full.retractedReason ?? null,
        full.accessCount,
        full.createdAt,
        full.updatedAt,
      );

    return full;
  }

  /**
   * Insert a fact with online semantic synthesis
   *
   * This method performs SimpleMem's Online Semantic Synthesis:
   * - Finds semantically similar facts using embeddings
   * - Merges them to prevent duplicates
   * - Returns the merged fact(s)
   *
   * @param fact - The fact to insert
   * @param embeddingProvider - Embedding provider for similarity search
   * @param llm - Optional LLM provider for intelligent merging
   * @param synthesisOptions - Options for synthesis
   * @returns The inserted fact(s) and synthesis metadata
   */
  async insertFactWithSynthesis(
    fact: Omit<
      Fact,
      "id" | "createdAt" | "updatedAt" | "accessCount" | "isActive" | "contradictions"
    >,
    embeddingProvider: import("../../memory/embeddings.js").EmbeddingProvider,
    llm?: import("../extraction/llm-extractor.js").LLMProvider,
    synthesisOptions?: import("../extraction/online-synthesis.js").SynthesisOptions,
  ): Promise<{
    fact: Fact;
    synthesized: boolean;
    mergedFactIds: string[];
  }> {
    const { synthesizeFacts } = await import("../extraction/online-synthesis.js");

    // Perform synthesis
    const result = await synthesizeFacts(fact, this, embeddingProvider, llm, synthesisOptions);

    // Insert the synthesized fact(s)
    const insertedFacts: Fact[] = [];
    for (const factToInsert of result.facts) {
      const inserted = this.insertFact(factToInsert);
      insertedFacts.push(inserted);
    }

    return {
      fact: insertedFacts[0], // Return first (should only be one after synthesis)
      synthesized: result.merged,
      mergedFactIds: result.mergedFactIds,
    };
  }

  /**
   * Get fact by ID
   */
  getFact(id: string): Fact | null {
    const row = this.db.prepare("SELECT * FROM sheep_facts WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToFact(row) : null;
  }

  /**
   * Find facts by subject-predicate-object pattern
   */
  findFacts(options: {
    subject?: string;
    predicate?: string;
    object?: string;
    activeOnly?: boolean;
    minConfidence?: number;
  }): Fact[] {
    let sql = "SELECT * FROM sheep_facts WHERE 1=1";
    const params: (string | number | null)[] = [];

    if (options.subject) {
      sql += " AND subject = ?";
      params.push(options.subject);
    }
    if (options.predicate) {
      sql += " AND predicate = ?";
      params.push(options.predicate);
    }
    if (options.object) {
      sql += " AND object = ?";
      params.push(options.object);
    }
    if (options.activeOnly !== false) {
      sql += " AND is_active = 1";
    }
    if (options.minConfidence !== undefined) {
      sql += " AND confidence >= ?";
      params.push(options.minConfidence);
    }

    sql += " ORDER BY confidence DESC";

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToFact(row));
  }

  /**
   * Update fact confidence
   */
  updateFactConfidence(id: string, newConfidence: number, reason: string): void {
    const fact = this.getFact(id);
    if (!fact) return;

    this.db
      .prepare(
        `
      UPDATE sheep_facts 
      SET confidence = ?, last_confirmed = ?, updated_at = ?
      WHERE id = ?
    `,
      )
      .run(newConfidence, now(), now(), id);

    // Record the change
    this.recordChange({
      changeType: newConfidence > fact.confidence ? "strengthen" : "weaken",
      targetType: "fact",
      targetId: id,
      previousValue: JSON.stringify({ confidence: fact.confidence }),
      newValue: JSON.stringify({ confidence: newConfidence }),
      reason,
    });
  }

  /**
   * Retract a fact (mark as inactive)
   */
  retractFact(id: string, reason: string): void {
    this.db
      .prepare(
        `
      UPDATE sheep_facts 
      SET is_active = 0, retracted_reason = ?, updated_at = ?
      WHERE id = ?
    `,
      )
      .run(reason, now(), id);
  }

  private rowToFact(row: Record<string, unknown>): Fact {
    return {
      id: row.id as string,
      subject: row.subject as string,
      predicate: row.predicate as string,
      object: row.object as string,
      confidence: row.confidence as number,
      evidence: JSON.parse(row.evidence as string),
      firstSeen: row.first_seen as string,
      lastConfirmed: row.last_confirmed as string,
      contradictions: JSON.parse(row.contradictions as string),
      userAffirmed: row.user_affirmed === 1,
      isActive: row.is_active === 1,
      retractedReason: (row.retracted_reason as string) ?? undefined,
      accessCount: row.access_count as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ===========================================================================
  // CAUSAL LINK OPERATIONS
  // ===========================================================================

  /**
   * Insert a new causal link
   */
  insertCausalLink(link: Omit<CausalLink, "id" | "createdAt" | "updatedAt">): CausalLink {
    const id = generateId("cl");
    const timestamp = now();
    const full: CausalLink = {
      ...link,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db
      .prepare(
        `
      INSERT INTO sheep_causal_links (
        id, cause_type, cause_id, cause_description,
        effect_type, effect_id, effect_description,
        mechanism, confidence, evidence, temporal_delay,
        causal_strength, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        full.id,
        full.causeType,
        full.causeId,
        full.causeDescription,
        full.effectType,
        full.effectId,
        full.effectDescription,
        full.mechanism,
        full.confidence,
        JSON.stringify(full.evidence),
        full.temporalDelay ?? null,
        full.causalStrength,
        full.createdAt,
        full.updatedAt,
      );

    return full;
  }

  /**
   * Find causal links by cause or effect
   */
  findCausalLinks(options: {
    causeId?: string;
    effectId?: string;
    minConfidence?: number;
  }): CausalLink[] {
    let sql = "SELECT * FROM sheep_causal_links WHERE 1=1";
    const params: (string | number | null)[] = [];

    if (options.causeId) {
      sql += " AND cause_id = ?";
      params.push(options.causeId);
    }
    if (options.effectId) {
      sql += " AND effect_id = ?";
      params.push(options.effectId);
    }
    if (options.minConfidence !== undefined) {
      sql += " AND confidence >= ?";
      params.push(options.minConfidence);
    }

    sql += " ORDER BY confidence DESC";

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToCausalLink(row));
  }

  /**
   * Query causal chain: why did X happen?
   */
  queryCausalChain(effectId: string, maxDepth: number = 5): CausalLink[] {
    const chain: CausalLink[] = [];
    const visited = new Set<string>();
    const queue = [effectId];

    while (queue.length > 0 && chain.length < maxDepth) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const links = this.findCausalLinks({ effectId: currentId });
      for (const link of links) {
        chain.push(link);
        queue.push(link.causeId);
      }
    }

    return chain;
  }

  private rowToCausalLink(row: Record<string, unknown>): CausalLink {
    return {
      id: row.id as string,
      causeType: row.cause_type as CausalLink["causeType"],
      causeId: row.cause_id as string,
      causeDescription: row.cause_description as string,
      effectType: row.effect_type as CausalLink["effectType"],
      effectId: row.effect_id as string,
      effectDescription: row.effect_description as string,
      mechanism: row.mechanism as string,
      confidence: row.confidence as number,
      evidence: JSON.parse(row.evidence as string),
      temporalDelay: (row.temporal_delay as string) ?? undefined,
      causalStrength: row.causal_strength as CausalLink["causalStrength"],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ===========================================================================
  // PROCEDURE OPERATIONS
  // ===========================================================================

  /**
   * Insert a new procedure
   */
  insertProcedure(
    proc: Omit<
      Procedure,
      "id" | "createdAt" | "updatedAt" | "timesUsed" | "timesSucceeded" | "successRate"
    >,
  ): Procedure {
    const id = generateId("proc");
    const timestamp = now();
    const full: Procedure = {
      ...proc,
      id,
      timesUsed: 0,
      timesSucceeded: 0,
      successRate: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db
      .prepare(
        `
      INSERT INTO sheep_procedures (
        id, trigger, action, expected_outcome, examples,
        success_rate, times_used, times_succeeded, tags,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        full.id,
        full.trigger,
        full.action,
        full.expectedOutcome ?? null,
        JSON.stringify(full.examples),
        full.successRate,
        full.timesUsed,
        full.timesSucceeded,
        JSON.stringify(full.tags),
        full.createdAt,
        full.updatedAt,
      );

    return full;
  }

  /**
   * Find procedures by trigger
   */
  findProcedures(options: {
    triggerContains?: string;
    tags?: string[];
    minSuccessRate?: number;
  }): Procedure[] {
    let sql = "SELECT * FROM sheep_procedures WHERE 1=1";
    const params: (string | number | null)[] = [];

    if (options.triggerContains) {
      sql += " AND trigger LIKE ?";
      params.push(`%${options.triggerContains}%`);
    }
    if (options.minSuccessRate !== undefined) {
      sql += " AND success_rate >= ?";
      params.push(options.minSuccessRate);
    }

    sql += " ORDER BY success_rate DESC, times_used DESC";

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    let procedures = rows.map((row) => this.rowToProcedure(row));

    if (options.tags && options.tags.length > 0) {
      procedures = procedures.filter((p) => options.tags!.some((tag) => p.tags.includes(tag)));
    }

    return procedures;
  }

  /**
   * Record procedure usage
   */
  recordProcedureUsage(id: string, succeeded: boolean): void {
    this.db
      .prepare(
        `
      UPDATE sheep_procedures 
      SET times_used = times_used + 1,
          times_succeeded = times_succeeded + ?,
          success_rate = CAST(times_succeeded + ? AS REAL) / (times_used + 1),
          updated_at = ?
      WHERE id = ?
    `,
      )
      .run(succeeded ? 1 : 0, succeeded ? 1 : 0, now(), id);
  }

  private rowToProcedure(row: Record<string, unknown>): Procedure {
    return {
      id: row.id as string,
      trigger: row.trigger as string,
      action: row.action as string,
      expectedOutcome: (row.expected_outcome as string) ?? undefined,
      examples: JSON.parse(row.examples as string),
      successRate: row.success_rate as number,
      timesUsed: row.times_used as number,
      timesSucceeded: row.times_succeeded as number,
      tags: JSON.parse(row.tags as string),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ===========================================================================
  // MEMORY CHANGE TRACKING
  // ===========================================================================

  /**
   * Record a memory change
   */
  recordChange(change: Omit<MemoryChange, "id" | "createdAt">): MemoryChange {
    const id = generateId("mc");
    const timestamp = now();
    const full: MemoryChange = {
      ...change,
      id,
      createdAt: timestamp,
    };

    this.db
      .prepare(
        `
      INSERT INTO sheep_memory_changes (
        id, change_type, target_type, target_id,
        previous_value, new_value, reason,
        trigger_episode_id, consolidation_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        full.id,
        full.changeType,
        full.targetType,
        full.targetId,
        full.previousValue ?? null,
        full.newValue,
        full.reason,
        full.triggerEpisodeId ?? null,
        full.consolidationRunId ?? null,
        full.createdAt,
      );

    return full;
  }

  /**
   * Get changes for a memory item
   */
  getChangesFor(targetType: string, targetId: string): MemoryChange[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM sheep_memory_changes 
      WHERE target_type = ? AND target_id = ?
      ORDER BY created_at DESC
    `,
      )
      .all(targetType, targetId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      changeType: row.change_type as MemoryChange["changeType"],
      targetType: row.target_type as MemoryChange["targetType"],
      targetId: row.target_id as string,
      previousValue: (row.previous_value as string) ?? undefined,
      newValue: row.new_value as string,
      reason: row.reason as string,
      triggerEpisodeId: (row.trigger_episode_id as string) ?? undefined,
      consolidationRunId: (row.consolidation_run_id as string) ?? undefined,
      createdAt: row.created_at as string,
    }));
  }

  // ===========================================================================
  // POINT-IN-TIME QUERIES
  // ===========================================================================

  /**
   * Query facts as they were believed at a specific point in time.
   * This reconstructs the historical state by:
   * 1. Getting facts that existed at that time (created before, not retracted before)
   * 2. Using memory changes to find the state at that specific timestamp
   *
   * @param asOf - ISO timestamp to query as of (e.g., "2024-01-15T00:00:00Z")
   * @param options - Filter options (subject, predicate, etc.)
   */
  queryFactsAtTime(
    asOf: string,
    options: {
      subject?: string;
      predicate?: string;
      object?: string;
      minConfidence?: number;
    } = {},
  ): Fact[] {
    // Get all facts that were created before the target time
    let sql = "SELECT * FROM sheep_facts WHERE created_at <= ?";
    const params: (string | number | null)[] = [asOf];

    if (options.subject) {
      sql += " AND subject LIKE ?";
      params.push(`%${options.subject}%`);
    }
    if (options.predicate) {
      sql += " AND predicate LIKE ?";
      params.push(`%${options.predicate}%`);
    }
    if (options.object) {
      sql += " AND object LIKE ?";
      params.push(`%${options.object}%`);
    }
    if (options.minConfidence !== undefined) {
      sql += " AND confidence >= ?";
      params.push(options.minConfidence);
    }

    const allFacts = (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map((r) =>
      this.rowToFact(r),
    );

    // For each fact, determine if it was active at the target time
    // A fact was active if:
    // - It was created before the target time AND
    // - It was either never retracted, OR it was retracted after the target time
    const factsAtTime: Fact[] = [];

    for (const fact of allFacts) {
      // Check if the fact was retracted before the target time
      const retractChanges = this.db
        .prepare(
          `
        SELECT * FROM sheep_memory_changes 
        WHERE target_type = 'fact' 
        AND target_id = ? 
        AND change_type IN ('retract', 'modify')
        AND created_at <= ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
        )
        .get(fact.id, asOf) as Record<string, unknown> | undefined;

      // If there was a retract before asOf, skip this fact
      if (retractChanges && retractChanges.change_type === "retract") {
        continue;
      }

      // If there was an update before asOf, reconstruct the historical value
      if (retractChanges && retractChanges.change_type === "modify") {
        // The "new_value" at that time is what we want
        const historicalValue = retractChanges.new_value as string;
        try {
          const parsed = JSON.parse(historicalValue);
          if (parsed.object) fact.object = parsed.object;
          if (parsed.confidence) fact.confidence = parsed.confidence;
        } catch {
          // If parse fails, use current value
        }
      }

      // Check if the fact was created after the target time (shouldn't happen due to filter, but double check)
      if (fact.createdAt > asOf) continue;

      // Fact was active at this time
      factsAtTime.push(fact);
    }

    return factsAtTime;
  }

  /**
   * Query episodes that occurred around a specific time period.
   *
   * @param asOf - ISO timestamp to query around
   * @param windowDays - How many days before/after to include (default: 7)
   */
  queryEpisodesAtTime(asOf: string, windowDays: number = 7): Episode[] {
    const targetDate = new Date(asOf);
    const before = new Date(targetDate.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const after = new Date(targetDate.getTime() + windowDays * 24 * 60 * 60 * 1000).toISOString();

    const rows = this.db
      .prepare(
        `
      SELECT * FROM sheep_episodes 
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
    `,
      )
      .all(before, after) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEpisode(r));
  }

  /**
   * Get a historical timeline of what was believed about a subject.
   * Returns all facts and their changes over time.
   *
   * @param subject - The subject to query (e.g., "user")
   */
  getBeliefTimeline(subject: string): Array<{
    timestamp: string;
    factId: string;
    predicate: string;
    value: string;
    confidence: number;
    changeType: "created" | "updated" | "retracted";
    reason?: string;
  }> {
    // Get all facts about this subject
    const facts = this.db
      .prepare(
        `
      SELECT * FROM sheep_facts WHERE subject LIKE ?
    `,
      )
      .all(`%${subject}%`) as Record<string, unknown>[];

    const timeline: Array<{
      timestamp: string;
      factId: string;
      predicate: string;
      value: string;
      confidence: number;
      changeType: "created" | "updated" | "retracted";
      reason?: string;
    }> = [];

    for (const row of facts) {
      const fact = this.rowToFact(row);

      // Add creation event
      timeline.push({
        timestamp: fact.createdAt,
        factId: fact.id,
        predicate: fact.predicate,
        value: fact.object,
        confidence: fact.confidence,
        changeType: "created",
      });

      // Get all changes for this fact
      const changes = this.getChangesFor("fact", fact.id);
      for (const change of changes) {
        if (change.changeType === "retract") {
          timeline.push({
            timestamp: change.createdAt,
            factId: fact.id,
            predicate: fact.predicate,
            value: fact.object,
            confidence: 0,
            changeType: "retracted",
            reason: change.reason,
          });
        } else if (change.changeType === "modify") {
          try {
            const newVal = JSON.parse(change.newValue);
            timeline.push({
              timestamp: change.createdAt,
              factId: fact.id,
              predicate: fact.predicate,
              value: newVal.object ?? fact.object,
              confidence: newVal.confidence ?? fact.confidence,
              changeType: "updated",
              reason: change.reason,
            });
          } catch {
            // Skip malformed changes
          }
        }
      }
    }

    // Sort by timestamp
    timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return timeline;
  }

  /**
   * Get what changed since a specific date.
   * Useful for answering "What have you learned since January?"
   *
   * @param since - ISO timestamp
   */
  getChangesSince(since: string): {
    newFacts: Fact[];
    newEpisodes: Episode[];
    retractedFacts: Array<{ id: string; reason: string; timestamp: string }>;
    updatedFacts: MemoryChange[];
  } {
    // New facts since date
    const newFacts = (
      this.db
        .prepare("SELECT * FROM sheep_facts WHERE created_at >= ? AND is_active = 1")
        .all(since) as Record<string, unknown>[]
    ).map((r) => this.rowToFact(r));

    // New episodes since date
    const newEpisodes = (
      this.db.prepare("SELECT * FROM sheep_episodes WHERE created_at >= ?").all(since) as Record<
        string,
        unknown
      >[]
    ).map((r) => this.rowToEpisode(r));

    // Retracted facts since date
    const retractChanges = this.db
      .prepare(
        `
      SELECT target_id, reason, created_at 
      FROM sheep_memory_changes 
      WHERE change_type = 'retract' 
      AND target_type = 'fact'
      AND created_at >= ?
    `,
      )
      .all(since) as Array<{ target_id: string; reason: string; created_at: string }>;

    const retractedFacts = retractChanges.map((r) => ({
      id: r.target_id,
      reason: r.reason,
      timestamp: r.created_at,
    }));

    // Updated facts since date
    const updateChanges = (
      this.db
        .prepare(
          `
      SELECT * FROM sheep_memory_changes 
      WHERE change_type = 'modify' 
      AND target_type = 'fact'
      AND created_at >= ?
    `,
        )
        .all(since) as Record<string, unknown>[]
    ).map((row) => ({
      id: row.id as string,
      changeType: row.change_type as MemoryChange["changeType"],
      targetType: row.target_type as MemoryChange["targetType"],
      targetId: row.target_id as string,
      previousValue: (row.previous_value as string) ?? undefined,
      newValue: row.new_value as string,
      reason: row.reason as string,
      triggerEpisodeId: (row.trigger_episode_id as string) ?? undefined,
      consolidationRunId: (row.consolidation_run_id as string) ?? undefined,
      createdAt: row.created_at as string,
    }));

    return {
      newFacts,
      newEpisodes,
      retractedFacts,
      updatedFacts: updateChanges,
    };
  }

  // ===========================================================================
  // CONSOLIDATION RUN TRACKING
  // ===========================================================================

  /**
   * Start a new consolidation run
   */
  startConsolidationRun(processedFrom: string, processedTo: string): ConsolidationRun {
    const id = generateId("cr");
    const timestamp = now();
    const run: ConsolidationRun = {
      id,
      startedAt: timestamp,
      status: "running",
      processedFrom,
      processedTo,
      sessionsProcessed: 0,
      episodesExtracted: 0,
      factsExtracted: 0,
      causalLinksExtracted: 0,
      proceduresExtracted: 0,
      contradictionsResolved: 0,
      memoriesPruned: 0,
    };

    this.db
      .prepare(
        `
      INSERT INTO sheep_consolidation_runs (
        id, started_at, status, processed_from, processed_to,
        sessions_processed, episodes_extracted, facts_extracted,
        causal_links_extracted, procedures_extracted,
        contradictions_resolved, memories_pruned
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        run.id,
        run.startedAt,
        run.status,
        run.processedFrom,
        run.processedTo,
        run.sessionsProcessed,
        run.episodesExtracted,
        run.factsExtracted,
        run.causalLinksExtracted,
        run.proceduresExtracted,
        run.contradictionsResolved,
        run.memoriesPruned,
      );

    return run;
  }

  /**
   * Complete a consolidation run
   */
  completeConsolidationRun(
    id: string,
    stats: {
      sessionsProcessed: number;
      episodesExtracted: number;
      factsExtracted: number;
      causalLinksExtracted: number;
      proceduresExtracted: number;
      contradictionsResolved: number;
      memoriesPruned: number;
    },
    error?: string,
  ): void {
    const completedAt = now();
    const row = this.db
      .prepare("SELECT started_at FROM sheep_consolidation_runs WHERE id = ?")
      .get(id) as { started_at: string } | undefined;

    const durationMs = row
      ? new Date(completedAt).getTime() - new Date(row.started_at).getTime()
      : 0;

    this.db
      .prepare(
        `
      UPDATE sheep_consolidation_runs SET
        completed_at = ?,
        status = ?,
        sessions_processed = ?,
        episodes_extracted = ?,
        facts_extracted = ?,
        causal_links_extracted = ?,
        procedures_extracted = ?,
        contradictions_resolved = ?,
        memories_pruned = ?,
        duration_ms = ?,
        error_message = ?
      WHERE id = ?
    `,
      )
      .run(
        completedAt,
        error ? "failed" : "completed",
        stats.sessionsProcessed,
        stats.episodesExtracted,
        stats.factsExtracted,
        stats.causalLinksExtracted,
        stats.proceduresExtracted,
        stats.contradictionsResolved,
        stats.memoriesPruned,
        durationMs,
        error ?? null,
        id,
      );
  }

  /**
   * Get the last consolidation run
   */
  getLastConsolidationRun(): ConsolidationRun | null {
    const row = this.db
      .prepare(
        `
      SELECT * FROM sheep_consolidation_runs 
      ORDER BY started_at DESC LIMIT 1
    `,
      )
      .get() as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      startedAt: row.started_at as string,
      completedAt: (row.completed_at as string) ?? undefined,
      status: row.status as ConsolidationRun["status"],
      processedFrom: row.processed_from as string,
      processedTo: row.processed_to as string,
      sessionsProcessed: row.sessions_processed as number,
      episodesExtracted: row.episodes_extracted as number,
      factsExtracted: row.facts_extracted as number,
      causalLinksExtracted: row.causal_links_extracted as number,
      proceduresExtracted: row.procedures_extracted as number,
      contradictionsResolved: row.contradictions_resolved as number,
      memoriesPruned: row.memories_pruned as number,
      durationMs: (row.duration_ms as number) ?? undefined,
      errorMessage: (row.error_message as string) ?? undefined,
      log: row.log ? JSON.parse(row.log as string) : undefined,
    };
  }

  // ===========================================================================
  // MEMORY SIZE LIMITS & PRUNING
  // ===========================================================================

  /**
   * Default memory limits - can be overridden in enforcement
   */
  static readonly DEFAULT_LIMITS = {
    maxEpisodes: 10000,
    maxFacts: 50000,
    maxCausalLinks: 10000,
    maxProcedures: 5000,
    maxTotalSizeBytes: 100 * 1024 * 1024, // 100MB
  };

  /**
   * Check if memory limits are exceeded
   */
  checkMemoryLimits(limits = SheepDatabase.DEFAULT_LIMITS): {
    exceeded: boolean;
    details: {
      episodesExceeded: boolean;
      factsExceeded: boolean;
      causalLinksExceeded: boolean;
      proceduresExceeded: boolean;
      sizeExceeded: boolean;
    };
    counts: {
      episodes: number;
      facts: number;
      causalLinks: number;
      procedures: number;
      estimatedSizeBytes: number;
    };
  } {
    const stats = this.getStats();
    const episodesExceeded = stats.totalEpisodes > limits.maxEpisodes;
    const factsExceeded = stats.totalFacts > limits.maxFacts;
    const causalLinksExceeded = stats.totalCausalLinks > limits.maxCausalLinks;
    const proceduresExceeded = stats.totalProcedures > limits.maxProcedures;
    const sizeExceeded = stats.totalSizeBytes > limits.maxTotalSizeBytes;

    return {
      exceeded:
        episodesExceeded ||
        factsExceeded ||
        causalLinksExceeded ||
        proceduresExceeded ||
        sizeExceeded,
      details: {
        episodesExceeded,
        factsExceeded,
        causalLinksExceeded,
        proceduresExceeded,
        sizeExceeded,
      },
      counts: {
        episodes: stats.totalEpisodes,
        facts: stats.totalFacts,
        causalLinks: stats.totalCausalLinks,
        procedures: stats.totalProcedures,
        estimatedSizeBytes: stats.totalSizeBytes,
      },
    };
  }

  /**
   * Enforce memory limits by pruning oldest/lowest-scored memories.
   * Uses retention scoring to prioritize what to keep.
   *
   * @param limits - Memory limits to enforce
   * @returns Count of pruned items
   */
  enforceMemoryLimits(limits = SheepDatabase.DEFAULT_LIMITS): {
    episodesPruned: number;
    factsPruned: number;
    causalLinksPruned: number;
    proceduresPruned: number;
  } {
    const result = {
      episodesPruned: 0,
      factsPruned: 0,
      causalLinksPruned: 0,
      proceduresPruned: 0,
    };

    const stats = this.getStats();

    // Prune episodes by age (oldest first) and salience (lowest first)
    if (stats.totalEpisodes > limits.maxEpisodes) {
      const toDelete = stats.totalEpisodes - limits.maxEpisodes;
      // Delete episodes with lowest utility and oldest timestamp
      const deleted = this.db
        .prepare(
          `
				DELETE FROM sheep_episodes 
				WHERE id IN (
					SELECT id FROM sheep_episodes 
					ORDER BY utility_score ASC, timestamp ASC 
					LIMIT ?
				)
			`,
        )
        .run(toDelete);
      result.episodesPruned = Number(deleted.changes);
    }

    // Prune facts by confidence (lowest first) and age
    if (stats.totalFacts > limits.maxFacts) {
      const toDelete = stats.totalFacts - limits.maxFacts;
      // Delete inactive facts first, then lowest confidence active facts
      const deleted = this.db
        .prepare(
          `
				DELETE FROM sheep_facts 
				WHERE id IN (
					SELECT id FROM sheep_facts 
					WHERE user_affirmed = 0
					ORDER BY is_active ASC, confidence ASC, created_at ASC 
					LIMIT ?
				)
			`,
        )
        .run(toDelete);
      result.factsPruned = Number(deleted.changes);
    }

    // Prune causal links by confidence
    if (stats.totalCausalLinks > limits.maxCausalLinks) {
      const toDelete = stats.totalCausalLinks - limits.maxCausalLinks;
      const deleted = this.db
        .prepare(
          `
				DELETE FROM sheep_causal_links 
				WHERE id IN (
					SELECT id FROM sheep_causal_links 
					ORDER BY confidence ASC, created_at ASC 
					LIMIT ?
				)
			`,
        )
        .run(toDelete);
      result.causalLinksPruned = Number(deleted.changes);
    }

    // Prune procedures by success rate and usage
    if (stats.totalProcedures > limits.maxProcedures) {
      const toDelete = stats.totalProcedures - limits.maxProcedures;
      const deleted = this.db
        .prepare(
          `
				DELETE FROM sheep_procedures 
				WHERE id IN (
					SELECT id FROM sheep_procedures 
					ORDER BY success_rate ASC, times_used ASC, created_at ASC 
					LIMIT ?
				)
			`,
        )
        .run(toDelete);
      result.proceduresPruned = Number(deleted.changes);
    }

    return result;
  }

  /**
   * Get all procedures (for iteration)
   */
  getAllProcedures(): Array<{ id: string; trigger: string; action: string }> {
    const rows = this.db
      .prepare("SELECT id, trigger, action FROM sheep_procedures")
      .all() as Array<{
      id: string;
      trigger: string;
      action: string;
    }>;
    return rows;
  }

  /**
   * Delete a procedure by ID
   */
  deleteProcedure(id: string): boolean {
    const result = this.db.prepare("DELETE FROM sheep_procedures WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ===========================================================================
  // USER PROFILE OPERATIONS
  // ===========================================================================

  /**
   * Insert a new user profile
   */
  insertUserProfile(profile: Omit<UserProfile, "id" | "createdAt" | "updatedAt">): UserProfile {
    const id = generateId("up");
    const timestamp = now();
    const full: UserProfile = {
      ...profile,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db
      .prepare(
        `
      INSERT INTO sheep_user_profiles (
        id, user_id, attributes, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        full.id,
        full.userId,
        JSON.stringify(full.attributes),
        full.confidence,
        full.createdAt,
        full.updatedAt,
      );

    return full;
  }

  /**
   * Get user profile by user ID
   */
  getUserProfile(userId: string): UserProfile | null {
    const row = this.db
      .prepare(
        "SELECT * FROM sheep_user_profiles WHERE user_id = ? ORDER BY confidence DESC LIMIT 1",
      )
      .get(userId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      userId: row.user_id as string,
      attributes: JSON.parse(row.attributes as string),
      confidence: row.confidence as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * Update user profile
   */
  updateUserProfile(
    id: string,
    updates: Partial<Omit<UserProfile, "id" | "createdAt" | "updatedAt">>,
  ): void {
    const timestamp = now();
    const existing = this.db.prepare("SELECT * FROM sheep_user_profiles WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;

    if (!existing) return;

    const currentAttributes = JSON.parse(existing.attributes as string);
    const updatedAttributes = updates.attributes
      ? { ...currentAttributes, ...updates.attributes }
      : currentAttributes;

    this.db
      .prepare(
        `
      UPDATE sheep_user_profiles SET
        attributes = ?,
        confidence = ?,
        updated_at = ?
      WHERE id = ?
    `,
      )
      .run(
        JSON.stringify(updatedAttributes),
        updates.confidence ?? (existing.confidence as number),
        timestamp,
        id,
      );
  }

  // ===========================================================================
  // PREFERENCE OPERATIONS
  // ===========================================================================

  /**
   * Insert a new preference
   */
  insertPreference(preference: Omit<Preference, "id" | "createdAt">): Preference {
    const id = generateId("pref");
    const timestamp = now();
    const full: Preference = {
      ...preference,
      id,
      createdAt: timestamp,
    };

    this.db
      .prepare(
        `
      INSERT INTO sheep_preferences (
        id, user_id, category, preference, sentiment, confidence, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        full.id,
        full.userId,
        full.category,
        full.preference,
        full.sentiment,
        full.confidence,
        full.source,
        full.createdAt,
      );

    return full;
  }

  /**
   * Get preferences for a user
   */
  getUserPreferences(
    userId: string,
    options: { category?: string; sentiment?: Preference["sentiment"] } = {},
  ): Preference[] {
    let sql = "SELECT * FROM sheep_preferences WHERE user_id = ?";
    const params: (string | number)[] = [userId];

    if (options.category) {
      sql += " AND category = ?";
      params.push(options.category);
    }

    if (options.sentiment) {
      sql += " AND sentiment = ?";
      params.push(options.sentiment);
    }

    sql += " ORDER BY confidence DESC, created_at DESC";

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      category: row.category as string,
      preference: row.preference as string,
      sentiment: row.sentiment as Preference["sentiment"],
      confidence: row.confidence as number,
      source: row.source as string,
      createdAt: row.created_at as string,
    }));
  }

  // ===========================================================================
  // RELATIONSHIP OPERATIONS
  // ===========================================================================

  /**
   * Insert a new relationship
   */
  insertRelationship(
    relationship: Omit<Relationship, "id" | "createdAt" | "updatedAt">,
  ): Relationship {
    const id = generateId("rel");
    const timestamp = now();
    const full: Relationship = {
      ...relationship,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db
      .prepare(
        `
      INSERT INTO sheep_relationships (
        id, person1, person2, relationship_type, strength, evidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        full.id,
        full.person1,
        full.person2,
        full.relationshipType,
        full.strength,
        JSON.stringify(full.evidence),
        full.createdAt,
        full.updatedAt,
      );

    return full;
  }

  /**
   * Get relationships for a person
   */
  getRelationships(person: string): Relationship[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM sheep_relationships 
      WHERE person1 = ? OR person2 = ?
      ORDER BY strength DESC, updated_at DESC
    `,
      )
      .all(person, person) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      person1: row.person1 as string,
      person2: row.person2 as string,
      relationshipType: row.relationship_type as string,
      strength: row.strength as number,
      evidence: JSON.parse(row.evidence as string),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  /**
   * Get relationship between two people
   */
  getRelationship(person1: string, person2: string): Relationship | null {
    const row = this.db
      .prepare(
        `
      SELECT * FROM sheep_relationships 
      WHERE (person1 = ? AND person2 = ?) OR (person1 = ? AND person2 = ?)
      ORDER BY strength DESC LIMIT 1
    `,
      )
      .get(person1, person2, person2, person1) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      person1: row.person1 as string,
      person2: row.person2 as string,
      relationshipType: row.relationship_type as string,
      strength: row.strength as number,
      evidence: JSON.parse(row.evidence as string),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * Update relationship strength
   */
  updateRelationshipStrength(id: string, newStrength: number, additionalEvidence?: string): void {
    const existing = this.db
      .prepare("SELECT evidence FROM sheep_relationships WHERE id = ?")
      .get(id) as { evidence: string } | undefined;

    if (!existing) return;

    const evidence = JSON.parse(existing.evidence) as string[];
    if (additionalEvidence && !evidence.includes(additionalEvidence)) {
      evidence.push(additionalEvidence);
    }

    this.db
      .prepare(
        `
      UPDATE sheep_relationships SET
        strength = ?,
        evidence = ?,
        updated_at = ?
      WHERE id = ?
    `,
      )
      .run(newStrength, JSON.stringify(evidence), now(), id);
  }

  // ===========================================================================
  // CORE MEMORY OPERATIONS
  // ===========================================================================

  /**
   * Insert a new core memory
   */
  insertCoreMemory(memory: Omit<CoreMemory, "id" | "createdAt">): CoreMemory {
    const id = generateId("cm");
    const timestamp = now();
    const full: CoreMemory = {
      ...memory,
      id,
      createdAt: timestamp,
    };

    this.db
      .prepare(
        `
      INSERT INTO sheep_core_memories (
        id, content, importance, emotional_weight, category, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        full.id,
        full.content,
        full.importance,
        full.emotionalWeight,
        full.category,
        full.createdAt,
      );

    return full;
  }

  /**
   * Get core memories
   */
  getCoreMemories(
    options: {
      category?: CoreMemory["category"];
      minImportance?: number;
      limit?: number;
    } = {},
  ): CoreMemory[] {
    let sql = "SELECT * FROM sheep_core_memories WHERE 1=1";
    const params: (string | number)[] = [];

    if (options.category) {
      sql += " AND category = ?";
      params.push(options.category);
    }

    if (options.minImportance !== undefined) {
      sql += " AND importance >= ?";
      params.push(options.minImportance);
    }

    sql += " ORDER BY importance DESC, emotional_weight DESC";

    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      content: row.content as string,
      importance: row.importance as number,
      emotionalWeight: row.emotional_weight as number,
      category: row.category as CoreMemory["category"],
      createdAt: row.created_at as string,
    }));
  }

  /**
   * Get core memory by ID
   */
  getCoreMemory(id: string): CoreMemory | null {
    const row = this.db.prepare("SELECT * FROM sheep_core_memories WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      content: row.content as string,
      importance: row.importance as number,
      emotionalWeight: row.emotional_weight as number,
      category: row.category as CoreMemory["category"],
      createdAt: row.created_at as string,
    };
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Insert a foresight signal
   */
  insertForesight(foresight: {
    description: string;
    evidence: string;
    startTime: string;
    endTime?: string | null;
    durationDays?: number | null;
    confidence: number;
    sourceEpisodeId?: string;
    userId: string;
  }): string {
    const id = generateId("foresight");
    this.db
      .prepare(
        `INSERT INTO sheep_foresights (id, description, evidence, start_time, end_time, duration_days, confidence, source_episode_id, user_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        id,
        foresight.description,
        foresight.evidence,
        foresight.startTime,
        foresight.endTime ?? null,
        foresight.durationDays ?? null,
        foresight.confidence,
        foresight.sourceEpisodeId ?? null,
        foresight.userId,
        now(),
      );
    return id;
  }

  /**
   * Get active foresights for a user
   */
  getActiveForesights(userId: string): Array<{
    id: string;
    description: string;
    evidence: string;
    startTime: string;
    endTime: string | null;
    confidence: number;
    isActive: boolean;
  }> {
    return this.db
      .prepare(
        `SELECT id, description, evidence, start_time as startTime, end_time as endTime, confidence, is_active as isActive
         FROM sheep_foresights
         WHERE user_id = ? AND is_active = 1
         ORDER BY confidence DESC`,
      )
      .all(userId) as any[];
  }

  /**
   * Expire foresights that have passed their end_time
   */
  expireForesights(): number {
    const result = this.db
      .prepare(
        `UPDATE sheep_foresights SET is_active = 0 WHERE is_active = 1 AND end_time IS NOT NULL AND end_time < ?`,
      )
      .run(now());
    return (result as any).changes ?? 0;
  }

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    const episodeCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM sheep_episodes").get() as { count: number }
    ).count;
    const factCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM sheep_facts WHERE is_active = 1").get() as {
        count: number;
      }
    ).count;
    const causalCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM sheep_causal_links").get() as { count: number }
    ).count;
    const procedureCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM sheep_procedures").get() as { count: number }
    ).count;
    const userProfileCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM sheep_user_profiles").get() as {
        count: number;
      }
    ).count;
    const preferenceCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM sheep_preferences").get() as { count: number }
    ).count;
    const relationshipCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM sheep_relationships").get() as {
        count: number;
      }
    ).count;
    const coreMemoryCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM sheep_core_memories").get() as {
        count: number;
      }
    ).count;

    const avgConfidence =
      (
        this.db
          .prepare("SELECT AVG(confidence) as avg FROM sheep_facts WHERE is_active = 1")
          .get() as { avg: number | null }
      ).avg ?? 0;

    const oldest = this.db
      .prepare("SELECT MIN(created_at) as oldest FROM sheep_episodes")
      .get() as { oldest: string | null };
    const newest = this.db
      .prepare("SELECT MAX(created_at) as newest FROM sheep_episodes")
      .get() as { newest: string | null };

    const lastRun = this.getLastConsolidationRun();

    const totalPruned =
      (
        this.db
          .prepare("SELECT SUM(memories_pruned) as total FROM sheep_consolidation_runs")
          .get() as { total: number | null }
      ).total ?? 0;

    // Estimate size (rough calculation based on row counts)
    const estimatedSize =
      episodeCount * 500 +
      factCount * 200 +
      causalCount * 300 +
      procedureCount * 250 +
      userProfileCount * 300 +
      preferenceCount * 150 +
      relationshipCount * 200 +
      coreMemoryCount * 400;

    return {
      agentId: this.agentId,
      totalEpisodes: episodeCount,
      totalFacts: factCount,
      totalCausalLinks: causalCount,
      totalProcedures: procedureCount,
      totalUserProfiles: userProfileCount,
      totalPreferences: preferenceCount,
      totalRelationships: relationshipCount,
      totalCoreMemories: coreMemoryCount,
      totalSizeBytes: estimatedSize,
      lastConsolidation: lastRun?.completedAt,
      oldestMemory: oldest.oldest ?? undefined,
      newestMemory: newest.newest ?? undefined,
      averageFactConfidence: avgConfidence,
      totalPruned,
    };
  }
}
