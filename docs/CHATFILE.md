# ChatFile (per-slot prompt log)

Append-only **CHAT.jsonl** per tmux seat — queryable history of **human/system prompt +
agent response**, with **who spoke** (`agent`), provider, session id, and model.

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
| `slot` | File key: `worker-N`, `mini-N`, `manager`, `secretary` |
| `agent` | Speaker id: `slot-3-kiro`, `mini-1-oc`, `manager-claude` |
| `humanKind` | `human` (typed) or `system` (mesh-inbox / cold-start inject) |
| `providerId` | `cursor-agent`, `claude`, `kiro`, `opencode` |
| `sessionId` | CLI resume / session UUID when known |
| `model` | `--model` flag or provider default |
| `humanPrompt` | Human or system-injected text |
| `agentResponse` | Agent reply |

`agent` is seat + provider tag. When you switch CLIs on the same seat, new turns get a
new `agent` (e.g. `mini-1-oc` → `mini-1-claude`). Dedupe hash includes `agent` so
switched-provider turns do not collapse into each other.

**Scrape caveat:** pane scrollback has no durable “who said this” marker. A scrape
attributes the **latest completed turn** to the **currently running** CLI. Prefer
recording soon after a turn, or `chat append` when you already know the speaker.

## Transcript view (`chat tail`)

```text
[system]: [mesh-inbox] OC-PROVE-1: FYI …
[mini-1-oc]: scrape-quality-ok.
---
[human]: fix the banner
[slot-3-kiro]: done
```

## CLI

```bash
seatmesh chat tail --slot mini-1
seatmesh chat query --agent mini-1-oc --json
seatmesh chat query --provider kiro --limit 20
seatmesh chat append --human "run tests" --response "all green" --provider kiro
seatmesh chat record --pane %8
seatmesh chat record --all
```

## vs ChatRoom

| | ChatRoom | ChatFile |
|---|----------|----------|
| Purpose | Agent-to-agent coordination | Prompt/response audit per seat |
| Default room | `global` | Per-slot file |
| Typical line | `CLAIMED:`, `FYI:` | `[human]:` / `[slot-3-kiro]:` / `[system]:` |
