# SHEEP AI - EXECUTION PLAN
## Phase 0 Completion & Quality Improvements

**Created**: January 30, 2026  
**Purpose**: Step-by-step implementation guide to bring SHEEP AI to production-ready state  
**Estimated Effort**: 3-4 weeks for all items  
**Current Phase 0 Status**: 85% → Target: 98%

---

## EXECUTION ORDER & DEPENDENCIES

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXECUTION DEPENDENCY GRAPH                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  WEEK 1: Foundation & Measurement                                           │
│  ┌─────────────────┐     ┌─────────────────┐                               │
│  │ 1. Opt-in Flag  │────▶│ 2. Timing       │                               │
│  │    (Required)   │     │    Metrics      │                               │
│  └─────────────────┘     └─────────────────┘                               │
│                                 │                                           │
│  WEEK 2: Accuracy & Automation  ▼                                           │
│  ┌─────────────────┐     ┌─────────────────┐                               │
│  │ 3. Golden Test  │────▶│ 4. Accuracy     │                               │
│  │    Dataset      │     │    Measurement  │                               │
│  └─────────────────┘     └─────────────────┘                               │
│         │                       │                                           │
│         ▼                       ▼                                           │
│  ┌─────────────────┐     ┌─────────────────┐                               │
│  │ 5. Auto-        │     │ 6. NER          │                               │
│  │    Consolidate  │     │    Enhancement  │                               │
│  └─────────────────┘     └─────────────────┘                               │
│                                 │                                           │
│  WEEK 3: Advanced Features      ▼                                           │
│  ┌─────────────────┐     ┌─────────────────┐                               │
│  │ 7. Temporal     │     │ 8. Docs &       │                               │
│  │    Reasoning    │     │    Polish       │                               │
│  └─────────────────┘     └─────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## TASK 1: Add User Opt-In Flag
**Priority**: CRITICAL | **Effort**: LOW | **Dependencies**: None

### Rationale
SHEEP must be opt-in before any real usage. Users must control their cognitive memory.

### Implementation Steps

#### Step 1.1: Add Config Schema
**File**: `src/config/types.ts`

Find the main config type and add:

```typescript
// Add to MoltbotConfig type
sheep?: {
  /** Enable SHEEP cognitive memory system */
  enabled?: boolean;
  /** Model for extraction (default: claude-3-5-sonnet-latest) */
  extractionModel?: string;
  /** Model for fast operations (default: claude-3-5-haiku-latest) */
  fastModel?: string;
  /** Auto-consolidation mode: 'disabled' | 'idle' | 'scheduled' */
  autoConsolidate?: 'disabled' | 'idle' | 'scheduled';
  /** Consolidation schedule (cron format, e.g., "0 3 * * *" for 3 AM daily) */
  consolidateSchedule?: string;
  /** Idle threshold in minutes before auto-consolidation (default: 120) */
  idleThresholdMinutes?: number;
};
```

#### Step 1.2: Add Config Commands
**File**: `src/cli/config-cli.ts` (or appropriate config command file)

Add these config paths:
- `sheep.enabled` (boolean)
- `sheep.extractionModel` (string)
- `sheep.fastModel` (string)
- `sheep.autoConsolidate` (string enum)
- `sheep.consolidateSchedule` (string)
- `sheep.idleThresholdMinutes` (number)

#### Step 1.3: Gate SHEEP Integration
**File**: `src/sheep/integration/moltbot-bridge.ts`

Modify `prefetchMemoriesForMessage` and `learnFromAgentTurn`:

```typescript
export async function prefetchMemoriesForMessage(
  agentId: string,
  config: MoltbotConfig,
  userMessage: string
): Promise<MemoryContext> {
  // Check if SHEEP is enabled
  if (!config.sheep?.enabled) {
    return {
      systemPromptAddition: "",
      memoryCount: 0,
      memoryTypes: [],
    };
  }
  
  // ... existing implementation
}

export async function learnFromAgentTurn(
  agentId: string,
  config: MoltbotConfig,
  sessionId: string,
  messages: unknown[]
): Promise<void> {
  // Check if SHEEP is enabled
  if (!config.sheep?.enabled) {
    return;
  }
  
  // ... existing implementation
}
```

#### Step 1.4: Add CLI Enable Command
**File**: `src/cli/sheep-cli.ts`

Add a convenience command:

```typescript
sheep
  .command("enable")
  .description("Enable SHEEP cognitive memory")
  .action(async () => {
    // Use existing config set mechanism
    // Equivalent to: moltbot config set sheep.enabled true
    await setConfigValue("sheep.enabled", true);
    defaultRuntime.log("🐑 SHEEP AI enabled. Run 'moltbot sheep status' to verify.");
  });

sheep
  .command("disable")
  .description("Disable SHEEP cognitive memory")
  .action(async () => {
    await setConfigValue("sheep.enabled", false);
    defaultRuntime.log("🐑 SHEEP AI disabled.");
  });
```

### Acceptance Criteria
- [ ] `moltbot config set sheep.enabled true` works
- [ ] `moltbot sheep enable` / `moltbot sheep disable` work
- [ ] Prefetch returns empty when disabled
- [ ] Learning skips when disabled
- [ ] `moltbot sheep status` shows enabled/disabled state

---

## TASK 2: Add Prefetch Timing Metrics
**Priority**: CRITICAL | **Effort**: LOW | **Dependencies**: Task 1

### Rationale
Must verify <100ms latency target before claiming prefetch is production-ready.

### Implementation Steps

#### Step 2.1: Enhance Prefetch Metrics
**File**: `src/sheep/metrics/metrics.ts`

Add detailed timing breakdown:

```typescript
export type PrefetchTimingBreakdown = {
  /** Total prefetch time */
  totalMs: number;
  /** Time to classify intent */
  intentClassificationMs: number;
  /** Time to extract entities */
  entityExtractionMs: number;
  /** Time to query database */
  dbQueryMs: number;
  /** Time for semantic search (if used) */
  semanticSearchMs?: number;
  /** Whether we met the <100ms target */
  metLatencyTarget: boolean;
};

export type EnhancedPrefetchMetrics = PrefetchMetrics & {
  timing: PrefetchTimingBreakdown;
};

// Add tracking for latency distribution
const latencyBuckets = {
  under50ms: 0,
  under100ms: 0,
  under200ms: 0,
  under500ms: 0,
  over500ms: 0,
};

export function recordPrefetchWithTiming(metrics: EnhancedPrefetchMetrics): void {
  recordPrefetch(metrics);
  
  // Track latency distribution
  const ms = metrics.timing.totalMs;
  if (ms < 50) latencyBuckets.under50ms++;
  else if (ms < 100) latencyBuckets.under100ms++;
  else if (ms < 200) latencyBuckets.under200ms++;
  else if (ms < 500) latencyBuckets.under500ms++;
  else latencyBuckets.over500ms++;
}

export function getLatencyDistribution() {
  return { ...latencyBuckets };
}

export function getP50P95P99Latency(): { p50: number; p95: number; p99: number } {
  // Calculate from stored metrics
  const times = prefetchMetrics.map(m => m.durationMs).sort((a, b) => a - b);
  if (times.length === 0) return { p50: 0, p95: 0, p99: 0 };
  
  const p50Idx = Math.floor(times.length * 0.5);
  const p95Idx = Math.floor(times.length * 0.95);
  const p99Idx = Math.floor(times.length * 0.99);
  
  return {
    p50: times[p50Idx] || 0,
    p95: times[p95Idx] || 0,
    p99: times[p99Idx] || 0,
  };
}
```

#### Step 2.2: Instrument Prefetch Path
**File**: `src/sheep/integration/moltbot-bridge.ts`

Add timing instrumentation to `prefetchMemories`:

