# @sheep-ai/mcp-server

SHEEP AI cognitive memory for any MCP-compatible host (Cursor, Claude Desktop, custom apps).

SHEEP remembers everything. It learns from conversations, extracts facts, reasons about cause-and-effect, and consolidates memories during idle time -- like a brain during sleep.

## Quick Start

### Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json` in your project or global settings):

```json
{
  "mcpServers": {
    "sheep": {
      "command": "npx",
      "args": ["-y", "@sheep-ai/mcp-server"],
      "env": {
        "SHEEP_API_KEY": "sk-sheep-your-key-here"
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sheep": {
      "command": "npx",
      "args": ["-y", "@sheep-ai/mcp-server"],
      "env": {
        "SHEEP_API_KEY": "sk-sheep-your-key-here"
      }
    }
  }
}
```

### Get an API Key

Visit [sheep.ai](https://sheep.ai) or contact us at mb@marsirius.ai.

## Tools

| Tool | Description |
|------|-------------|
| `sheep_remember` | Store a fact in cognitive memory |
| `sheep_recall` | Search memory for relevant facts |
| `sheep_why` | Query causal reasoning chains |
| `sheep_forget` | Forget specific facts |
| `sheep_stats` | Get memory statistics |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SHEEP_API_KEY` | Yes | -- | Your SHEEP API key |
| `SHEEP_API_URL` | No | `https://sheep-cloud-production.up.railway.app` | API endpoint |

## Tiers

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | Basic recall, keyword search, manual store |
| Personal | $9/mo | + Sleep consolidation, causal reasoning, foresight |
| Pro | $19/mo | + Multi-agent, API access, advanced analytics |
| Team | $49/seat/mo | + Federation, shared memory, admin dashboard |

## How It Works

This is a thin MCP client. All the cognitive processing happens on the SHEEP cloud:

1. You talk to your AI assistant (Cursor, Claude, etc.)
2. The assistant calls SHEEP tools via MCP
3. This package forwards requests to the SHEEP cloud API
4. SHEEP's cognitive memory processes the request
5. Results come back to your assistant

Your data is isolated per API key. GDPR-compliant deletion available.

## License

MIT -- (c) 2026 Marsirius AI Labs
