# @sheep-ai/openclaw-memory

Persistent cognitive memory for OpenClaw / ClawBot agents.

Your agent remembers everything -- names, preferences, projects, decisions -- across all conversations, forever.

## Install

```bash
npm install @sheep-ai/openclaw-memory
```

## Configure

Add to your OpenClaw config (`openclaw.json` or equivalent):

```json
{
  "extensions": ["@sheep-ai/openclaw-memory"]
}
```

Set your SHEEP API key:

```bash
export SHEEP_API_KEY=sk-sheep-your-key-here
```

Get a key at [marsirius.ai/sheep](https://marsirius.ai/sheep) or email mb@marsirius.ai.

## What It Does

### Automatic (zero config after install)

- **Before each conversation**: SHEEP recalls relevant memories and injects them into the agent's context
- **After each conversation**: SHEEP extracts and stores facts from the conversation

### Manual Commands

```bash
openclaw sheep recall <query>     # Search memories
openclaw sheep remember <s> <p> <o>  # Store a fact
openclaw sheep forget <topic>     # Forget something
openclaw sheep status             # Memory stats
openclaw sheep why <question>     # Causal reasoning
```

## How It Works

```
Your ClawBot Agent
    |
    | conversation starts
    v
SHEEP Extension (this package)
    |
    | calls cloud API
    v
SHEEP Cloud (Railway)
    |
    | semantic search, fact extraction,
    | consolidation, causal reasoning
    v
Returns memories → injected into agent context
```

- **Zero LLM cost**: SHEEP only stores and retrieves memories. Your agent uses its own model.
- **Isolated storage**: Each API key gets a separate database. Your memories are private.
- **GDPR compliant**: Delete all data anytime with `openclaw sheep forget --all`.

## Pricing

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | 10 req/min, basic recall |
| Personal | $9/mo | 60 req/min, consolidation, causal reasoning |
| Pro | $19/mo | 300 req/min, API access, multi-agent |

## License

MIT -- (c) 2026 Marsirius AI Labs
