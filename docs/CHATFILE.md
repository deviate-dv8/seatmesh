# ChatFile (per-slot prompt log)

Append-only **CHAT.jsonl** per tmux seat — queryable history of **human prompt + agent
response**, with **provider**, **session id**, and **model**. Avoids scraping pane
scrollback when coordinating parallel agents.

## Storage

```text
{chatFiles.root}/
  worker-1/CHAT.jsonl
  mini-3/CHAT.jsonl
  manager/CHAT.jsonl
```

Profile: `chatFiles.root`, `chatFiles.filename` in `mesh.config.yaml`.

## Record shape

| Field | Meaning |
|-------|---------|
| `slot` | `worker-N`, `mini-N`, `manager`, `secretary` |
| `providerId` | `cursor-agent`, `claude`, `kiro`, `opencode` |
| `sessionId` | CLI resume / session UUID when known |
| `model` | `--model` flag or provider default |
| `humanPrompt` | Human or manager-injected text |
| `agentResponse` | Last agent reply (when known) |

## AgentProvider contract

Every provider implements `PromptRecording` on `AgentProvider`:

- `sessionId(pane, detection)`
- `modelId(pane)`
- `scrapePromptTurn(pane)` — null when capture is not parseable

Explicit append (`chat append`) or inject-time hooks can record when scrape misses.

## CLI

```bash
./sm.sh chat tail --slot worker-1
./sm.sh chat query --session <uuid> --json
./sm.sh chat query --provider claude --limit 20
./sm.sh chat append --human "run tests" --response "all green"
./sm.sh chat record              # current TMUX_PANE
./sm.sh chat record --all        # scan session panes
```

## vs ChatRoom

| | ChatRoom | ChatFile |
|---|----------|----------|
| Purpose | Agent-to-agent coordination | Prompt/response audit per seat |
| Default room | `global` | Per-slot file |
| Typical line | `CLAIMED:`, `FYI:` | Full human + agent turn |
