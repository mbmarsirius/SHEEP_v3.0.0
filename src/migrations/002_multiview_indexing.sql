-- Migration 002: Multi-View Indexing Schema (SimpleMem Integration)
-- Adds semantic embeddings, keywords, metadata, and FTS5 for hybrid search

-- Add semantic embedding column
ALTER TABLE sheep_facts ADD COLUMN embedding BLOB;

-- Add keyword index for BM25
ALTER TABLE sheep_facts ADD COLUMN keywords TEXT;

-- Add metadata JSON for symbolic search
ALTER TABLE sheep_facts ADD COLUMN metadata TEXT DEFAULT '{}';

-- Create FTS5 virtual table for keyword search
CREATE VIRTUAL TABLE IF NOT EXISTS sheep_facts_fts USING fts5(
  subject,
  predicate,
  object,
  keywords,
  content='sheep_facts',
  content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS sheep_facts_ai AFTER INSERT ON sheep_facts BEGIN
  INSERT INTO sheep_facts_fts(rowid, subject, predicate, object, keywords)
  VALUES (new.id, new.subject, new.predicate, new.object, COALESCE(new.keywords, ''));
END;

CREATE TRIGGER IF NOT EXISTS sheep_facts_ad AFTER DELETE ON sheep_facts BEGIN
  INSERT INTO sheep_facts_fts(sheep_facts_fts, rowid, subject, predicate, object, keywords)
  VALUES ('delete', old.id, old.subject, old.predicate, old.object, COALESCE(old.keywords, ''));
END;

CREATE TRIGGER IF NOT EXISTS sheep_facts_au AFTER UPDATE ON sheep_facts BEGIN
  INSERT INTO sheep_facts_fts(sheep_facts_fts, rowid, subject, predicate, object, keywords)
  VALUES ('delete', old.id, old.subject, old.predicate, old.object, COALESCE(old.keywords, ''));
  INSERT INTO sheep_facts_fts(rowid, subject, predicate, object, keywords)
  VALUES (new.id, new.subject, new.predicate, new.object, COALESCE(new.keywords, ''));
END;