```typescript
async prefetchMemories(userMessage: string): Promise<PrefetchedMemories> {
  const totalStart = Date.now();
  const timing: Partial<PrefetchTimingBreakdown> = {};

  if (!shouldPrefetch(userMessage)) {
    // ... existing skip logic with timing
    return { ... };
  }

  await this.initialize();

  // Time intent classification
  const intentStart = Date.now();
  const prediction = analyzePrefetchNeeds(userMessage);
  timing.intentClassificationMs = Date.now() - intentStart;

  // Time entity extraction (included in analyzePrefetchNeeds, but track separately if needed)
  timing.entityExtractionMs = 0; // Already done in analyzePrefetchNeeds

  // Time database queries
  const dbStart = Date.now();
  let facts: Fact[] = [];
  let episodes: Episode[] = [];
  const causalLinks: CausalLink[] = [];

  for (const entity of prediction.intent.entities) {
    facts.push(...this.db.findFacts({ subject: entity }));
    facts.push(...this.db.findFacts({ object: entity }));
  }
  episodes = this.db.queryEpisodes({ limit: 5 });
  timing.dbQueryMs = Date.now() - dbStart;

  // Deduplicate
  facts = [...new Map(facts.map((f) => [f.id, f])).values()];
  episodes = [...new Map(episodes.map((e) => [e.id, e])).values()];

  timing.totalMs = Date.now() - totalStart;
  timing.metLatencyTarget = timing.totalMs < 100;

  // Record enhanced metrics
  recordPrefetchWithTiming({
    timestamp: Date.now(),
    agentId: this.config.agentId,
    hadMemories: facts.length > 0 || episodes.length > 0,
    factsCount: facts.length,
    episodesCount: episodes.length,
    durationMs: timing.totalMs,
    intentType: prediction.intent.intentType,
    entities: prediction.intent.entities,
    timing: timing as PrefetchTimingBreakdown,
  });

  // Warn if latency target missed
  if (!timing.metLatencyTarget) {
    log.warn("SHEEP prefetch exceeded 100ms target", {
      totalMs: timing.totalMs,
      breakdown: timing,
    });
  }

  return {
    facts,
    episodes,
    causalLinks,
    skipped: false,
    durationMs: timing.totalMs,
  };
}
```

#### Step 2.3: Add Latency to Status Command
**File**: `src/cli/sheep-cli.ts`

Enhance `runSheepStatus` to show latency stats:

```typescript
// In runSheepStatus, add:
const latencyStats = getP50P95P99Latency();
const latencyDist = getLatencyDistribution();

const lines = [
  // ... existing lines ...
  "",
  `${heading("Prefetch Latency")}`,
  `  ${label("P50")} ${latencyStats.p50 < 100 ? success(latencyStats.p50 + "ms") : warn(latencyStats.p50 + "ms")}`,
  `  ${label("P95")} ${latencyStats.p95 < 100 ? success(latencyStats.p95 + "ms") : warn(latencyStats.p95 + "ms")}`,
  `  ${label("P99")} ${latencyStats.p99 < 100 ? success(latencyStats.p99 + "ms") : warn(latencyStats.p99 + "ms")}`,
  `  ${label("<100ms")} ${muted(`${latencyDist.under50ms + latencyDist.under100ms} requests`)}`,
  `  ${label(">100ms")} ${latencyDist.under200ms + latencyDist.under500ms + latencyDist.over500ms > 0 ? warn(String(latencyDist.under200ms + latencyDist.under500ms + latencyDist.over500ms)) : success("0")} ${muted("requests")}`,
];
```

### Acceptance Criteria
- [ ] `moltbot sheep status` shows P50/P95/P99 latency
- [ ] Timing breakdown captured for each prefetch
- [ ] Warning logged when >100ms
- [ ] Latency distribution tracked

---

## TASK 3: Create Golden Test Dataset
**Priority**: HIGH | **Effort**: MEDIUM | **Dependencies**: None

### Rationale
Cannot measure accuracy without ground truth. Need hand-labeled data.

### Implementation Steps

#### Step 3.1: Create Dataset Structure
**File**: `src/sheep/tests/fixtures/golden-dataset.ts`

```typescript
/**
 * Golden test dataset for SHEEP extraction accuracy measurement.
 * Each entry is a hand-labeled conversation with expected extractions.
 */

export type GoldenTestCase = {
  id: string;
  /** Raw conversation text (simulating session content) */
  conversation: string;
  /** Expected facts to be extracted */
  expectedFacts: Array<{
    subject: string;
    predicate: string;
    object: string;
    /** Is this a required extraction or optional? */
    required: boolean;
  }>;
  /** Expected causal links */
  expectedCausalLinks: Array<{
    cause: string;
    effect: string;
    mechanism?: string;
    required: boolean;
  }>;
  /** Expected episode summary keywords */
  expectedKeywords: string[];
  /** Test category for reporting */
  category: 'user_info' | 'preferences' | 'work' | 'technical' | 'causal' | 'temporal';
};

export const GOLDEN_DATASET: GoldenTestCase[] = [
  // ===== USER INFORMATION =====
  {
    id: "user-001",
    conversation: `User: Hi! My name is Alex Chen and I work at TechCorp as a senior engineer.
