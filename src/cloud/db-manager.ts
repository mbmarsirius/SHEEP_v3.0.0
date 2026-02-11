/**
 * SHEEP Cloud - Per-User Database Manager
 *
 * Each API key / userId gets its own SQLite database file.
 * This provides:
 *   - Complete data isolation between users
 *   - GDPR deletion = delete the file
 *   - No multi-tenant query risks
 *
 * Databases are cached in memory (LRU-style) and closed after idle timeout.
 */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { SheepDatabase } from "../memory/database.js";

// =============================================================================
// CONFIG
// =============================================================================

/** Directory where per-user SQLite files are stored */
const DATA_DIR = process.env.SHEEP_DATA_DIR ?? join(process.cwd(), "data");

/** Close idle databases after this many ms (default: 10 minutes) */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

// =============================================================================
// STATE
// =============================================================================

interface DBEntry {
  db: SheepDatabase;
  lastAccess: number;
}

const dbCache = new Map<string, DBEntry>();

// Cleanup idle DBs every 2 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of dbCache) {
    if (now - entry.lastAccess > IDLE_TIMEOUT_MS) {
      dbCache.delete(userId);
      // SheepDatabase doesn't expose a close() -- GC will handle it
      console.log(`[cloud/db] Evicted idle database for user ${userId}`);
    }
  }
}, 120_000);

// Allow process to exit cleanly
cleanupInterval.unref();

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get (or create) the SheepDatabase for a given userId.
 * The database file lives at DATA_DIR/{userId}.sqlite.
 */
export function getUserDatabase(userId: string): SheepDatabase {
  const entry = dbCache.get(userId);
  if (entry) {
    entry.lastAccess = Date.now();
    return entry.db;
  }

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // SheepDatabase constructor takes (agentId, basePath?)
  // It creates {basePath}/{agentId}.sqlite
  const db = new SheepDatabase(userId, DATA_DIR);

  dbCache.set(userId, { db, lastAccess: Date.now() });
  console.log(`[cloud/db] Opened database for user ${userId}`);

  return db;
}

/**
 * Delete all data for a user (GDPR right-to-erasure).
 * Removes the database from cache and deletes the file.
 */
export function deleteUserDatabase(userId: string): boolean {
  dbCache.delete(userId);

  const dbPath = join(DATA_DIR, `${userId}.sqlite`);
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
    console.log(`[cloud/db] Deleted database for user ${userId}`);
    return true;
  }
  return false;
}

/**
 * Get the number of currently cached databases.
 */
export function getActiveDbCount(): number {
  return dbCache.size;
}

/**
 * Get the data directory path.
 */
export function getDataDir(): string {
  return DATA_DIR;
}
