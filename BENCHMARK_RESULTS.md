# SHEEP AI - LoCoMo Benchmark Results

**Date**: 2026-02-11
**Dataset**: LoCoMo-10 (Snap Research)
**Conversations**: 2
**Questions**: 304
**Models**: Gemini 2.5 Flash (extraction) + Claude Haiku 4 (answers)
**Cost**: $0.13
**Duration**: 8.4 minutes

## Results

| Metric | Score |
|--------|-------|
| **Accuracy** | **39.1%** |
| **Avg F1** | **36.4%** |

## By Category

| Category | Accuracy | F1 | Correct/Total |
|----------|----------|-----|---------------|
| Single-hop | 55.8% | 56.4% | 24/43 |
| Temporal | 12.7% | 19.9% | 8/63 |
| Inference | 46.2% | 29.6% | 6/13 |
| Open-domain | 66.7% | 59.7% | 76/114 |
| Adversarial | 7.0% | 2.8% | 5/71 |

## Comparison with Published Baselines

| System | LoCoMo Accuracy |
|--------|----------------|
| MemU (SOTA) | 92.1% |
| MemMachine | 91.2% |
| Mem0 | 85.0% |
| Letta | 74.0% |
| SHEEP AI | 39.1% |

## Reproducibility

```bash
# Validate (2 conversations, ~30 min)
npx tsx src/scripts/run-benchmarks.ts --validate

# Full (10 conversations, ~3 hours)
npx tsx src/scripts/run-benchmarks.ts
```

Requires: `GOOGLE_AI_API_KEY` in .env (for Gemini Flash extraction).
