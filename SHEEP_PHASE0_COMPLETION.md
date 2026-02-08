# SHEEP AI - Phase 0 Completion Plan

**Created**: January 30, 2026  
**Current Status**: 70-72% Complete  
**Target**: 98% Complete (Production Ready)  
**Audit Sources**: Claude Audit + Counting Sheep Self-Assessment

---

## Critical Path Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 0 COMPLETION ROADMAP                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  🔴 WEEK 1: CRITICAL FIXES                                                  │
│  ├── Fix causal link extraction (0 → working)                               │
│  ├── Wire LLM extraction into consolidation pipeline                        │
│  └── Validate opt-in gating works                                           │
│                                                                             │
│  🟡 WEEK 2: VALIDATION & MEASUREMENT                                        │
│  ├── Run accuracy benchmarks                                                │
│  ├── Record baseline metrics                                                │
│  └── Verify latency targets                                                 │
│                                                                             │
│  🟢 WEEK 3: ENHANCEMENT                                                     │
│  ├── Add hybrid search α blending                                           │
│  ├── Implement NER enhancement                                              │
│  └── Improve temporal reasoning                                             │
│                                                                             │
│  🔵 WEEK 4: POLISH & DOCUMENTATION                                          │
│  ├── Create user documentation                                              │
│  ├── Beta user onboarding                                                   │
│  └── Final validation run                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔴 PRIORITY 0: CRITICAL FIXES (Week 1)

### Task 1: Fix Causal Link Extraction Pipeline
**Status**: BROKEN (0 causal links in production)  
**Severity**: BLOCKER  
**Effort**: MEDIUM  

**Root Cause**: `extractCausalLinksWithLLM()` exists but is NOT called in `consolidator.ts`

**Files to modify**:
- `src/sheep/consolidation/consolidator.ts`

**Implementation**:
```typescript
// Add after fact extraction in runConsolidation():

// Stage 2.4: Extract causal links from episodes using LLM
if (!options.dryRun && storedEpisodes.length > 0) {
    options.onProgress?.("Extracting causal links", 0, storedEpisodes.length);
    
    for (let i = 0; i < storedEpisodes.length; i++) {
        const episode = storedEpisodes[i];
        options.onProgress?.("Extracting causal links", i + 1, storedEpisodes.length);
        
        try {
            // Get the original conversation text for this episode
            const conversationText = await getConversationTextForEpisode(episode);
            
            // Extract causal links using LLM
            const causalLinks = await extractCausalLinksWithLLM(
                llm, 
                conversationText, 
                episode.id
            );
            
            for (const linkData of causalLinks) {
                db.insertCausalLink(linkData);
                stats.causalLinksExtracted++;
            }
        } catch (err) {
            log.warn("Causal link extraction failed for episode", {
                episodeId: episode.id,
                error: String(err),
            });
        }
    }
}
```

**Checklist**:
- [ ] Import `extractCausalLinksWithLLM` in consolidator.ts
- [ ] Add LLM provider initialization in consolidation pipeline
- [ ] Add causal extraction stage after fact extraction
- [ ] Add helper to retrieve conversation text for episode
- [ ] Test: Run consolidation and verify causal links > 0
- [ ] Test: Query `moltbot sheep status` shows causal links

---

### Task 2: Wire LLM Provider into Consolidation
**Status**: Missing  
**Severity**: HIGH  
**Effort**: LOW  

**Problem**: Consolidation uses regex extraction, not LLM extraction

**Files to modify**:
- `src/sheep/consolidation/consolidator.ts`

**Implementation**:
```typescript
// At the start of runConsolidation():
import { createSheepLLMProvider, type LLMProvider } from "../extraction/llm-extractor.js";

// Inside runConsolidation():
let llm: LLMProvider | null = null;
if (options.useLLMExtraction !== false) {
    try {
        llm = await createSheepLLMProvider("extraction");
        log.info("LLM extraction enabled for consolidation");
    } catch (err) {
        log.warn("LLM extraction unavailable, using basic extraction", { error: String(err) });
    }
}
```

