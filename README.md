# @sheep-ai/core

**Cognitive memory for AI agents.** SHEEP extracts facts and causal relationships from conversations, consolidates them during sleep-like cycles, and recalls with reasoning -- not just keyword matching.

Unlike vector-only RAG, SHEEP knows *why* things happened. Ask "why did the server crash?" and get a causal chain, not a list of documents.

- **Fact extraction** -- LLM-powered SPO triples from natural conversation
- **Causal reasoning** -- cause-effect chains with mechanism tracking
- **Sleep consolidation** -- periodic memory cleanup, dedup, and pattern discovery
- **Emotional context** -- captures stress, frustration, excitement alongside hard facts
- **Privacy built-in** -- GDPR-compliant forgetting and data export

## Install

```bash
npm install @sheep-ai/core
```

## Quick Start

```typescript
import { SheepDatabase, extractFactsWithLLM, createSheepLLMProvider } from "@sheep-ai/core";

// Create memory store
const db = new SheepDatabase("my-agent");

// Extract facts from a conversation
const llm = await createSheepLLMProvider("muscle");
const facts = await extractFactsWithLLM(llm, conversation, "episode-1");

// Store them
for (const fact of facts) {
  db.insertFact(fact);
}

// Query later
const results = db.findFacts({ subject: "user", activeOnly: true });
```

## Benchmarks

Measured on 55 hand-labeled test conversations with 152 expected facts and 41 causal links.

| Metric | Score |
|--------|-------|
| Fact Precision | 72.6% |
| Fact Recall | 90.8% |
| **Fact F1** | **80.7%** |
| Causal F1 | 79.1% |
| Emotional F1 | 86% |
| Recall Accuracy | 85% |
| Negative test (0 false extractions) | Pass |

Run benchmarks yourself:

```bash
pnpm run proof        # 5 cases, ~60s
pnpm run proof:full   # 55 cases, ~12min
pnpm run proof:recall # end-to-end pipeline
```

## License

MIT
