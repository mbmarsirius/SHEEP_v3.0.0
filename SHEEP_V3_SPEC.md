# SHEEP v3.0 — Technical Specification

**Date:** Feb 7, 2026
**Author:** Counting Sheep 🐑 (autonomous session)
**Goal:** LoCoMo 90%+ by adapting EverMemOS techniques + SHEEP unique strengths

---

## NEW FEATURE 1: Foresight Signals

### What
Extract time-bounded predictions/intentions from conversations.

### Implementation (from EverMemOS source code analysis)

```typescript
// Add to src/sheep/memory/schema.ts
export type Foresight = {
  id: string;
  description: string;       // "Mus will buy a Mac Studio this month"
  evidence: string;           // "Mus said budget is not an issue for max capability"
  startTime: string;          // "2026-02-07"
  endTime: string | null;     // "2026-03-07"
  durationDays: number | null; // 30
  confidence: number;
  sourceEpisodeId: string;
  userId: string;
  isActive: boolean;          // expires when endTime passes
  createdAt: string;
  embedding?: number[];
};
```

### Database Schema
```sql
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
CREATE INDEX idx_foresight_active ON sheep_foresights(is_active, end_time);
```

### LLM Prompt (adapted from EverMemOS)
```
You are a personal foresight analyst. Based on the conversation below,
predict 4-8 specific impacts on the user's future behavior and decisions.

Each prediction must include:
- content: What will happen (max 40 words, specific and verifiable)
- evidence: Supporting fact from conversation (max 40 words)
- start_time: YYYY-MM-DD
- end_time: YYYY-MM-DD (infer if not explicit)
- duration_days: Number of days

Output: JSON array
```

### Integration Point
Add to extraction pipeline after fact extraction:
`extractEpisode() → extractFacts() → extractCausals() → extractForesights()`

---

## NEW FEATURE 2: MemScene-like Topic Clustering

### What
Group related episodes/facts into thematic clusters (scenes).

### Implementation (from EverMemOS ClusterManager)

```typescript
// Add to src/sheep/memory/cluster.ts
export type MemoryCluster = {
  id: string;              // "cluster_001"
  centroid: number[];      // Average embedding vector
  memberCount: number;
  lastTimestamp: string;
  theme: string;           // LLM-generated theme label
};

// Online incremental clustering algorithm:
// 1. Compute embedding for new episode/fact
// 2. Find nearest cluster centroid (cosine similarity)
// 3. If similarity > threshold (0.7): add to cluster, update centroid
// 4. If similarity < threshold: create new cluster
```

### Key Parameters (from EverMemOS config)
- `similarity_threshold`: 0.7 (default)
- `max_clusters`: 100
- `min_cluster_size`: 2

### Why This Matters
Multi-hop questions like "What happened during the Italy trip?" need scene-level retrieval.
Currently SHEEP retrieves individual facts — clustering enables scene-level context.

---

## NEW FEATURE 3: Retrieval Verification

### What
After retrieving facts, verify they actually answer the query before returning.

### Implementation
```typescript
// Add verification step in retrieval pipeline
async function verifiedRetrieve(query: string, topK: number = 10): Promise<Fact[]> {
  const candidates = await hybridRetrieve(query, topK * 2); // Get 2x candidates
  
  // LLM verification: "Does this fact help answer the query?"
  const verified = await llm.verify(query, candidates);
  
  return verified.slice(0, topK);
}
```

### Impact
Reduces false positives, improves precision. EverMemOS calls this "agentic verification cycles."

---

## IMPROVEMENT 1: LLM Causal Extraction

### Current State
`src/sheep/causal/causal-extractor.ts` uses **regex only** (16 patterns).
Flag `useLLM: boolean` exists but defaults to `false`.

### Fix
```typescript
// In causal-extractor.ts, change default:
export type CausalExtractionOptions = {
  minConfidence?: number;
  useLLM?: boolean; // Change default to TRUE
};

// Add LLM prompt for causal extraction:
const CAUSAL_EXTRACTION_PROMPT = `
Given these episode summaries and facts, extract cause-effect relationships.
For each relationship provide:
- cause: What happened first
- effect: What resulted
- mechanism: How the cause led to the effect
- confidence: 0.0-1.0

Only extract relationships where causation is clearly implied or stated.
Output: JSON array
`;
```

### Impact
Should increase causal links from ~100 to 1000+ and improve "why" queries dramatically.

---

## IMPROVEMENT 2: Dynamic User Profiling

### Current State
SHEEP has `user_affirmed` flag and basic fact storage.

### Needed
Separate **stable traits** from **transient states**:

```typescript
export type UserProfile = {
  stableTraits: ProfileFact[];    // "Developer", "Lives in Cyprus"
  transientStates: ProfileFact[]; // "Working on benchmarks", "Buying Mac Studio"
  preferences: ProfileFact[];     // "Prefers local models", "Hates paying API costs"
};

export type ProfileFact = {
  fact: string;
  confidence: number;
  firstSeen: string;
  lastConfirmed: string;
  stability: 'stable' | 'transient';  // NEW
  validUntil?: string;                 // NEW (for transient)
};
```

### Discrimination Logic (from EverMemOS profile_manager/discriminator.py)
- Seen 3+ times over 7+ days → **stable**
- Seen 1-2 times or recent only → **transient**
- Has explicit time reference → **transient with expiry**

---

## Priority Order for Cursor Implementation

### Week 1 (MUST DO):
1. Enable LLM causal extraction (flip flag + add prompt) — 1-2h
2. Populate main.sqlite (run ingestion on test data) — 1h
3. Add DB fallback in retrieval — 30min
4. Run LoCoMo baseline — 2h

### Week 2 (HIGH VALUE):
1. Add Foresight schema + extractor — 3-4h
2. Add cluster/scene-level grouping — 4-6h
3. Add retrieval verification — 2h
4. Run LoCoMo — 2h

### Week 3 (POLISH):
1. Dynamic user profiling — 3h
2. Multi-hop chain improvement — 4h
3. Full benchmark suite — 4h

### Expected Results:
- After Week 1: LoCoMo ~80%
- After Week 2: LoCoMo ~87%
- After Week 3: LoCoMo ~92%+ 🎯

---

## Reference: EverMemOS Source Code Locations
(Cloned to ~/Desktop/EverMemOS/)

| Component | SHEEP Equivalent | EverMemOS Path |
|-----------|-----------------|----------------|
| Foresight | NEW | `src/memory_layer/memory_extractor/foresight_extractor.py` |
| Foresight Prompt | NEW | `src/memory_layer/prompts/en/foresight_prompts.py` |
| Clustering | NEW | `src/memory_layer/cluster_manager/manager.py` |
| Profile | Partial | `src/memory_layer/profile_manager/` |
| Episode Extract | Exists | `src/memory_layer/memory_extractor/episode_memory_extractor.py` |
| Profile Prompts | NEW | `src/memory_layer/prompts/en/profile_mem_*.py` |

---

*This spec was created by autonomous analysis of EverMemOS source code (open source, Apache 2.0 license).*
*All adaptations are clean-room implementations in TypeScript for SHEEP.*
🐑