Assistant: Nice to meet you, Alex! What kind of engineering work do you do at TechCorp?
User: Mostly backend stuff. I've been there for about 3 years now.`,
    expectedFacts: [
      { subject: "user", predicate: "has_name", object: "Alex Chen", required: true },
      { subject: "user", predicate: "works_at", object: "TechCorp", required: true },
      { subject: "user", predicate: "is_a", object: "senior engineer", required: true },
      { subject: "user", predicate: "works_on", object: "backend", required: false },
      { subject: "user", predicate: "tenure", object: "3 years", required: false },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["name", "work", "engineer", "TechCorp"],
    category: "user_info",
  },
  {
    id: "user-002",
    conversation: `User: I live in San Francisco but I'm originally from Seattle.
Assistant: Great cities! How long have you been in SF?
User: About 5 years now. Moved here for the job.`,
    expectedFacts: [
      { subject: "user", predicate: "lives_in", object: "San Francisco", required: true },
      { subject: "user", predicate: "from", object: "Seattle", required: true },
      { subject: "user", predicate: "time_in_sf", object: "5 years", required: false },
    ],
    expectedCausalLinks: [
      { cause: "job opportunity", effect: "moved to San Francisco", required: false },
    ],
    expectedKeywords: ["San Francisco", "Seattle", "move"],
    category: "user_info",
  },
  
  // ===== PREFERENCES =====
  {
    id: "pref-001",
    conversation: `User: I really prefer TypeScript over JavaScript. The type safety is worth it.
Assistant: I agree, TypeScript's type system catches a lot of bugs early.
User: Exactly! I also like using Bun instead of Node for the speed.`,
    expectedFacts: [
      { subject: "user", predicate: "prefers", object: "TypeScript", required: true },
      { subject: "user", predicate: "prefers", object: "Bun", required: true },
      { subject: "user", predicate: "values", object: "type safety", required: false },
    ],
    expectedCausalLinks: [
      { cause: "type safety", effect: "prefers TypeScript", mechanism: "catches bugs early", required: true },
      { cause: "speed", effect: "prefers Bun over Node", required: false },
    ],
    expectedKeywords: ["TypeScript", "JavaScript", "Bun", "type safety"],
    category: "preferences",
  },
  {
    id: "pref-002",
    conversation: `User: I hate using Jira. It's so slow and clunky.
Assistant: Many developers feel that way. Do you use something else?
User: We switched to Linear last month and it's so much better.`,
    expectedFacts: [
      { subject: "user", predicate: "dislikes", object: "Jira", required: true },
      { subject: "user", predicate: "uses", object: "Linear", required: true },
    ],
    expectedCausalLinks: [
      { cause: "Jira being slow and clunky", effect: "switched to Linear", required: true },
    ],
    expectedKeywords: ["Jira", "Linear", "switched"],
    category: "preferences",
  },
  
  // ===== WORK/PROJECTS =====
  {
    id: "work-001",
    conversation: `User: I'm working on a new project called Moltbot. It's a personal AI assistant.
Assistant: Sounds interesting! What technologies are you using?
User: It's built with TypeScript, uses SQLite for storage, and connects to multiple LLM providers.`,
    expectedFacts: [
      { subject: "user", predicate: "working_on", object: "Moltbot", required: true },
      { subject: "Moltbot", predicate: "is_a", object: "personal AI assistant", required: true },
      { subject: "Moltbot", predicate: "uses", object: "TypeScript", required: true },
      { subject: "Moltbot", predicate: "uses", object: "SQLite", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["Moltbot", "AI", "TypeScript", "SQLite"],
    category: "work",
  },
  {
    id: "work-002",
    conversation: `User: The deadline for the API redesign is next Friday. We need to finish the authentication module first.
Assistant: That's tight. What's blocking the auth module?
User: We're waiting on the security review. Once that's done, we can merge.`,
    expectedFacts: [
      { subject: "API redesign", predicate: "deadline", object: "next Friday", required: true },
      { subject: "authentication module", predicate: "status", object: "in progress", required: false },
    ],
    expectedCausalLinks: [
      { cause: "security review pending", effect: "auth module blocked", required: true },
      { cause: "auth module completion", effect: "can proceed with API redesign", required: false },
    ],
    expectedKeywords: ["deadline", "API", "authentication", "security review"],
    category: "work",
  },
  
  // ===== TECHNICAL =====
  {
    id: "tech-001",
    conversation: `User: The database query is taking too long. It's doing a full table scan.
Assistant: Have you checked if there's an index on the query columns?
User: Good point. I added an index on user_id and the query went from 2s to 50ms.`,
    expectedFacts: [
      { subject: "database", predicate: "had_issue", object: "full table scan", required: false },
      { subject: "solution", predicate: "was", object: "add index on user_id", required: true },
    ],
    expectedCausalLinks: [
      { cause: "added index on user_id", effect: "query time reduced from 2s to 50ms", mechanism: "eliminated full table scan", required: true },
    ],
    expectedKeywords: ["database", "index", "query", "performance"],
    category: "technical",
  },
  {
    id: "tech-002",
    conversation: `User: We're getting rate limited by the OpenAI API. Too many requests.
Assistant: You might want to implement request batching or add a queue.
User: Yeah, I added a rate limiter with exponential backoff and it fixed the issue.`,
    expectedFacts: [
      { subject: "project", predicate: "uses", object: "OpenAI API", required: true },
      { subject: "solution", predicate: "was", object: "rate limiter with exponential backoff", required: true },
    ],
    expectedCausalLinks: [
      { cause: "too many requests", effect: "rate limited by OpenAI API", required: true },
      { cause: "added rate limiter with exponential backoff", effect: "fixed rate limiting issue", required: true },
    ],
    expectedKeywords: ["rate limit", "OpenAI", "backoff"],
    category: "technical",
  },
  
  // ===== CAUSAL REASONING =====
  {
    id: "causal-001",
    conversation: `User: The deployment failed because the environment variable wasn't set.
Assistant: Ah, that's a common gotcha. Did you fix it?
User: Yes, I added it to the .env file and redeployed. Works now.`,
    expectedFacts: [],
    expectedCausalLinks: [
      { cause: "environment variable not set", effect: "deployment failed", required: true },
      { cause: "added env variable and redeployed", effect: "deployment works", required: true },
    ],
    expectedKeywords: ["deployment", "environment variable", "failed"],
    category: "causal",
  },
  {
    id: "causal-002",
    conversation: `User: After switching from REST to GraphQL, our mobile app's battery usage improved significantly.
Assistant: That makes sense - you're probably fetching only the data you need now.
User: Exactly. We reduced the number of API calls by 60% since we can batch queries.`,
    expectedFacts: [
      { subject: "project", predicate: "uses", object: "GraphQL", required: true },
    ],
    expectedCausalLinks: [
      { cause: "switched to GraphQL", effect: "mobile app battery usage improved", required: true },
      { cause: "GraphQL allows batching queries", effect: "reduced API calls by 60%", required: true },
    ],
    expectedKeywords: ["GraphQL", "REST", "battery", "API calls"],
    category: "causal",
  },
  
  // ===== TEMPORAL =====
  {
    id: "temp-001",
    conversation: `User: Remember last week when we discussed the database migration?
Assistant: Yes, you were concerned about downtime.
User: Right. Well, we did it yesterday and it only took 30 minutes with zero downtime.`,
    expectedFacts: [
      { subject: "database migration", predicate: "completed", object: "yesterday", required: true },
      { subject: "database migration", predicate: "duration", object: "30 minutes", required: false },
      { subject: "database migration", predicate: "downtime", object: "zero", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["database", "migration", "downtime"],
    category: "temporal",
  },
  
  // Add 40+ more test cases covering edge cases, negations, corrections, etc.
  // ... (expand to 50+ total)
];

// Categories for filtering
export const DATASET_CATEGORIES = [
  'user_info',
  'preferences', 
  'work',
  'technical',
  'causal',
  'temporal',
] as const;

export function getTestCasesByCategory(category: typeof DATASET_CATEGORIES[number]): GoldenTestCase[] {
  return GOLDEN_DATASET.filter(tc => tc.category === category);
}

export function getDatasetStats() {
  return {
    total: GOLDEN_DATASET.length,
    byCategory: Object.fromEntries(
      DATASET_CATEGORIES.map(cat => [cat, getTestCasesByCategory(cat).length])
    ),
    totalExpectedFacts: GOLDEN_DATASET.reduce((sum, tc) => sum + tc.expectedFacts.length, 0),
    totalExpectedCausalLinks: GOLDEN_DATASET.reduce((sum, tc) => sum + tc.expectedCausalLinks.length, 0),
  };
}
```

#### Step 3.2: Create More Test Cases
Expand the dataset to 50+ cases. Include:
- Edge cases (negations: "I don't like X")
- Corrections ("Actually, I meant Y not X")
- Ambiguous statements
- Multi-turn context-dependent facts
- Non-English names and places
- Technical jargon

### Acceptance Criteria
- [ ] 50+ test cases in golden dataset
- [ ] All 6 categories covered
- [ ] Each test case has expected facts and causal links
- [ ] Dataset stats function works

---

## TASK 4: Measure LLM Extraction Accuracy
**Priority**: CRITICAL | **Effort**: MEDIUM | **Dependencies**: Task 3

### Rationale
Must know actual extraction accuracy to validate system. Target: >85% fact recall, >70% causal accuracy.

### Implementation Steps

#### Step 4.1: Create Accuracy Measurement Module
**File**: `src/sheep/tests/accuracy/extraction-accuracy.ts`

```typescript
/**
 * SHEEP AI - Extraction Accuracy Measurement
 * 
 * Compares LLM extraction results against golden dataset.
 */

import type { Fact, CausalLink } from "../../memory/schema.js";
import type { GoldenTestCase } from "../fixtures/golden-dataset.js";
import { GOLDEN_DATASET, DATASET_CATEGORIES, getDatasetStats } from "../fixtures/golden-dataset.js";
import { extractFactsWithLLM, extractCausalLinksWithLLM, createSheepLLMProvider } from "../../extraction/llm-extractor.js";

// =============================================================================
// TYPES
// =============================================================================

export type FactMatchResult = {
  expected: GoldenTestCase["expectedFacts"][0];
  matched: boolean;
  matchedFact?: Omit<Fact, "id" | "createdAt" | "updatedAt">;
  similarity: number;
};

export type CausalMatchResult = {
  expected: GoldenTestCase["expectedCausalLinks"][0];
  matched: boolean;
  matchedLink?: Omit<CausalLink, "id" | "createdAt" | "updatedAt">;
  similarity: number;
};

export type TestCaseResult = {
  testCaseId: string;
  category: string;
  
  factResults: {
    expected: number;
    extracted: number;
    matched: number;
    precision: number;
    recall: number;
    f1: number;
    details: FactMatchResult[];
  };
  
  causalResults: {
    expected: number;
    extracted: number;
    matched: number;
    precision: number;
    recall: number;
    f1: number;
    details: CausalMatchResult[];
  };
  
  extractionTimeMs: number;
  error?: string;
};

export type AccuracyReport = {
  timestamp: string;
  model: string;
  
  overall: {
    factPrecision: number;
    factRecall: number;
    factF1: number;
    causalPrecision: number;
    causalRecall: number;
    causalF1: number;
    meetsTargets: boolean;
  };
  
  byCategory: Record<string, {
    count: number;
    factF1: number;
    causalF1: number;
  }>;
  
  testCases: TestCaseResult[];
  
  summary: {
    totalTestCases: number;
    totalExpectedFacts: number;
    totalExtractedFacts: number;
    totalMatchedFacts: number;
    totalExpectedCausal: number;
    totalExtractedCausal: number;
    totalMatchedCausal: number;
    totalTimeMs: number;
    avgTimePerCase: number;
  };
};

// =============================================================================
// MATCHING LOGIC
// =============================================================================

/**
 * Check if an extracted fact matches an expected fact.
 * Uses fuzzy matching on subject, predicate, object.
 */
function matchFact(
  expected: GoldenTestCase["expectedFacts"][0],
  extracted: Omit<Fact, "id" | "createdAt" | "updatedAt">[]
): FactMatchResult {
  let bestMatch: Omit<Fact, "id" | "createdAt" | "updatedAt"> | undefined;
  let bestSimilarity = 0;
  
  for (const fact of extracted) {
    const subjectSim = fuzzyMatch(expected.subject, fact.subject);
    const predicateSim = fuzzyMatch(expected.predicate, fact.predicate);
    const objectSim = fuzzyMatch(expected.object, fact.object);
    
    // Weighted similarity: object matters most
    const similarity = (subjectSim * 0.2) + (predicateSim * 0.3) + (objectSim * 0.5);
    
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = fact;
    }
  }
  
  // Threshold for considering it a match
  const isMatch = bestSimilarity >= 0.7;
  
  return {
    expected,
    matched: isMatch,
    matchedFact: isMatch ? bestMatch : undefined,
    similarity: bestSimilarity,
  };
}

/**
 * Check if an extracted causal link matches an expected one.
 */
function matchCausalLink(
  expected: GoldenTestCase["expectedCausalLinks"][0],
  extracted: Omit<CausalLink, "id" | "createdAt" | "updatedAt">[]
): CausalMatchResult {
  let bestMatch: Omit<CausalLink, "id" | "createdAt" | "updatedAt"> | undefined;
  let bestSimilarity = 0;
  
  for (const link of extracted) {
    const causeSim = fuzzyMatch(expected.cause, link.causeDescription);
    const effectSim = fuzzyMatch(expected.effect, link.effectDescription);
    
    // Weighted similarity
    const similarity = (causeSim * 0.5) + (effectSim * 0.5);
    
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = link;
    }
  }
  
  const isMatch = bestSimilarity >= 0.6; // Lower threshold for causal (harder to extract)
  
  return {
    expected,
    matched: isMatch,
    matchedLink: isMatch ? bestMatch : undefined,
    similarity: bestSimilarity,
  };
}

/**
 * Fuzzy string matching (0-1)
 */
function fuzzyMatch(a: string, b: string): number {
  const aNorm = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const bNorm = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  if (aNorm === bNorm) return 1;
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.9;
  
  // Simple character overlap
  const aChars = new Set(aNorm.split(""));
  const bChars = new Set(bNorm.split(""));
  const intersection = [...aChars].filter(c => bChars.has(c)).length;
  const union = new Set([...aChars, ...bChars]).size;
  
  return union > 0 ? intersection / union : 0;
}

// =============================================================================
// MAIN ACCURACY MEASUREMENT
// =============================================================================

/**
 * Run accuracy measurement on the golden dataset
 */
export async function measureExtractionAccuracy(options: {
  /** Model to test (default: claude-3-5-sonnet-latest) */
  model?: string;
  /** Categories to test (default: all) */
  categories?: typeof DATASET_CATEGORIES[number][];
  /** Max test cases to run (for quick testing) */
  limit?: number;
  /** Verbose logging */
  verbose?: boolean;
}): Promise<AccuracyReport> {
  const model = options.model ?? "claude-3-5-sonnet-latest";
  const llm = await createSheepLLMProvider("extraction", { extractionModel: model });
  
  let testCases = GOLDEN_DATASET;
  if (options.categories && options.categories.length > 0) {
    testCases = testCases.filter(tc => options.categories!.includes(tc.category as any));
  }
  if (options.limit) {
    testCases = testCases.slice(0, options.limit);
  }
  
  const results: TestCaseResult[] = [];
  const startTime = Date.now();
  
  for (const testCase of testCases) {
    if (options.verbose) {
      console.log(`Testing: ${testCase.id} (${testCase.category})`);
    }
    
    const caseStart = Date.now();
    let result: TestCaseResult;
    
    try {
      // Extract facts
      const extractedFacts = await extractFactsWithLLM(llm, testCase.conversation, "test-episode");
      
      // Extract causal links
      const extractedCausal = await extractCausalLinksWithLLM(llm, testCase.conversation, "test-episode");
      
      // Match facts
      const factMatches = testCase.expectedFacts.map(exp => matchFact(exp, extractedFacts));
      const matchedFacts = factMatches.filter(m => m.matched).length;
      const factPrecision = extractedFacts.length > 0 ? matchedFacts / extractedFacts.length : 1;
      const factRecall = testCase.expectedFacts.length > 0 ? matchedFacts / testCase.expectedFacts.length : 1;
      const factF1 = factPrecision + factRecall > 0 
        ? (2 * factPrecision * factRecall) / (factPrecision + factRecall) 
        : 0;
      
      // Match causal links
      const causalMatches = testCase.expectedCausalLinks.map(exp => matchCausalLink(exp, extractedCausal));
      const matchedCausal = causalMatches.filter(m => m.matched).length;
      const causalPrecision = extractedCausal.length > 0 ? matchedCausal / extractedCausal.length : 1;
      const causalRecall = testCase.expectedCausalLinks.length > 0 ? matchedCausal / testCase.expectedCausalLinks.length : 1;
      const causalF1 = causalPrecision + causalRecall > 0
        ? (2 * causalPrecision * causalRecall) / (causalPrecision + causalRecall)
        : 0;
      
      result = {
        testCaseId: testCase.id,
        category: testCase.category,
        factResults: {
          expected: testCase.expectedFacts.length,
          extracted: extractedFacts.length,
          matched: matchedFacts,
          precision: factPrecision,
          recall: factRecall,
          f1: factF1,
          details: factMatches,
        },
        causalResults: {
          expected: testCase.expectedCausalLinks.length,
          extracted: extractedCausal.length,
          matched: matchedCausal,
          precision: causalPrecision,
          recall: causalRecall,
          f1: causalF1,
          details: causalMatches,
        },
        extractionTimeMs: Date.now() - caseStart,
      };
    } catch (err) {
      result = {
        testCaseId: testCase.id,
        category: testCase.category,
        factResults: { expected: 0, extracted: 0, matched: 0, precision: 0, recall: 0, f1: 0, details: [] },
        causalResults: { expected: 0, extracted: 0, matched: 0, precision: 0, recall: 0, f1: 0, details: [] },
        extractionTimeMs: Date.now() - caseStart,
        error: String(err),
      };
    }
    
    results.push(result);
    
    if (options.verbose) {
      console.log(`  Facts: P=${result.factResults.precision.toFixed(2)} R=${result.factResults.recall.toFixed(2)} F1=${result.factResults.f1.toFixed(2)}`);
      console.log(`  Causal: P=${result.causalResults.precision.toFixed(2)} R=${result.causalResults.recall.toFixed(2)} F1=${result.causalResults.f1.toFixed(2)}`);
    }
  }
  
  // Calculate overall metrics
  const totalExpectedFacts = results.reduce((sum, r) => sum + r.factResults.expected, 0);
  const totalExtractedFacts = results.reduce((sum, r) => sum + r.factResults.extracted, 0);
  const totalMatchedFacts = results.reduce((sum, r) => sum + r.factResults.matched, 0);
  
  const totalExpectedCausal = results.reduce((sum, r) => sum + r.causalResults.expected, 0);
  const totalExtractedCausal = results.reduce((sum, r) => sum + r.causalResults.extracted, 0);
  const totalMatchedCausal = results.reduce((sum, r) => sum + r.causalResults.matched, 0);
  
  const overallFactPrecision = totalExtractedFacts > 0 ? totalMatchedFacts / totalExtractedFacts : 1;
  const overallFactRecall = totalExpectedFacts > 0 ? totalMatchedFacts / totalExpectedFacts : 1;
  const overallFactF1 = overallFactPrecision + overallFactRecall > 0
    ? (2 * overallFactPrecision * overallFactRecall) / (overallFactPrecision + overallFactRecall)
    : 0;
  
  const overallCausalPrecision = totalExtractedCausal > 0 ? totalMatchedCausal / totalExtractedCausal : 1;
  const overallCausalRecall = totalExpectedCausal > 0 ? totalMatchedCausal / totalExpectedCausal : 1;
  const overallCausalF1 = overallCausalPrecision + overallCausalRecall > 0
    ? (2 * overallCausalPrecision * overallCausalRecall) / (overallCausalPrecision + overallCausalRecall)
    : 0;
  
  // By category
  const byCategory: AccuracyReport["byCategory"] = {};
  for (const cat of DATASET_CATEGORIES) {
    const catResults = results.filter(r => r.category === cat);
    if (catResults.length > 0) {
      byCategory[cat] = {
        count: catResults.length,
        factF1: catResults.reduce((sum, r) => sum + r.factResults.f1, 0) / catResults.length,
        causalF1: catResults.reduce((sum, r) => sum + r.causalResults.f1, 0) / catResults.length,
      };
    }
  }
  
  const totalTimeMs = Date.now() - startTime;
  
  return {
    timestamp: new Date().toISOString(),
    model,
    overall: {
      factPrecision: overallFactPrecision,
      factRecall: overallFactRecall,
      factF1: overallFactF1,
      causalPrecision: overallCausalPrecision,
      causalRecall: overallCausalRecall,
      causalF1: overallCausalF1,
      meetsTargets: overallFactRecall >= 0.85 && overallCausalF1 >= 0.70,
    },
    byCategory,
    testCases: results,
    summary: {
      totalTestCases: results.length,
      totalExpectedFacts,
      totalExtractedFacts,
      totalMatchedFacts,
      totalExpectedCausal,
      totalExtractedCausal,
      totalMatchedCausal,
      totalTimeMs,
      avgTimePerCase: totalTimeMs / results.length,
    },
  };
}

/**
 * Format accuracy report for display
 */
export function formatAccuracyReport(report: AccuracyReport): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════════════════",
    "           SHEEP AI - EXTRACTION ACCURACY REPORT                   ",
    "═══════════════════════════════════════════════════════════════════",
    "",
    `Model: ${report.model}`,
    `Timestamp: ${report.timestamp}`,
    `Test Cases: ${report.summary.totalTestCases}`,
    "",
    "OVERALL RESULTS",
    "───────────────────────────────────────────────────────────────────",
    `Fact Extraction:`,
    `  Precision: ${(report.overall.factPrecision * 100).toFixed(1)}%`,
    `  Recall:    ${(report.overall.factRecall * 100).toFixed(1)}%  ${report.overall.factRecall >= 0.85 ? "✅ (target: 85%)" : "❌ (target: 85%)"}`,
    `  F1 Score:  ${(report.overall.factF1 * 100).toFixed(1)}%`,
    "",
    `Causal Link Extraction:`,
    `  Precision: ${(report.overall.causalPrecision * 100).toFixed(1)}%`,
    `  Recall:    ${(report.overall.causalRecall * 100).toFixed(1)}%`,
    `  F1 Score:  ${(report.overall.causalF1 * 100).toFixed(1)}%  ${report.overall.causalF1 >= 0.70 ? "✅ (target: 70%)" : "❌ (target: 70%)"}`,
    "",
    `Meets Targets: ${report.overall.meetsTargets ? "✅ YES" : "❌ NO"}`,
    "",
    "BY CATEGORY",
    "───────────────────────────────────────────────────────────────────",
  ];
  
  for (const [cat, stats] of Object.entries(report.byCategory)) {
    lines.push(`  ${cat}: ${stats.count} cases, Fact F1=${(stats.factF1 * 100).toFixed(0)}%, Causal F1=${(stats.causalF1 * 100).toFixed(0)}%`);
  }
  
  lines.push("");
  lines.push("SUMMARY");
  lines.push("───────────────────────────────────────────────────────────────────");
  lines.push(`Expected Facts: ${report.summary.totalExpectedFacts}, Extracted: ${report.summary.totalExtractedFacts}, Matched: ${report.summary.totalMatchedFacts}`);
  lines.push(`Expected Causal: ${report.summary.totalExpectedCausal}, Extracted: ${report.summary.totalExtractedCausal}, Matched: ${report.summary.totalMatchedCausal}`);
  lines.push(`Total Time: ${report.summary.totalTimeMs}ms (avg ${report.summary.avgTimePerCase.toFixed(0)}ms/case)`);
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════════");
  
  return lines.join("\n");
}
```

#### Step 4.2: Add CLI Command
**File**: `src/cli/sheep-cli.ts`

```typescript
sheep
  .command("accuracy")
  .description("Run extraction accuracy measurement against golden dataset")
  .option("--model <model>", "Model to test (default: claude-3-5-sonnet-latest)")
  .option("--category <cat>", "Test specific category only")
  .option("--limit <n>", "Limit number of test cases", (v) => parseInt(v, 10))
  .option("--json", "Output JSON")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    const { measureExtractionAccuracy, formatAccuracyReport } = await import("../sheep/tests/accuracy/extraction-accuracy.js");
    
    const report = await measureExtractionAccuracy({
      model: opts.model,
      categories: opts.category ? [opts.category] : undefined,
      limit: opts.limit,
      verbose: opts.verbose,
    });
    
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatAccuracyReport(report));
    }
  });
