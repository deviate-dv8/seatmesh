# MCP servers (seatmesh)

Config: `.cursor/mcp.json` (Cursor) and `.mcp.json` (Claude Code mirror).

After changing MCP config, **reload MCP servers / restart the IDE** so tools attach to new chats.

## Context7 (library docs)

Use Context7 for up-to-date third-party docs instead of guessing APIs.

Template mirrored from zsign (Context7 block only — no GitLab tokens in this repo).

```json
"context7": {
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp@latest"]
}
```

Optional: `CONTEXT7_API_KEY` in the server `env` block (never commit keys).

### When to call (required for hub UI work)

Before implementing or changing **AdonisJS 7**, **Inertia**, **Vue**, or **PrimeVue** APIs:

1. `resolve-library-id` for the library (e.g. `adonisjs`, `primevue`, `inertiajs`).
2. `query-docs` / `get-library-docs` with a focused `topic`.
3. Prefer docs over training-data guesses for props, routes, and starter-kit patterns.

Same pattern for other libraries when unsure.

### Common tools

- `resolve-library-id`
- `query-docs` (or `get-library-docs` on older builds)

Full schemas: discover from the Context7 namespace after MCP reload.
