-- Migration 003: New Memory Types
-- Adds UserProfile, Preference, Relationship, and CoreMemory tables

-- User Profiles: Structured user information
CREATE TABLE IF NOT EXISTS sheep_user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  attributes TEXT NOT NULL, -- JSON object
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
  sentiment TEXT NOT NULL, -- "positive", "negative", "neutral"
  confidence REAL NOT NULL,
  source TEXT NOT NULL, -- Episode ID
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
  evidence TEXT NOT NULL, -- JSON array of episode IDs
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
  category TEXT NOT NULL, -- "achievement", "loss", "relationship", "decision", "milestone"
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheep_core_memories_importance ON sheep_core_memories(importance);
CREATE INDEX IF NOT EXISTS idx_sheep_core_memories_category ON sheep_core_memories(category);
CREATE INDEX IF NOT EXISTS idx_sheep_core_memories_importance_category ON sheep_core_memories(importance, category);
