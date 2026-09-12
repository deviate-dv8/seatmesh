# Features

## Session and layout

- **Profile-driven tmux session** — windows for editor, base (manager column), workers
  grid, and minis grid; sizes and names from `mesh.config.yaml`.
- **Attach / up / status** — create or join the session without nesting tmux.
- **Reload** — rebuild the engine, refresh labels and borders; optional `--layout`
  to re-grid (guarded when live panes would be killed).
- **Layout** — workers 3×2 (default six seats), minis grid with configurable leads
  (`2x2`, `4x2`, etc.) via tmux layout only (no kill/respawn for retile).
- **Labels and borders** — `@mesh_role`, `@mesh_slot`, `@mesh_ports`, title and
  status segments on each pane.
- **Verify** — smoke layout and label health.

## Agent CLIs (providers)

- **Pluggable providers** — Cursor agent, Claude Code, Kiro, OpenCode, empty shell.
- **Detect / scan** — live CLI vs plain shell per pane.
- **Launch / switch / handoff** — start or replace a CLI with optional resume id;
  coord panes follow `layout.base.coordSync` (reload never replaces a live CLI when
  `reload: false`).
- **Prompt / remind / flush** — manager paths enqueue inject work; flush rescues
  stuck composer Enter.
- **Peek / ppa** — pane metadata, scrollback, performance index.

## Coordination seats

- **Manager and secretary** — full-height base column; optional stacked manager-b.
- **Workers** — numbered slots with paired FE/BE port formula from profile.
- **Minis** — parallel helper panes with spawn, prompt, done, dispatch.
- **Seat files** — FOCUS, TASKS, REMINDER under `seats.root`; cold-start and
  `whoami` inline hub; `seat init` ensures templates exist.
- **Contexts / snapshot** — seat map, cold archive of finished work.

## Comms (enqueue only)

CLI and agents **append queues**; the inbox daemon **drains and injects**.

| Mechanism | Purpose |
|-----------|---------|
| `to-master` | Status and substance to manager inbox |
| `to-slot` / `to-mini` | Peer worker or mini message |
| `prompt` / `remind` | Manager → worker inject |
| `checkback` | Poll-later timer (`patience` alias) |
| `room say` / `broadcast` | Durable chat ledger + optional fan-out |
| `PANE_OPS` | Serial launch, restart, relayout |

See [COMMS.md](COMMS.md) and [CHATROOM.md](CHATROOM.md).

## Inbox daemon

- HTTP health on configured port; JSONL stores under `data.root`.
- Single drain loop: inbox, peer, checkback, pane ops, border paint.
- Optional BullMQ when Redis is reachable; poll loop remains the reliable path.
- Supervisor: crash restart + reload when daemon dist changes after build.
- Limit hooks (rate limit, connect errors) enqueue recovery; handlers do not
  call tmux directly.

## Connectivity (optional)

- `proxy status|check|reset|rotate` — profile-driven driver (`none`, `http-proxy`,
  `script`, custom hooks, or bundled `cpe` preset).
- Probes local proxy port and carrier IP; recovery runs inside the daemon.

See [PORTABILITY.md](PORTABILITY.md).

## ChatRoom and ChatFile

- **Rooms** — append-only ledger per slug; global room by default; tail at turn
  start; manager broadcast.
- **Chat files** — shared JSONL artifacts under configured root.

## State

- **`mesh-agents.json`** — mesh-owned CLI type and resume id per slot; `./sm.sh save`
  scrapes live session.
- **Role index** — YAML under `roles.dir` for cold-start briefings and policy text.

See [STATE.md](STATE.md).

## Init and portability

- **`npx seatmesh init`** — project `.sm/` dotdir with config and role templates.
- **Profile discovery** — `--profile`, `.sm/mesh.config.yaml` walk-up, or bundled
  default profile in the package.

See [CONFIG.md](CONFIG.md).
