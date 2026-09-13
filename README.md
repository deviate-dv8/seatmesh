# seatmesh

Profile-driven tmux workbench for multi-agent coordination. One session layout,
one inbox daemon, pluggable agent CLIs (Cursor, Claude, Kiro, OpenCode), and
enqueue-only comms so nothing stomps a live composer.

## Install and cold start

### Global CLI (npm)

```bash
# If your shell inherits npm_config_prefix from this repo, unset it first:
bash scripts/global-install-seatmesh.sh          # seatmesh@latest from registry
bash scripts/global-install-seatmesh.sh local    # git checkout packages/cli

seatmesh --help
seatmesh init
```

`better-sqlite3` is **optional** — install succeeds without a C++ toolchain; profiles
with `storage.backend: sqlite` fall back to JSONL when the native module is missing.
For sqlite, use Node 22 LTS and `build-essential`, or set `storage.backend: jsonl`.

Publish (maintainers): `bash scripts/publish-npm.sh` after `npm login`. Schedule:
[docs/RELEASE.md](docs/RELEASE.md) (next: **2026-09-14**).

Global/npx installs print an **stderr upgrade hint** when npm has a newer `seatmesh`
(6h cache). `seatmesh update` refreshes profile vendor files — **not** the npm package;
use `npm install -g seatmesh@latest` or `npx seatmesh@latest`.

### Git checkout / monorepo

The CLI entry (`bin/seatmesh`) **auto-builds on first run**: if `dist/` is missing
or stale, it runs `npm install` and `npm run build` in the package root, then execs
the CLI. No manual build step required for normal use.

```bash
npx seatmesh
npx seatmesh init
npx seatmesh session up

# Git checkout (development)
./bin/seatmesh --help

# Consumer wrapper (example: workspace-root sm.sh)
./sm.sh session up
```

Point the CLI at your project config with `--profile <dir>` (directory containing
`.sm/mesh.config.yaml` or `mesh.config.yaml`) or rely on discovery walking up from
cwd for `.sm/`.

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/README.md](docs/README.md) | Full index |
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Init, session, reload, inbox |
| [docs/ONE-PATH.md](docs/ONE-PATH.md) | Command reference (one table) |
| [docs/FEATURES.md](docs/FEATURES.md) | Feature overview |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layout, daemon, providers |
| [docs/CONFIG.md](docs/CONFIG.md) | `mesh.config.yaml` reference |
| [docs/SLOTS.md](docs/SLOTS.md) | Slots, roles, seat files |
| [docs/STATE.md](docs/STATE.md) | `mesh-agents.json` |
| [docs/COMMS.md](docs/COMMS.md) | Inbox, peer, checkback flow |
| [docs/CHATROOM.md](docs/CHATROOM.md) | Room ledger and broadcast |
| [docs/CHATFILE.md](docs/CHATFILE.md) | Shared chat files |
| [docs/PORTABILITY.md](docs/PORTABILITY.md) | Connectivity hooks, data layout |
| [docs/PORTS.md](docs/PORTS.md) | Inbox ports (`:31670` mesh, `:31699` harness) |

Bundled profiles live under `profiles/` (`minimal`, …). Consumer-specific notes
belong in each project's `.sm/` dotdir, not in the engine docs above.

## Package layout

```text
services/seatmesh/
  bin/seatmesh          CLI entry (cold start + node dist)
  packages/
    core/                Schemas, profile loader, chatroom, paths
    cli/                 Command router (npm package seatmesh)
    tmux/                Session, launch, inject, seats
    daemon/              Inbox server (sole pane writer)
    providers/           Agent CLI detection and inject plans
    connectivity/        Proxy probe and recovery hooks
  profiles/              Shipped example configs
```

## Status

Version **0.1** — session layout, workspace-scoped tmux sessions (`mesh-{hash}`),
profile-driven runtime paths (`data.root`), enqueue comms, room/chat, connectivity
hooks, and supervised inbox daemon. Internal parity tracking: [TODO.md](TODO.md).