**Checklist**:
- [ ] Add `useLLMExtraction` option to ConsolidationOptions
- [ ] Initialize LLM provider at start of consolidation
- [ ] Pass LLM to fact extraction if available
- [ ] Pass LLM to causal extraction
- [ ] Graceful fallback if LLM unavailable
- [ ] Test: Consolidation with LLM extracts more facts

---

### Task 3: Complete User Opt-In Gating
**Status**: Partial  
**Severity**: HIGH  
**Effort**: LOW  

**Problem**: `sheep.enabled` check may not gate all paths

**Files to check/modify**:
- `src/sheep/integration/moltbot-bridge.ts`
- `src/auto-reply/reply/agent-runner.ts`
- `src/sheep/tools/memory-tools.ts`

**Checklist**:
- [ ] Verify `prefetchMemoriesForMessage()` checks `config.sheep?.enabled`
- [ ] Verify `learnFromAgentTurn()` checks `config.sheep?.enabled`
- [ ] Verify memory tools return gracefully when disabled
- [ ] Add `moltbot sheep status` to show enabled/disabled prominently
- [ ] Test: With `sheep.enabled=false`, no SHEEP activity occurs
- [ ] Test: With `sheep.enabled=true`, SHEEP functions normally

---

### Task 4: Wire Auto-Consolidation to Gateway Startup
**Status**: Code exists, not wired  
**Severity**: MEDIUM  
**Effort**: LOW  

**Problem**: `initializeAutoConsolidation()` exists but may not be called at startup

**Files to modify**:
- Gateway startup code (find where agent/gateway initializes)
- May need to add to `src/auto-reply/` or gateway entry point

**Checklist**:
- [ ] Find gateway/agent startup entry point
- [ ] Call `initializeAutoConsolidation(agentId, config)` on startup
- [ ] Verify scheduler starts when `sheep.autoConsolidate` is set
- [ ] Test: Set `autoConsolidate: "idle"` and verify scheduler runs
- [ ] Test: Set `autoConsolidate: "scheduled"` and verify cron works

---

## 🟡 PRIORITY 1: VALIDATION & MEASUREMENT (Week 2)

### Task 5: Run Accuracy Benchmarks and Record Baseline
**Status**: Framework exists, never run  
**Severity**: HIGH  
**Effort**: MEDIUM  

**Target Metrics** (from Master Plan):
- Fact Recall: >85%
- Causal F1: >70%
- Episode Recall: >80%
- Prefetch Hit Rate: >60%

**Commands to run**:
```bash
# Run accuracy measurement with real LLM
moltbot sheep accuracy --model claude-3-5-sonnet-latest

# Run with verbose output to see per-case results
moltbot sheep accuracy --verbose

# Run specific categories
moltbot sheep accuracy --category user_info
moltbot sheep accuracy --category causal
```

**Checklist**:
- [ ] Run `moltbot sheep accuracy` with real LLM (not mock)
- [ ] Record baseline fact precision/recall/F1
- [ ] Record baseline causal precision/recall/F1
- [ ] Identify categories with lowest performance
- [ ] Create tracking document with baseline numbers
- [ ] If below targets, identify specific failing test cases

---

### Task 6: Measure Prefetch Latency and Hit Rate
**Status**: Metrics exist, not validated  
**Severity**: MEDIUM  
**Effort**: LOW  

**Target**: <100ms prefetch latency

**Checklist**:
- [ ] Enable SHEEP and have 10+ conversations
- [ ] Run `moltbot sheep status --json` to get latency stats
- [ ] Verify P50 < 100ms, P95 < 200ms
- [ ] Check prefetch hit rate (target: >60%)
- [ ] If latency too high, profile the bottleneck
- [ ] Document results

---

### Task 7: Validate Consolidation Performance
**Status**: Runs, not validated  
**Severity**: MEDIUM  
**Effort**: LOW  

**Target**: <5 min/day consolidation time

**Checklist**:
- [ ] Run `moltbot sheep consolidate` on agent with 50+ sessions
- [ ] Record duration in ms
- [ ] Verify all stages complete (episodes, facts, causal, procedures, forgetting)
- [ ] Check stats output for reasonable numbers
- [ ] Document consolidation performance

---

## 🟢 PRIORITY 2: ENHANCEMENT (Week 3)