```

### Acceptance Criteria
- [ ] `moltbot sheep accuracy` runs and produces report
- [ ] Report shows precision/recall/F1 for facts and causal links
- [ ] Report shows category breakdown
- [ ] Target metrics clearly indicated (pass/fail)

---

## TASK 5: Implement Auto-Consolidation
**Priority**: HIGH | **Effort**: MEDIUM | **Dependencies**: Task 1

### Rationale
Consolidation must run automatically for SHEEP to work without user intervention.

### Implementation Steps

#### Step 5.1: Create Consolidation Scheduler
**File**: `src/sheep/consolidation/scheduler.ts`

```typescript
/**
 * SHEEP AI - Auto-Consolidation Scheduler
 * 
 * Triggers consolidation based on:
 * - Idle time (no activity for X minutes)
 * - Scheduled time (cron-like)
 * - Manual trigger
 */

import type { MoltbotConfig } from "../../config/config.js";
import { runConsolidation } from "./consolidator.js";
import { isAgentIdle, getIdleAgents } from "../integration/moltbot-bridge.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

export type ConsolidationMode = "disabled" | "idle" | "scheduled";

export type SchedulerConfig = {
  mode: ConsolidationMode;
  /** Idle threshold in milliseconds (default: 2 hours) */
  idleThresholdMs?: number;
  /** Cron schedule (e.g., "0 3 * * *" for 3 AM daily) */
  cronSchedule?: string;
  /** Minimum time between consolidations (default: 1 hour) */
  minIntervalMs?: number;
};

