# SHEEP AI v3.0.0

> **Sleep-based Hierarchical Emergent Entity Protocol**
> The world's first cognitive memory system for personal AI.

```
███████╗██╗  ██╗███████╗███████╗██████╗      █████╗ ██╗
██╔════╝██║  ██║██╔════╝██╔════╝██╔══██╗    ██╔══██╗██║
███████╗███████║█████╗  █████╗  ██████╔╝    ███████║██║
╚════██║██╔══██║██╔══╝  ██╔══╝  ██╔═══╝     ██╔══██║██║
███████║██║  ██║███████╗███████╗██║         ██║  ██║██║
╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝         ╚═╝  ╚═╝╚═╝

    "Memory is not storage. Memory is cognition."
```

## What is SHEEP?

SHEEP is a cognitive memory layer that gives AI assistants human-like memory:

- **Episodic Memory**: Remembers conversations as episodes
- **Semantic Memory**: Extracts facts (subject-predicate-object triples)
- **Causal Reasoning**: Understands cause-effect relationships
- **Procedural Memory**: Learns how to do things
- **Foresight Signals**: Predicts future needs from conversation
- **Topic Clustering**: Groups related memories into scenes (MemScene)
- **Sleep Consolidation**: Processes memories during idle time
- **Active Forgetting**: Prunes low-value memories intelligently

## Architecture

```
User Message
     │
     ▼
┌─────────────────────────┐
│  Prefetch Engine        │  Intent classify + entity extract
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  Hybrid Retrieval (RRF) │  Semantic + BM25 + Metadata
├─────────────────────────┤
│  Agentic Multi-Round    │  Sufficiency check + follow-up
├─────────────────────────┤
│  Multi-hop Chains       │  Causal graph traversal
├─────────────────────────┤
│  MemScene Clustering    │  Scene-level context
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  Context Injection      │  Format for LLM prompt
└─────────────────────────┘
```

## Quick Start

```bash
# Install
npm install

# Run tests
npm test

# Type check
npm run lint

# Build
npm run build
```

## Module Map

| Module | Description |
|--------|-------------|
| `memory/schema.ts` | Core types: Episode, Fact, CausalLink, Procedure, Foresight |
| `memory/database.ts` | SQLite storage with migrations |
| `memory/cluster.ts` | MemScene topic clustering engine |
| `memory/semantic-search.ts` | Vector similarity search |
| `extraction/episode-extractor.ts` | Session → Episodes |
| `extraction/fact-extractor.ts` | Episodes → Facts (SPO triples) |
| `extraction/llm-extractor.ts` | LLM-powered extraction |
| `extraction/llm-ner.ts` | Named Entity Recognition |
| `extraction/foresight-extractor.ts` | Predictive memory signals |
| `extraction/profile-discriminator.ts` | Stable/transient user profiling |
| `extraction/online-synthesis.ts` | Real-time synthesis |
| `causal/causal-extractor.ts` | Causal link extraction (regex + LLM) |
| `causal/temporal.ts` | Point-in-time queries |
| `consolidation/consolidator.ts` | Sleep cycle orchestrator |
| `consolidation/llm-sleep.ts` | LLM-powered pattern discovery |
| `consolidation/forgetting.ts` | Active forgetting engine |
| `consolidation/scheduler.ts` | Auto-consolidation scheduler |
| `retrieval/hybrid-retrieval.ts` | RRF fusion (semantic + BM25 + metadata) |
| `retrieval/agentic-retrieval.ts` | Multi-round retrieval with verification |
| `retrieval/multihop-chain.ts` | Causal chain reasoning |
| `retrieval/vector-search.ts` | Multi-metric vector search |
| `retrieval/bm25-search.ts` | BM25 keyword search |
| `retrieval/intent-planner.ts` | Intent-aware retrieval planning |
| `prefetch/prefetch-engine.ts` | Predictive memory prefetch |
| `tools/memory-tools.ts` | Agent tools (remember, recall, why, forget) |
| `integration/moltbot-bridge.ts` | OpenClaw/Moltbot integration bridge |

## V3 Features (New)

1. **MemScene Topic Clustering** - Groups memories into thematic clusters for scene-level retrieval
2. **Dynamic User Profiling** - Separates stable traits from transient states with expiry
3. **Multi-hop Chain Reasoning** - Traverses causal graphs for complex "why" queries
4. **Foresight Signals** - Extracts time-bounded predictions from conversations
5. **Agentic Retrieval Verification** - LLM verifies retrieval sufficiency

## Test Coverage

- 249 tests (244 passing, 5 need fixes in database.test.ts)
- 17 test files across all modules
- Benchmark suite with LoCoMo evaluation

## Docs

- `SHEEP_AI_MASTER_PLAN.md` - Original vision (Phase 0-3)
- `SHEEP_V3_SPEC.md` - V3 technical specification
- `SHEEP_AI_EXECUTION_PLAN.md` - Execution plan
- `PHASE1.1_RESULTS.md` - Phase 1.1 benchmark results

## License

MIT - Marsirius AI Labs
