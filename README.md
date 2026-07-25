# AURA 2026

Interactive symposium journey with a local-first registration API and an optional local AI MCP server.

## Run

```bash
npm run dev
```

The website runs at Vite's URL and the API runs on port `1215`. Registration data is persisted to `data/registrations.json`; this path is intentionally ignored by Git.

Set secure administrator credentials before deployment:

```bash
ADMIN_PIN=your-pin
ADMIN_USER=your-user
ADMIN_PASSWORD=your-strong-password
```

## Local MCP and Ollama

```bash
npm run mcp
```

The stdio server at `mcp-server/index.js` implements JSON-RPC MCP tools for chat, registrations, validation, events, analytics, reports, search, dashboard data, and a vision-ready interface. Chat uses Ollama only when its `chat` tool is invoked:

```bash
OLLAMA_MODEL=llama3.2 OLLAMA_URL=http://127.0.0.1:11434 npm run mcp
```

No cloud AI credentials are needed for the app or MCP server.
