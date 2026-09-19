# seatmesh

Run several AI coding agents (Claude, Cursor, OpenCode, Kiro) side by side in one
tmux session, and talk to them from one CLI instead of switching panes by hand.
seatmesh lays out the panes, launches the CLIs, and routes messages between them
through a single background daemon — so two commands never paste into the same
pane at once.

## Try it

```bash
cd your-project
npx seatmesh start
```

That's the whole quickstart. `start` sets up `.sm/` config the first time you run
it, then builds the tmux session and attaches. Run it again any time — if the
session already exists, it just attaches to it.

## Install it properly (recommended after you've tried it)

```bash
bash scripts/global-install-seatmesh.sh   # installs seatmesh@latest from npm
sm install                                # symlinks `sm` (+ `seatmesh`) onto your PATH
sm --help
```

Prefer the short alias `sm` day to day — `seatmesh` still works everywhere.

`better-sqlite3` (faster local storage) is optional — install works fine without a
C++ toolchain; it falls back to plain JSONL files. To use sqlite, install with
Node 22 LTS + `build-essential`, or just set `storage.backend: jsonl` in your config.

### Working from a git checkout instead of npm

```bash
./bin/sm --help        # auto-builds dist/ on first run, no manual build step
npx seatmesh session up
```

Point any command at a specific project with `--profile <dir>` (a directory
containing `.sm/mesh.config.yaml`), or just run from inside the project — seatmesh
finds `.sm/` by walking up from your current directory.

## Learn more

| Doc | What's in it |
|-----|---------------|
| [docs/README.md](docs/README.md) | Full documentation index |
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Init, session, reload, inbox — walked through |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the daemon, panes, and providers fit together |
| [docs/CONFIG.md](docs/CONFIG.md) | `mesh.config.yaml` reference |
| [docs/COMMS.md](docs/COMMS.md) | How agents message each other (inbox, peer, checkback) |
| [docs/CHATROOM.md](docs/CHATROOM.md) | Shared chat rooms between agents |
| [TODO.md](TODO.md) | What's built, what's in progress, what's just an idea |

Bundled example configs live under `profiles/`. If you're using seatmesh in your
own project, put project-specific notes in that project's `.sm/` folder, not here.

## How the code is organized

```text
bin/seatmesh          CLI entry point
packages/
  core/                Config schema, profile loading, shared types
  cli/                 The `seatmesh`/`sm` command itself
  tmux/                Session layout, launching CLIs, injecting messages
  daemon/              The inbox daemon (the only thing that writes to a pane)
  providers/           Per-CLI detection (is this pane running Claude? Cursor?)
  connectivity/        Proxy/network recovery hooks
profiles/              Example configs you can copy from
```

## Status

Current version: see `package.json` (`npm run seatmesh -- version`). Actively
developed — see [TODO.md](TODO.md) for what's done, in progress, or still just an
idea, and [NOW.md](NOW.md) for what's happening this week.
