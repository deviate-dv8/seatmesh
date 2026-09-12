# Mesh state (`mesh-agents.json`)

Mesh-owned map of which agent CLI type and resume id each slot runs. The engine
reads and writes this file; it does not mutate unrelated harness state files.

| | |
|---|---|
| **Default path** | `state.meshAgentsJson` in profile (default `mesh-agents.json` under workspace) |
| **Schema** | `packages/core/src/schema/agents.ts` (`MeshAgentsSchema`) |
| **Load** | `packages/tmux/src/agents/agents-state.ts` |
| **Save** | `./sm.sh save` / `auto` scrapes live session |

## Slot mapping

| Slot | Key in JSON | Window |
|------|-------------|--------|
| manager | `manager` | base |
| secretary | `secretary` | base |
| worker N | `workers[]` (`slot: N`) | workers |
| mini N | `minis[]` (`mini: N`) | minis |

## Example shape

```jsonc
{
  "schemaVersion": 1,
  "session": "mesh",
  "workdir": "/path/to/workspace",
  "manager": {
    "type": "agent",
    "name": "manager",
    "resumeId": "…",
    "resumeCmd": "agent --resume …"
  },
  "secretary": {
    "type": "opencode",
    "wanted": true,
    "resumeId": null
  },
  "workers": [
    {
      "type": "agent",
      "slot": 3,
      "name": "worker-3",
      "ports": "3030/3031",
      "resumeId": "…",
      "paneIndex": 2
    }
  ],
  "minis": [
    {
      "type": "opencode",
      "mini": 1,
      "role": "helper",
      "task": "…",
      "paneIndex": 0
    }
  ],
  "conventions": {
    "secretaryDefaultCli": "opencode",
    "miniDefaultCli": "opencode",
    "launchSkipsEmpty": true,
    "coordSync": {
      "reload": false,
      "attach": true
    }
  },
  "updatedAt": "2026-09-11T13:01:19Z"
}
```

Port strings follow the profile `ports.worker` formula.

## Conventions block

| Key | Meaning |
|-----|---------|
| `coordSync.reload: false` | On reload, start **empty** coord panes but **never replace a live CLI** |
| `coordSync.attach: true` | Sync coord CLIs on attach when policy allows |
| `launchSkipsEmpty: true` | `launch` skips worker slots marked `empty` |

YAML defaults live in `layout.base.coordSync`; JSON conventions override.

## Types

- Keys use **camelCase** (`resumeId`, not `resume_id`).
- `type`: `agent | claude | kiro | opencode | empty`.
- `layout.minis` in this file can override profile yaml (`grid`, `max`, `leads`).

## Read path

```ts
loadMeshAgents(workspace, meshAgentsJsonPath)
meshToLegacyAgentsState(mesh)           // adapter for legacy-shaped callers
loadAgentsStateCompat(workspace, mesh, legacySeed)
```

Absent file → `null`; layout falls back to profile yaml until `save` populates JSON.

## Status

- [x] Schema, load, save, layout.minis override
- [ ] Full write path on every `switch` / `tag` (tracked in TODO.md)