### Task 8: Implement Hybrid Search with α Blending
**Status**: Components exist, not integrated  
**Severity**: MEDIUM  
**Effort**: MEDIUM  

**Problem**: BM25 and vector search exist separately, not blended in prefetch

**Files to modify**:
- `src/sheep/integration/moltbot-bridge.ts`
- `src/sheep/memory/semantic-search.ts`

**Implementation**:
```typescript
// In moltbot-bridge.ts searchMemories():
const results = await performHybridSearch(
    query,
    bm25Index,
    semanticIndex,
    {
        bm25Weight: 0.4,
        vectorWeight: 0.6,
        minScore: 0.3,
        maxResults: limit,
        types,
    }
);
```

**Checklist**:
- [ ] Initialize BM25 index alongside semantic index
- [ ] Populate BM25 index when loading memories
- [ ] Use `performHybridSearch()` in `searchMemories()`
- [ ] Add config option for blend weights
- [ ] Test: Hybrid search returns better results than either alone
- [ ] Benchmark recall improvement

---

### Task 9: Add NER Enhancement to Fact Extraction
**Status**: Planned, not implemented  
**Severity**: MEDIUM  
**Effort**: HIGH  

**Goal**: Improve fact extraction accuracy by 5-10%

**Files to create/modify**:
- `src/sheep/extraction/llm-ner.ts` (new)
- `src/sheep/extraction/llm-extractor.ts`

**Implementation**:
```typescript
// llm-ner.ts
export type NamedEntity = {
    text: string;
    type: "PERSON" | "ORGANIZATION" | "LOCATION" | "PROJECT" | "TECHNOLOGY" | "DATE";
    confidence: number;
};

export async function extractNamedEntities(
    llm: LLMProvider,
    text: string
): Promise<NamedEntity[]>;

// Enhanced extraction in llm-extractor.ts
export async function extractFactsWithLLMEnhanced(
    llm: LLMProvider,
    conversationText: string,
    episodeId: string
): Promise<Fact[]> {
    // Step 1: Extract named entities
    const entities = await extractNamedEntities(llm, conversationText);
    
    // Step 2: Use entities to guide fact extraction
    const prompt = buildEntityAwarePrompt(conversationText, entities);
    
    // Step 3: Extract facts with entity context
    return extractFactsWithLLM(llm, prompt, episodeId);
}
```

**Checklist**:
- [ ] Create NER prompt for Claude
- [ ] Implement `extractNamedEntities()` function
- [ ] Create `extractFactsWithLLMEnhanced()` combining NER + extraction
- [ ] Run accuracy benchmark before/after
- [ ] Verify accuracy improvement
- [ ] Update consolidation to use enhanced extraction

---

### Task 10: Improve Temporal Reasoning
**Status**: Basic implementation exists  
**Severity**: LOW  
**Effort**: MEDIUM  

**Files to modify**:
- `src/sheep/causal/temporal.ts`
- `src/sheep/prefetch/temporal-parser.ts`

**Checklist**:
- [ ] Add more temporal patterns ("a few days ago", "earlier this week")
- [ ] Improve point-in-time query accuracy
- [ ] Add "belief at time X" queries to memory tools
- [ ] Test temporal queries via CLI
- [ ] Add `moltbot sheep history` examples to help text

---

## 🔵 PRIORITY 3: POLISH & DOCUMENTATION (Week 4)

### Task 11: Create User Documentation
**Status**: Not started  
**Severity**: LOW  
**Effort**: LOW  

**Files to create**:
- `docs/sheep/overview.md`
- `docs/sheep/configuration.md`
- `docs/sheep/commands.md`

**Content for overview.md**:
```markdown
# SHEEP AI - Cognitive Memory System

SHEEP (Sleep-based Hierarchical Emergent Entity Protocol) gives your 
Moltbot assistant human-like memory capabilities.

## Features
- **Episodic Memory**: Remembers conversations and events
- **Semantic Memory**: Extracts facts and knowledge
- **Causal Reasoning**: Understands why things happened
- **Procedural Memory**: Learns how you like things done
- **Sleep Consolidation**: Processes memories like human sleep

## Quick Start
\`\`\`bash
# Enable SHEEP
moltbot sheep enable

# Check status
moltbot sheep status

# Run consolidation manually
moltbot sheep consolidate

# Query facts
moltbot sheep facts --limit 20
\`\`\`
```

