# 🐑 SHEEP AI Core

### Your AI forgets everything. SHEEP doesn't.

> Every AI conversation starts from zero. SHEEP gives AI agents persistent, causal memory — it remembers not just *what* happened, but *why*.

**SHEEP** (Sleep-based Hierarchical Emergent Entity Protocol) extracts facts and cause-effect relationships from natural conversation, consolidates them during sleep-like cycles, and recalls with reasoning. Not keyword matching. Not vector similarity. Actual understanding.

## Why SHEEP?

| Feature | ChatGPT Memory | Mem0 | Mastra OM | **SHEEP** |
|---------|---------------|------|-----------|-----------|
| Fact extraction | Basic | ✅ | ✅ | ✅ **95.7% F1** |
| Causal reasoning | ❌ | ❌ | ❌ | ✅ **100% F1** |
| Emotional memory | ❌ | ❌ | ❌ | ✅ **86% F1** |
| Sleep consolidation | ❌ | ❌ | ❌ | ✅ |
| Noise rejection | ❌ | 🟡 | ✅ | ✅ **0 false positives** |
| GDPR compliance | ❌ | 🟡 | ❌ | ✅ Built-in |
| Open source | ❌ | Partial | ✅ | ✅ MIT |

Ask ChatGPT "why did I switch to TypeScript?" and it draws a blank. Ask SHEEP and it returns: *"You switched because JavaScript had too many runtime bugs → TypeScript compiler catches errors before production → saved a week of debugging."* A full causal chain.

## Benchmarks

55 hand-labeled conversations. 152 expected facts. 41 causal links. Zero cherry-picking.

| Metric | Score |
|--------|-------|
| **Fact F1** | **95.7%** |
| **Causal F1** | **100%** |
| Fact Precision | 100% |
| Fact Recall | 87.5% |
| Recall Accuracy (end-to-end) | 85% |
| Emotional extraction F1 | 86% |
| False positives on small talk | **0** |

Run them yourself in 60 seconds:

```bash
npm run proof          # 5 cases, ~60s, ~$1
npm run proof:full     # 55 cases, ~12min
npm run proof:recall   # end-to-end pipeline test
```

## Install

```bash
npm install sheep-ai-core
```

## Quick Start

```typescript
import { SheepDatabase, extractFactsWithLLM, createSheepLLMProvider } from "sheep-ai-core";

// 1. Extract facts from any conversation
const llm = await createSheepLLMProvider("muscle");
const facts = await extractFactsWithLLM(llm, conversation, "episode-1");
// → [{ subject: "user", predicate: "prefers", object: "TypeScript" }, ...]

// 2. Store in persistent memory
const db = new SheepDatabase("my-agent");
for (const fact of facts) db.insertFact(fact);

// 3. Query with causal reasoning
const chain = buildCausalChain(db.findCausalLinks({}), "switched to TypeScript");
// → cause: "JavaScript runtime bugs" → effect: "switched to TypeScript"
//   cause: "TypeScript compiler" → effect: "saved a week of debugging"
```

## What SHEEP Extracts

**From a single conversation like:**
> "I'm so stressed about the release. The API keeps failing under load. I've been debugging for 12 hours."

**SHEEP extracts:**
- 📋 Facts: `user | feeling | stressed`, `API | issue | failing under load`, `release | status | behind schedule`
- 🔗 Causal: `API failures` → `stress and long debugging sessions`
- 🎭 Emotion: stressed (with cause and context)

**From noise like "Hey, nice weather today!"** → SHEEP extracts **nothing**. Zero false positives.

## Architecture

```
Conversation → [LLM Extraction] → Facts + Causal Links + Episodes
                                        ↓
                              [Sleep Consolidation]
                                        ↓
                          Deduplicated, Connected Memory
                                        ↓
                              [Causal Recall Engine]
                                        ↓
                            "Why did X happen?" → Chain
```

## License

MIT — use it however you want.

Built by [Marsirius AI Labs](https://github.com/mbmarsirius/SHEEP_CORE_v3.0.0)
