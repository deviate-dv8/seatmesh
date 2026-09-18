# Seatmesh lab — isolated container for upgrade / poke tests.

Host meshes (pia / zsign / live seatmesh) are **not** mounted. Lab HOME is a
Docker volume. Wipe anytime without touching the host.

## Quick start

```bash
cd test/lab
./lab.sh up              # seatmesh@1.2.5 by default
./lab.sh ssh             # interactive
# inside:
cd ~/mesh && seatmesh start
```

Or password SSH:

```bash
ssh -p 2222 lab@127.0.0.1
# password: seatmesh-lab
```

Key path (auto-generated on first `up`): `test/lab/keys/lab_ed25519`

## Modes

| `LAB_INSTALL` | Meaning |
|---------------|---------|
| `workspace` (default) | Uses bind-mounted monorepo `bin/seatmesh` (needs host `npm run build`) |
| `npm` | Installs from registry via `install-from-npm.sh` (rewrites broken `file:` deps) |

Published `seatmesh` still ships `file:../` workspace deps, so plain
`npm i -g seatmesh` is broken outside the monorepo. Lab `upgrade` always uses
the rewrite installer.

## Upgrade drill (does not pop host)

```bash
./lab.sh start-mesh
./lab.sh upgrade latest          # or: ./lab.sh upgrade 1.2.6
./lab.sh ssh                     # poke: whoami / session status / inbox
```

## Ports (host → container)

| Host | Inside | Use |
|------|--------|-----|
| 2222 | 22 | SSH |
| 31691 | 31691 | mesh-inbox |
| 3191 | 3190 | hub (if you `web up` inside) |

## Lifecycle

| Cmd | Effect |
|-----|--------|
| `./lab.sh down` | stop container, **keep** lab HOME |
| `./lab.sh wipe` | stop + delete volume (full re-seed) |
| `./lab.sh attach` | tmux attach `lab` session |
| `./lab.sh logs` | container logs |

## Agent note

When testing `seatmesh` upgrades, use this lab — not the operator’s live
sessions. Tell the operator: `test/lab/lab.sh ssh` (or password on :2222).
