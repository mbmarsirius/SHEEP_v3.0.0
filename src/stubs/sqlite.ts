/**
 * Stub: SQLite loader (replaces memory/sqlite.js)
 */
export function requireNodeSqlite() {
  // Use Node.js native sqlite module (Node 22+)
  return require("node:sqlite");
}