// =============================================================================
// STATE
// =============================================================================

/** Last consolidation timestamp per agent */
const lastConsolidationTime = new Map<string, number>();

/** Scheduled timeout handles */
const scheduledTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/** Idle check interval handle */
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;

// =============================================================================
// IDLE-BASED CONSOLIDATION
// =============================================================================

/**
 * Start idle-based consolidation monitoring
 */
export function startIdleConsolidation(
  config: MoltbotConfig,
  options: {
    idleThresholdMs?: number;
    minIntervalMs?: number;
    checkIntervalMs?: number;
  } = {}
): void {
  const idleThresholdMs = options.idleThresholdMs ?? 2 * 60 * 60 * 1000; // 2 hours
  const minIntervalMs = options.minIntervalMs ?? 60 * 60 * 1000; // 1 hour
  const checkIntervalMs = options.checkIntervalMs ?? 5 * 60 * 1000; // Check every 5 min
  
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
  }
  
  log.info("Starting SHEEP idle consolidation monitor", {
    idleThresholdMs,
    minIntervalMs,
    checkIntervalMs,
  });
  
  idleCheckInterval = setInterval(async () => {
    const idleAgents = getIdleAgents(idleThresholdMs);
    
    for (const agentId of idleAgents) {
      const lastRun = lastConsolidationTime.get(agentId) ?? 0;
      const timeSinceLastRun = Date.now() - lastRun;
      
      if (timeSinceLastRun >= minIntervalMs) {
        log.info("Triggering idle consolidation", { agentId });
        
        try {
          lastConsolidationTime.set(agentId, Date.now());
          
          const result = await runConsolidation({
            agentId,
            dryRun: false,
          });
          
          log.info("Idle consolidation complete", {
            agentId,
            ...result,
          });
        } catch (err) {
          log.error("Idle consolidation failed", {
            agentId,
            error: String(err),
          });
        }
      }
    }
  }, checkIntervalMs);
}