**Checklist**:
- [ ] Create `docs/sheep/overview.md`
- [ ] Create `docs/sheep/configuration.md` with all config options
- [ ] Create `docs/sheep/commands.md` with CLI reference
- [ ] Add SHEEP section to main docs navigation
- [ ] Verify docs render correctly on Mintlify

---

### Task 12: Add SHEEP Section to README
**Status**: Not done  
**Severity**: LOW  
**Effort**: LOW  

**Checklist**:
- [ ] Add SHEEP feature section to main README
- [ ] Include basic enable/status commands
- [ ] Link to full docs

---

### Task 13: Final Validation Run
**Status**: Pending  
**Severity**: HIGH  
**Effort**: LOW  

**Checklist**:
- [ ] Run full accuracy benchmark
- [ ] Verify fact recall >85%
- [ ] Verify causal F1 >70%
- [ ] Verify prefetch latency <100ms P95
- [ ] Verify consolidation <5 min
- [ ] Run with 5+ real conversations
- [ ] Document all metrics in tracking file
- [ ] Mark Phase 0 as COMPLETE when all targets met

---

## Success Criteria Checklist

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Fact Recall | >85% | ~80%* | 🟡 |
| Episode Recall | >80% | Unknown | ❓ |
| Causal F1 | >70% | 0% | 🔴 |
| Prefetch P95 | <100ms | Unknown | ❓ |
| Prefetch Hit Rate | >60% | Unknown | ❓ |
| Consolidation Time | <5 min | Unknown | ❓ |
| User Opt-In | Working | Partial | 🟡 |
| Auto-Consolidation | Working | Not wired | 🔴 |
| Documentation | Complete | 0% | 🔴 |

*Estimated from Counting Sheep self-report

---

## Daily Progress Tracking

### Day 1 (Jan 31, 2026)
- [ ] Task 1: Fix causal link extraction
- [ ] Task 2: Wire LLM into consolidation
- [ ] Run first consolidation with LLM

### Day 2
- [ ] Task 3: Complete opt-in gating
- [ ] Task 4: Wire auto-consolidation
- [ ] Verify all critical fixes

### Day 3
- [ ] Task 5: Run accuracy benchmarks
- [ ] Record baseline numbers
- [ ] Identify improvement areas

### Day 4
- [ ] Task 6: Measure prefetch latency
- [ ] Task 7: Validate consolidation
- [ ] Document all metrics

### Day 5-7
- [ ] Task 8: Implement hybrid search
- [ ] Task 9: Add NER enhancement (start)

### Week 2
- [ ] Complete Task 9: NER
- [ ] Task 10: Temporal reasoning
- [ ] Re-run benchmarks

### Week 3
- [ ] Tasks 11-12: Documentation
- [ ] Task 13: Final validation
- [ ] Phase 0 sign-off

---

## Commands Reference

```bash
# Enable/disable SHEEP
moltbot sheep enable
moltbot sheep disable

# Check status (shows metrics)
moltbot sheep status
moltbot sheep status --json

# Run consolidation
moltbot sheep consolidate
moltbot sheep consolidate --dry-run

# Query memories
moltbot sheep facts --limit 20
moltbot sheep episodes --limit 10
moltbot sheep facts --subject user

# Run accuracy test
moltbot sheep accuracy
moltbot sheep accuracy --verbose
moltbot sheep accuracy --category causal

# Temporal queries
moltbot sheep history "January 15"
moltbot sheep timeline user
moltbot sheep changes "last week"

# Debug
moltbot sheep explain <factId>
moltbot sheep graph --format json
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| LLM extraction slow | Use Haiku for speed-critical, Sonnet for quality |
| Accuracy below target | Iterate on prompts, add NER enhancement |
| Latency above 100ms | Profile and optimize, cache embeddings |
| Causal extraction fails | Add fallback to simpler pattern matching |

---

**Document Version**: 1.0.0  
**Last Updated**: January 30, 2026  
**Owner**: Counting Sheep Development Team
