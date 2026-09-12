# Inbox ports: seat-mesh vs harness

Agent inbox daemons live in a **dedicated 316xx block** — outside consumer product ports
(`3000`–`3091` feature slots, `:5080` gateway, etc.).

## Port allocation (consumer workspace)

| Service | Harness | Port | Notes |
|---------|---------|------|--------|
| consumer main FE/BE | `./dc.sh` | `3000` / `3001` | Product — not inbox |
| Feature slot N FE/BE | `./dc.sh` | `30N0` / `30N1` | Product — not inbox |
| **Seat-mesh inbox** | `./sm.sh` | **`:31670`** | `mesh-inbox-server.js` |
| **Legacy dev inbox** | `./legacy harness` | **`:31699`** | `scripts/inbox-server.mjs` |
| CPE proxy (local) | scripts | `:18887` | Carrier curl — not inbox |

**Rule:** mesh panes use **`./sm.sh`** + **`:31670`** only. **`dev`** panes use
**`./legacy harness`** + **`:31699`** only. Never mix ports across sessions.

## Verify live port

```bash
./sm.sh inbox              # inbox: up :31670 session=mesh ...
./sm.sh profile show       # daemon_port=31670
curl -sS -m 3 http://127.0.0.1:31670/health | jq '{port, pid, engine}'
```

Config: `.sm/mesh.config.yaml` (`daemon.port: 31670`, `portScope: profile`).

## Why not 3000s?

Earlier mesh used `portBase: 3100` + workspace hash (consumer landed on `:3167`) and the
harness used `:3099` — all crowded against feature slot ports and common dev defaults.
Current policy:

- **31670** — mesh inbox (fixed per profile for consumer)
- **31699** — harness inbox (fixed default in `legacy harness` / `inbox-server.mjs`)
- **31671+** — optional other profiles (e.g. `profiles/minimal`)

Override mesh port only in yaml:

```yaml
daemon:
  port: 31670
  portScope: profile   # fixed; omit for workspace hash offset from portBase
  portBase: 31670
  portRange: 90
```

Workspace-scoped mode (multi-checkout on one host):

```text
port = portBase + (hash(workspace_absolute_path) mod portRange)
```

## Legacy harness `:31699` (not seat-mesh)

| Item | Detail |
|------|--------|
| Started by | `./legacy harness inbox-server start` |
| Script | `scripts/inbox-server.mjs` |
| Port | **31699** (`INBOX_PORT` env override) |
| Session | tmux **`dev`** |

If you only use **`mesh`**, you do not need `:31699` running.

## Stale listeners

After a port change, clear deprecated listeners:

```bash
./legacy harness inbox-server clear-ghosts
# or: ./scripts/clear-inbox-ports.sh
# Stop harness inbox too: CLEAR_HARNESS=1 ./scripts/clear-inbox-ports.sh
ss -ltnp | grep -E '31670|31699'
./sm.sh inbox restart
```

Deprecated ports (always safe to clear): **3099**, **3100**, **3167**.

## Related

| Doc | Topic |
|-----|--------|
| [CONFIG.md](CONFIG.md) | `daemon.*` keys |
| [PROXY-NOTIFICATIONS.md](PROXY-NOTIFICATIONS.md) | Recovery toasts (one daemon) |
| `.agent/local-dev.md` | Product port table |