/**
 * Stop idle-based consolidation monitoring
 */
export function stopIdleConsolidation(): void {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
    log.info("Stopped SHEEP idle consolidation monitor");
  }
}

// =============================================================================
// SCHEDULED CONSOLIDATION
// =============================================================================

/**
 * Parse simple cron expression and return next run time.
 * Supports: "0 3 * * *" (3 AM daily), "0 */6 * * *" (every 6 hours)
 */
function getNextCronTime(cronExpr: string): Date {
  const parts = cronExpr.split(" ");
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }
  
  const [minute, hour] = parts;
  const now = new Date();
  const next = new Date(now);
  
  // Simple implementation: just handle "M H * * *" format
  const targetMinute = minute === "*" ? now.getMinutes() : parseInt(minute, 10);
  const targetHour = hour === "*" ? now.getHours() : parseInt(hour, 10);
  
  next.setMinutes(targetMinute);
  next.setSeconds(0);
  next.setMilliseconds(0);
  
  if (hour !== "*") {
    next.setHours(targetHour);
  }
  
  // If the time has passed today, schedule for tomorrow
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  
  return next;
}

/**
 * Schedule consolidation for an agent based on cron expression
 */
export function scheduleConsolidation(
  agentId: string,
  cronExpr: string,
  config: MoltbotConfig
): void {
  // Clear any existing schedule
  const existingTimeout = scheduledTimeouts.get(agentId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }
  
  const nextRunTime = getNextCronTime(cronExpr);
  const delayMs = nextRunTime.getTime() - Date.now();
  
  log.info("Scheduled SHEEP consolidation", {
    agentId,
    nextRun: nextRunTime.toISOString(),
    delayMs,
  });
  
  const timeout = setTimeout(async () => {
    log.info("Running scheduled consolidation", { agentId });
    
    try {
      const result = await runConsolidation({
        agentId,
        dryRun: false,
      });
      
      log.info("Scheduled consolidation complete", {
        agentId,
        ...result,
      });
    } catch (err) {
      log.error("Scheduled consolidation failed", {
        agentId,
        error: String(err),
      });
    }
    
    // Schedule next run
    scheduleConsolidation(agentId, cronExpr, config);
  }, delayMs);
  
  scheduledTimeouts.set(agentId, timeout);
}

/**
 * Cancel scheduled consolidation for an agent
 */
export function cancelScheduledConsolidation(agentId: string): void {
  const timeout = scheduledTimeouts.get(agentId);
  if (timeout) {
    clearTimeout(timeout);
    scheduledTimeouts.delete(agentId);
    log.info("Cancelled scheduled consolidation", { agentId });
  }
}

// =============================================================================
// MAIN SETUP
// =============================================================================

/**
 * Initialize auto-consolidation based on config
 */
export function initializeAutoConsolidation(
  agentId: string,
  config: MoltbotConfig
): void {
  const sheepConfig = config.sheep;
  if (!sheepConfig?.enabled) {
    return;
  }
  
  const mode = sheepConfig.autoConsolidate ?? "disabled";
  
  switch (mode) {
    case "idle":
      startIdleConsolidation(config, {
        idleThresholdMs: (sheepConfig.idleThresholdMinutes ?? 120) * 60 * 1000,
      });
      break;
    
    case "scheduled":
      if (sheepConfig.consolidateSchedule) {
        scheduleConsolidation(agentId, sheepConfig.consolidateSchedule, config);
      } else {
        // Default: 3 AM daily
        scheduleConsolidation(agentId, "0 3 * * *", config);
      }
      break;
    
    case "disabled":
    default:
      // No auto-consolidation
      break;
  }
}

/**
 * Shutdown all auto-consolidation
 */
export function shutdownAutoConsolidation(): void {
  stopIdleConsolidation();
  
  for (const [agentId] of scheduledTimeouts) {
    cancelScheduledConsolidation(agentId);
  }
}
```

#### Step 5.2: Wire into Gateway Startup
Find where the gateway/agent starts and call `initializeAutoConsolidation`.

### Acceptance Criteria
- [ ] `moltbot config set sheep.autoConsolidate idle` enables idle-based consolidation
- [ ] `moltbot config set sheep.autoConsolidate scheduled` enables cron-based
- [ ] `moltbot config set sheep.consolidateSchedule "0 3 * * *"` sets schedule
- [ ] Consolidation runs automatically when idle
- [ ] Logs show consolidation activity

---

## TASK 6: Add NER Enhancement
**Priority**: HIGH | **Effort**: HIGH | **Dependencies**: Task 4

### Rationale
Pattern-based extraction misses many entities. LLM-based NER will improve accuracy.

### Implementation Steps

#### Step 6.1: Create LLM-Based NER Module
**File**: `src/sheep/extraction/llm-ner.ts`

```typescript
/**
 * SHEEP AI - LLM-Based Named Entity Recognition
 * 
 * Uses Claude to extract named entities with types.
 * This supplements the pattern-based extraction with semantic understanding.
 */

import type { LLMProvider } from "./llm-extractor.js";

// =============================================================================
// TYPES
// =============================================================================

export type EntityType = 
  | "PERSON"        // People's names
  | "ORGANIZATION"  // Companies, teams, groups
  | "LOCATION"      // Places, cities, countries
  | "PROJECT"       // Software projects, products
  | "TECHNOLOGY"    // Languages, frameworks, tools
  | "DATE"          // Dates and times
  | "DURATION"      // Time periods
  | "QUANTITY"      // Numbers with units
  | "CONCEPT"       // Abstract concepts, preferences
  | "OTHER";

export type ExtractedNamedEntity = {
  text: string;
  type: EntityType;
  confidence: number;
  context: string;
};

export type NERResult = {
  entities: ExtractedNamedEntity[];
  extractionTimeMs: number;
};

// =============================================================================
// NER PROMPT
// =============================================================================

const NER_PROMPT = `You are an expert at Named Entity Recognition.

Extract all named entities from the following text. For each entity, provide:
1. The exact text of the entity
2. The entity type (PERSON, ORGANIZATION, LOCATION, PROJECT, TECHNOLOGY, DATE, DURATION, QUANTITY, CONCEPT, OTHER)
3. Your confidence (0.0-1.0)
4. Brief context (why you identified this entity)

Entity types:
- PERSON: Names of people (e.g., "Alex Chen", "my manager John")
- ORGANIZATION: Companies, teams, institutions (e.g., "TechCorp", "the DevOps team")
- LOCATION: Places, cities, countries (e.g., "San Francisco", "the office")
- PROJECT: Software projects, products (e.g., "Moltbot", "the API redesign")
- TECHNOLOGY: Languages, frameworks, tools, models (e.g., "TypeScript", "PostgreSQL", "Claude")
- DATE: Specific dates or relative references (e.g., "January 15", "yesterday")
- DURATION: Time periods (e.g., "3 years", "about 2 hours")
- QUANTITY: Numbers with meaning (e.g., "60%", "$500")
- CONCEPT: Preferences, values, abstract ideas (e.g., "type safety", "performance")
- OTHER: Entities that don't fit other categories

Output ONLY valid JSON:
{
  "entities": [
    {
      "text": "string",
      "type": "PERSON|ORGANIZATION|LOCATION|PROJECT|TECHNOLOGY|DATE|DURATION|QUANTITY|CONCEPT|OTHER",
      "confidence": 0.0-1.0,
      "context": "brief explanation"
    }
  ]
}

Text to analyze:
`;

