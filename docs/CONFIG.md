# Configuration

The engine reads **`mesh.config.yaml`** (Zod-validated). Discovery order:

1. `--profile <file-or-dir>`
2. `.sm/mesh.config.yaml` walking up from cwd
3. Bundled default under `profiles/` in the package

Run `profile show` to print resolved paths for the active profile.

## Top-level keys

| Key | Purpose |
|-----|---------|
| `name` | Profile label |
| `workspace` | Relative path from profile dir to project root |
| `layout` | Windows, grids, coord CLI types, `coordSync` |
| `session` | Tmux session name, worker count, mini max |
| `orchestrator` | Redis URL, drain tuning |
| `providers` | Enabled CLI families |
| `seats` | Seat file root, dir naming, templates |
| `state` | Paths to agents JSON files |
| `daemon` | Inbox port, autoStart, watch, poll intervals, manager prefix |
| `ports` | Port formula for workers (e.g. `30{n}0/30{n}1`) |
| `roles` | Directory of role YAML (relative to profile or `.sm`) |
| `data` | Runtime state root (daemon jsonl, optional agents move) |
| `ux` | Tool detection rules (pane capture regex -> border + triggers) |
| `connectivity` | Proxy driver, hooks, policy |
| `chatRooms` | Room ledger root, global slug, checkback defaults |
| `chatFiles` | Shared chat file root |
| `stack` | External command for `stack` subcommand passthrough |

Schema source: `packages/core/src/schema/profile.ts`.

## Layout

```yaml
layout:
  nvim:
    window: nvim
  base:
    window: base
    columns: [manager, secretary]
    managerStack: [manager]   # cold start default (profile yaml)
    # Runtime: mesh-agents.json layout.base.managerStack (passthrough extendable)
    # e.g. [manager, manager-b] after `./sm.sh launch manager-b`
    managerStackBottomPct: 50
    secretaryWidthPct: 50
    cli:
      manager: agent
      manager-b: opencode
      secretary: opencode
    coordSync:
      reload: false   # reload: start empty coord shells, never replace live CLI
      attach: true
  workers:
    window: workers
    grid: 3x2
    slots: 6
  minis:
    window: minis
    grid: 4x2
    max: 8
    leads: { top: 1, bottom: 2 }
```

## Session and daemon

```yaml
session:
  name: mesh
  scope: workspace     # default — session name mesh-<workspaceId>; port offset too
  workerCount: 6
  miniMax: 8

daemon:
  port: 31670          # fixed port when portScope: profile (profile default)
  portScope: profile   # or workspace — port = portBase + hash(workspace) % portRange
  portBase: 31670      # outside product 3000-3091; see PORTS.md
  portRange: 90
  autoStart: true
  watch: true          # supervisor: crash restart + HMR on daemon dist rebuild
  pollMs: 4000
  idleSettleSec: 5
  managerPromptPrefix: "[agent-manager-kiro-cursor-claude]"
```

**Which port is live?** `./sm.sh profile show` (`daemon_port=…`) or `./sm.sh inbox`.
Full allocation (mesh `:31670`, harness `:31699`): [PORTS.md](PORTS.md).

## Seats and state

```yaml
seats:
  root: tasks/agent-seats
  templates: [FOCUS, TASKS, REMINDER]
  dirs:
    manager: manager
    manager-b: manager-b
    secretary: secretary
    worker: "slot-{n}"
    mini: "mini-{n}"

state:
  agentsJson: tmux-main-agents.json      # optional read-only seed
  meshAgentsJson: mesh-agents.json         # mesh-owned live map
```

Paths are relative to `workspace` unless absolute.

## Runtime data

```yaml
data:
  root: .seatmesh    # or any path; daemon jsonl under {root}/daemon/
```

Target layout:

```text
{data.root}/
  daemon/
    INBOX.jsonl
    PEER.jsonl
    CHECKBACK.jsonl
    PANE_OPS.jsonl
    mesh-inbox.json
    mesh-inbox.log
```

Migration from a legacy path is profile-specific; the engine resolves via
`data.root` when wired (see [PORTABILITY.md](PORTABILITY.md)).

## UX tool detection

Declarative rules in `mesh.config.yaml` replace hardcoded OC-LIMIT / busy / AFK
heuristics. The daemon reads pane capture text, paints `@mesh_status`, and fires
connectivity triggers on rising edges.

```yaml
ux:
  useDefaults: true   # harness parity rules (OC-LIMIT, PROXY-DOWN, busy, typing, …)
  rules:
    - id: kiro-stuck
      for: [kiro]           # provider id, or "*" for any
      priority: 80          # higher = checked first; first match wins
      when:
        scan: { tailLines: 20 }   # or bottomLines / full: true
        match: "tool loop|rate limited"
        unless: "optional negative regex"
      set:
        phase: busy         # empty | typing | busy | afk | limit | plain_shell
        busyLabel: stuck
        border: STUCK       # tmux border strip; {kind} expands for busy/limit
      onRise: none          # optional daemon trigger (see below)
```

**`onRise` triggers** (limit rules only):

| Value | Effect |
|-------|--------|
| `connectivity.rate-limit` | OC-LIMIT episode + proxy recovery + resume wave |
| `connectivity.proxy-down` | PROXY-DOWN episode + `hooks.up` |
| `limits.oc-limit` / `limits.cc-limit` | Limit job enqueue (provider-specific) |
| `none` | Border only, no daemon side effect |

Omit the entire `ux` block to keep legacy built-in provider heuristics (minimal
profiles). Set `useDefaults: true` with `rules: []` for consumer/harness behavior.

Override a default by reusing its `id` (merged by id before priority sort).

Schema: `packages/core/src/schema/ux.ts`.

## Connectivity

```yaml
connectivity:
  enabled: true
  driver: none | http-proxy | script | cpe
  proxyPort: 18887
  hooks:
    status: ./bin/my-proxy status
    up: ./bin/my-proxy up
    rotate: ./bin/my-proxy rotate
  policy:
    cooldownMs: 1800000
    rotateMaxAttempts: 3
    rebootWifiBounce: false
    smartRestart: false
```

Agents use `proxy status|check|reset|rotate` only — not ad-hoc shell probes.

## Chat

```yaml
chatRooms:
  root: tasks/chat-rooms
  globalSlug: global
  checkback:
    duration: 5m
    renew: 3m

chatFiles:
  root: tasks/chat-files
  filename: CHAT.jsonl
```

## Stack passthrough

```yaml
stack:
  command: ./your-stack.sh
  summary: optional one-line description for help text
```

## Project init (`.sm/`)

```bash
npx seatmesh init [--force] [--seats-root PATH] [--name NAME]
```

Creates `.sm/mesh.config.yaml`, `.sm/roles/`, and README. Does not move or delete
existing seat FOCUS/TASKS files.

## Conventions in `mesh-agents.json`

`conventions.coordSync` and `conventions.launchSkipsEmpty` override yaml defaults
for reload and launch behavior. See [STATE.md](STATE.md).
