# Quick start

## Cold start (automatic)

`bin/seatmesh` checks for a built CLI (`packages/cli/dist/main.js`) and
`node_modules`. If anything is missing or `package.json` is newer than dist, it
runs `npm install` and `npm run build` once, then starts Node. You do not need a
separate build step before the first `./sm.sh` or `./bin/seatmesh` call.

## New project

```bash
cd your-project
npx seatmesh init              # creates .sm/mesh.config.yaml + roles/
npx seatmesh profile show      # confirm workspace + seats.root
npx seatmesh session up        # create tmux session from profile
npx seatmesh whoami            # identity in a pane (or pass slot target)
```

`init` never deletes existing seat files under your configured `seats.root`.

## Existing checkout with `.sm/`

Many consumers add a one-line wrapper:

```bash
./sm.sh                  # outside tmux: attach or create session
./sm.sh session status   # panes and @mesh_* labels
./sm.sh reload           # rebuild engine + refresh labels (no session kill)
./sm.sh whoami           # this pane: role, slot, ports, hub lines
```

Inside a mesh pane, bare `./sm.sh` runs `whoami` for the current pane.

## Typical session flow

```bash
./sm.sh session up       # layout + coord CLIs + inbox daemon (if autoStart)
./sm.sh launch all       # (re)launch agent CLIs from mesh-agents.json
./sm.sh providers scan   # live CLI per pane
./sm.sh verify           # layout + label health
./sm.sh save             # scrape session -> mesh-agents.json
```

## Inbox daemon

When `daemon.autoStart` is true (default), `session up`, `reload`, and attach
start the supervised inbox on the profile **daemon port** (consumer: **`:31670`**, outside
product 3000s). Producers only append JSONL queues; the daemon is the **only** component
that injects into panes.

```bash
./sm.sh inbox            # health + status (shows :PORT)
./sm.sh profile show     # daemon_port=31670 (consumer)
./sm.sh inbox restart    # manual recycle (supervisor also restarts on crash/HMR)
```

Port table (mesh vs harness **:31699**): [PORTS.md](PORTS.md).

Runtime files live under the profile `data.root` (see [CONFIG.md](CONFIG.md)).

## Stack passthrough (optional)

If the profile defines `stack.command`, `./sm.sh stack …` execs that command
(docker, compose, etc.). seatmesh does not embed a stack driver; the profile
names the external script.

## Next

- Command picker: [ONE-PATH.md](ONE-PATH.md)
- Config keys: [CONFIG.md](CONFIG.md)
- Feature list: [FEATURES.md](FEATURES.md)