// =============================================================================
// NER EXTRACTION
// =============================================================================

/**
 * Parse JSON from LLM response
 */
function parseJSON<T>(response: string): T | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    const cleaned = jsonStr.trim().replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    return JSON.parse(cleaned) as T;
  } catch {
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Extract named entities using LLM
 */
export async function extractNamedEntities(
  llm: LLMProvider,
  text: string
): Promise<NERResult> {
  const startTime = Date.now();
  
  const prompt = NER_PROMPT + text;
  
  const response = await llm.complete(prompt, {
    maxTokens: 2000,
    temperature: 0.1,
    jsonMode: true,
  });
  
  const parsed = parseJSON<{ entities: Array<{
    text: string;
    type: string;
    confidence: number;
    context: string;
  }> }>(response);
  
  if (!parsed?.entities) {
    return {
      entities: [],
      extractionTimeMs: Date.now() - startTime,
    };
  }
  
  const entities: ExtractedNamedEntity[] = parsed.entities.map(e => ({
    text: e.text,
    type: validateEntityType(e.type),
    confidence: Math.max(0, Math.min(1, e.confidence)),
    context: e.context,
  }));
  
  return {
    entities,
    extractionTimeMs: Date.now() - startTime,
  };
}

function validateEntityType(type: string): EntityType {
  const validTypes: EntityType[] = [
    "PERSON", "ORGANIZATION", "LOCATION", "PROJECT", "TECHNOLOGY",
    "DATE", "DURATION", "QUANTITY", "CONCEPT", "OTHER"
  ];
  
  const upper = type.toUpperCase();
  return validTypes.includes(upper as EntityType) ? upper as EntityType : "OTHER";
}

// =============================================================================
// INTEGRATION WITH FACT EXTRACTION
// =============================================================================

/**
 * Convert NER results to fact candidates
 */
export function nerToFactCandidates(
  nerResult: NERResult,
  contextSubject: string = "user"
): Array<{
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}> {
  const candidates: Array<{
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
  }> = [];
  
  for (const entity of nerResult.entities) {
    switch (entity.type) {
      case "PERSON":
        // Could be "user has_name X" or "user knows X"
        if (entity.context.toLowerCase().includes("name") || 
            entity.context.toLowerCase().includes("called") ||
            entity.context.toLowerCase().includes("i am")) {
          candidates.push({
            subject: contextSubject,
            predicate: "has_name",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;
      
      case "ORGANIZATION":
        if (entity.context.toLowerCase().includes("work")) {
          candidates.push({
            subject: contextSubject,
            predicate: "works_at",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;
      
      case "LOCATION":
        if (entity.context.toLowerCase().includes("live")) {
          candidates.push({
            subject: contextSubject,
            predicate: "lives_in",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (entity.context.toLowerCase().includes("from")) {
          candidates.push({
            subject: contextSubject,
            predicate: "from",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;
      
      case "TECHNOLOGY":
        if (entity.context.toLowerCase().includes("prefer") ||
            entity.context.toLowerCase().includes("like") ||
            entity.context.toLowerCase().includes("love")) {
          candidates.push({
            subject: contextSubject,
            predicate: "prefers",
            object: entity.text,
            confidence: entity.confidence,
          });
        } else if (entity.context.toLowerCase().includes("use")) {
          candidates.push({
            subject: contextSubject,
            predicate: "uses",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;
      
      case "PROJECT":
        if (entity.context.toLowerCase().includes("work")) {
          candidates.push({
            subject: contextSubject,
            predicate: "working_on",
            object: entity.text,
            confidence: entity.confidence,
          });
        }
        break;
      
      // Add more mappings as needed
    }
  }
  
  return candidates;
}
```

#### Step 6.2: Integrate NER into Extraction Pipeline
**File**: `src/sheep/extraction/llm-extractor.ts`

Add NER as an enhancement to fact extraction:

```typescript
import { extractNamedEntities, nerToFactCandidates } from "./llm-ner.js";

/**
 * Enhanced fact extraction using both direct extraction and NER
 */
export async function extractFactsWithLLMEnhanced(
  llm: LLMProvider,
  conversationText: string,
  episodeId: string
): Promise<Omit<Fact, "id" | "createdAt" | "updatedAt">[]> {
  // Run both extractions in parallel
  const [directFacts, nerResult] = await Promise.all([
    extractFactsWithLLM(llm, conversationText, episodeId),
    extractNamedEntities(llm, conversationText),
  ]);
  
  // Convert NER to fact candidates
  const nerFacts = nerToFactCandidates(nerResult).map(nf => ({
    ...nf,
    evidence: [episodeId],
    isActive: true,
    userAffirmed: false,
    accessCount: 0,
    firstSeen: now(),
    lastConfirmed: now(),
    contradictions: [],
  }));
  
  // Merge and deduplicate
  const allFacts = [...directFacts, ...nerFacts];
  const seen = new Map<string, typeof allFacts[0]>();
  
  for (const fact of allFacts) {
    const key = `${fact.subject}:${fact.predicate}:${fact.object}`.toLowerCase();
    const existing = seen.get(key);
    
    if (!existing || fact.confidence > existing.confidence) {
      seen.set(key, fact);
    }
  }
  
  return [...seen.values()];
}
```

### Acceptance Criteria
- [ ] NER extraction returns typed entities
- [ ] NER entities converted to fact candidates
- [ ] Combined extraction merges results
- [ ] Accuracy improves over pattern-only extraction

---

## TASK 7: Implement Temporal Reasoning
**Priority**: MEDIUM | **Effort**: MEDIUM | **Dependencies**: Task 4

### Rationale
Master plan calls for `causal/temporal.ts` for point-in-time queries.

### Implementation Steps

#### Step 7.1: Create Temporal Module
**File**: `src/sheep/causal/temporal.ts`

```typescript
/**
 * SHEEP AI - Temporal Reasoning
 * 
 * Enables point-in-time queries:
 * - "What did I believe on January 15?"
 * - "How has my understanding of X changed?"
 * - "When did I first learn Y?"
 */

import { SheepDatabase } from "../memory/database.js";
import type { Fact, Episode, MemoryChange } from "../memory/schema.js";

// =============================================================================
// TYPES
// =============================================================================

export type TemporalQuery = {
  /** Point in time to query (ISO string) */
  asOf: string;
  /** Optional subject filter */
  subject?: string;
  /** Optional predicate filter */
  predicate?: string;
};

export type BeliefSnapshot = {
  asOf: string;
  facts: Fact[];
  recentEpisodes: Episode[];
};

export type BeliefEvolution = {
  subject: string;
  predicate: string;
  timeline: Array<{
    timestamp: string;
    value: string;
    confidence: number;
    changeType: "learned" | "updated" | "retracted";
    reason?: string;
  }>;
  firstLearned: string;
  lastUpdated: string;
  totalChanges: number;
};

export type TemporalDiff = {
  fromTimestamp: string;
  toTimestamp: string;
  factsAdded: Fact[];
  factsRemoved: Array<{ id: string; subject: string; predicate: string; object: string; reason: string }>;
  factsModified: Array<{ id: string; before: string; after: string; reason: string }>;
  episodesAdded: number;
};

// =============================================================================
// TEMPORAL QUERIES
// =============================================================================

/**
 * Get beliefs as they were at a specific point in time
 */
export function getBeliefSnapshot(
  db: SheepDatabase,
  query: TemporalQuery
): BeliefSnapshot {
  // Use the database's point-in-time query
  const facts = db.queryFactsAtTime(query.asOf, {
    subject: query.subject,
    predicate: query.predicate,
  });
  
  // Get episodes around that time
  const episodes = db.queryEpisodesAtTime(query.asOf, 7);
  
  return {
    asOf: query.asOf,
    facts,
    recentEpisodes: episodes,
  };
}

/**
 * Track how a specific belief has evolved over time
 */
export function trackBeliefEvolution(
  db: SheepDatabase,
  subject: string,
  predicate: string
): BeliefEvolution {
  const timeline = db.getBeliefTimeline(subject);
  
  // Filter to specific predicate if provided
  const filtered = predicate 
    ? timeline.filter(t => t.predicate.toLowerCase().includes(predicate.toLowerCase()))
    : timeline;
  
  if (filtered.length === 0) {
    return {
      subject,
      predicate,
      timeline: [],
      firstLearned: "",
      lastUpdated: "",
      totalChanges: 0,
    };
  }
  
  return {
    subject,
    predicate,
    timeline: filtered.map(t => ({
      timestamp: t.timestamp,
      value: t.value,
      confidence: t.confidence,
      changeType: t.changeType === "created" ? "learned" : 
                  t.changeType === "updated" ? "updated" : "retracted",
      reason: t.reason,
    })),
    firstLearned: filtered[0].timestamp,
    lastUpdated: filtered[filtered.length - 1].timestamp,
    totalChanges: filtered.length,
  };
}

/**
 * Compare beliefs between two points in time
 */
export function compareBeliefs(
  db: SheepDatabase,
  fromTimestamp: string,
  toTimestamp: string
): TemporalDiff {
  const changes = db.getChangesSince(fromTimestamp);
  
  // Filter to changes before toTimestamp
  const newFacts = changes.newFacts.filter(f => f.createdAt <= toTimestamp);
  const retractedFacts = changes.retractedFacts.filter(r => r.timestamp <= toTimestamp);
  const updatedFacts = changes.updatedFacts.filter(u => u.createdAt <= toTimestamp);
  const newEpisodes = changes.newEpisodes.filter(e => e.createdAt <= toTimestamp);
  
  return {
    fromTimestamp,
    toTimestamp,
    factsAdded: newFacts,
    factsRemoved: retractedFacts.map(r => ({
      id: r.id,
      subject: "", // Would need to look up
      predicate: "",
      object: "",
      reason: r.reason,
    })),
    factsModified: updatedFacts.map(u => ({
      id: u.targetId,
      before: u.previousValue ?? "",
      after: u.newValue,
      reason: u.reason,
    })),
    episodesAdded: newEpisodes.length,
  };
}

/**
 * Find when a specific fact was first learned
 */
export function whenLearned(
  db: SheepDatabase,
  subject: string,
  predicate: string,
  object?: string
): { timestamp: string; episode?: string } | null {
  const facts = db.findFacts({
    subject,
    predicate,
    object,
    activeOnly: false, // Include retracted
  });
  
  if (facts.length === 0) return null;
  
  // Sort by firstSeen and return earliest
  facts.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
  
  return {
    timestamp: facts[0].firstSeen,
    episode: facts[0].evidence[0],
  };
}

/**
 * Answer "Why do I believe X now?"
 * Traces the evidence chain for a current belief
 */
export function explainBelief(
  db: SheepDatabase,
  factId: string
): {
  fact: Fact | null;
  evidenceChain: Array<{
    episodeId: string;
    episodeSummary: string;
    timestamp: string;
  }>;
  changeHistory: MemoryChange[];
} {
  const fact = db.getFact(factId);
  if (!fact) {
    return {
      fact: null,
      evidenceChain: [],
      changeHistory: [],
    };
  }
  
  // Get evidence episodes
  const evidenceChain: Array<{
    episodeId: string;
    episodeSummary: string;
    timestamp: string;
  }> = [];
  
  for (const epId of fact.evidence) {
    const episode = db.getEpisode(epId);
    if (episode) {
      evidenceChain.push({
        episodeId: epId,
        episodeSummary: episode.summary,
        timestamp: episode.timestamp,
      });
    }
  }
  
  // Get change history
  const changeHistory = db.getChangesFor("fact", factId);
  
  return {
    fact,
    evidenceChain,
    changeHistory,
  };
}
```

#### Step 7.2: Add CLI Commands
**File**: `src/cli/sheep-cli.ts`

The `history`, `timeline`, and `changes` commands are already implemented. Add:

```typescript
sheep
  .command("explain")
  .description("Explain why SHEEP believes a fact")
  .argument("<factId>", "Fact ID to explain")
  .option("--agent <id>", "Agent id")
  .option("--json", "Output JSON")
  .action(async (factId, opts) => {
    const { explainBelief } = await import("../sheep/causal/temporal.js");
    const db = new SheepDatabase(resolveAgent(loadConfig(), opts.agent));
    const result = explainBelief(db, factId);
    db.close();
    
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Format nicely
    }
  });
```

### Acceptance Criteria
- [ ] `getBeliefSnapshot` returns facts as of a given time
- [ ] `trackBeliefEvolution` shows how a belief changed
- [ ] `compareBeliefs` shows diff between two times
- [ ] `explainBelief` traces evidence for a fact
- [ ] CLI commands work

---

## TASK 8: Documentation & Polish
**Priority**: LOW | **Effort**: LOW | **Dependencies**: All above

### Implementation Steps

#### Step 8.1: Create User Documentation
**File**: `docs/sheep/overview.md`

```markdown
# SHEEP AI - Cognitive Memory System

SHEEP (Sleep-based Hierarchical Emergent Entity Protocol) is Moltbot's cognitive memory system that remembers conversations, learns facts, and understands causality.

## Enabling SHEEP

```bash
moltbot sheep enable
# Or: moltbot config set sheep.enabled true
```

## How It Works

1. **Learning**: After each conversation, SHEEP extracts facts and patterns
2. **Consolidation**: Periodically, SHEEP "sleeps" to consolidate memories
3. **Recall**: When you ask a question, SHEEP prefetches relevant memories

## Commands

- `moltbot sheep status` - Show memory statistics
- `moltbot sheep facts` - Query stored facts
- `moltbot sheep episodes` - Query conversation episodes
- `moltbot sheep consolidate` - Trigger manual consolidation
- `moltbot sheep forget <topic>` - Forget memories about a topic

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `sheep.enabled` | Enable SHEEP | `false` |
| `sheep.autoConsolidate` | Auto mode: `disabled`, `idle`, `scheduled` | `disabled` |
| `sheep.consolidateSchedule` | Cron schedule for consolidation | `0 3 * * *` |
| `sheep.idleThresholdMinutes` | Minutes of idle before auto-consolidation | `120` |

## Privacy

SHEEP stores memories locally in `~/.clawdbot/sheep/`. No data is sent to external servers unless you enable federation (future feature).

To delete all SHEEP data:
```bash
moltbot sheep forget "*"
# Or: rm -rf ~/.clawdbot/sheep/
```
```

#### Step 8.2: Update README
Add a section about SHEEP to the main README.

### Acceptance Criteria
- [ ] `docs/sheep/overview.md` exists
- [ ] Commands documented
- [ ] Configuration documented
- [ ] Privacy explained

---

## SUMMARY CHECKLIST

### Week 1: Foundation
- [ ] **Task 1**: User opt-in flag
- [ ] **Task 2**: Prefetch timing metrics

### Week 2: Accuracy
- [ ] **Task 3**: Golden test dataset (50+ cases)
- [ ] **Task 4**: Accuracy measurement
- [ ] **Task 5**: Auto-consolidation

### Week 3: Enhancement
- [ ] **Task 6**: NER enhancement
- [ ] **Task 7**: Temporal reasoning

### Week 4: Polish
- [ ] **Task 8**: Documentation
- [ ] Run full accuracy benchmark
- [ ] Verify all targets met

---

## SUCCESS CRITERIA

After completing all tasks:

| Metric | Target | How to Verify |
|--------|--------|---------------|
| Fact Recall | >85% | `moltbot sheep accuracy` |
| Causal F1 | >70% | `moltbot sheep accuracy` |
| Prefetch P95 | <100ms | `moltbot sheep status` |
| Auto-consolidation | Working | Config + logs |
| User opt-in | Working | `moltbot sheep enable` |
| Documentation | Complete | `docs/sheep/` |

---

**Document Version**: 1.0.0  
**Created**: January 30, 2026  
**Status**: Ready for execution
