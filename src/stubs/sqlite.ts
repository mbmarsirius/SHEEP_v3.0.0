/**
 * Stub: SQLite loader (Node 22+ built-in)
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export function requireNodeSqlite() {
  // Use Node.js native sqlite module (Node 22+)
  return require("node:sqlite");
}
