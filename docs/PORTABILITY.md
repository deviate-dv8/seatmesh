# Portability

How to run seatmesh on **any** workspace: custom proxy, optional connectivity,
and a single runtime data directory. Engine code stays free of checkout-specific
paths; the profile supplies hooks and roots.

Read with [CONFIG.md](CONFIG.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Modes

| Profile | Connectivity | Typical use |
|---------|--------------|-------------|
| `profiles/minimal/` | `enabled: false` | Package demo, no proxy |
| Custom `profiles/yours/` | `driver` + `hooks` | Your repo |
| Consumer profiles | preset or `script` | Full layout + optional CPE preset |

**Launch wrappers:** OpenCode (or any CLI) should be started via profile launch
config so proxy env is applied — not manual exports in agent chat.

## Runtime data (`data.root`)

All daemon JSONL and inbox meta should live under one gitignored tree:

```yaml
data:
  root: .seatmesh
```

```text
{data.root}/
  daemon/
    INBOX.jsonl
    PEER.jsonl
    CHECKBACK.jsonl
    PANE_OPS.jsonl
    mesh-inbox.json
    mesh-inbox.log
  agents.json              # optional: mesh-agents relocation
  history/
    rotate.jsonl           # connectivity rotate audit
```

Rules:

- Resolve `data.root` from profile `workspace`.
- Product seat files stay under `seats.root`, not inside `data.root`.
- Chat ledgers stay under `chatRooms.root` / `chatFiles.root`.

## Connectivity

One CLI surface; profile picks the implementation.

```bash
./sm.sh proxy status
./sm.sh proxy check
./sm.sh proxy reset
./sm.sh proxy rotate
```

### Profile shape

```yaml
connectivity:
  enabled: true
  proxyPort: 18887
  driver: none | http-proxy | script | cpe

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

| `driver` | Behavior |
|----------|----------|
| `none` | No recovery jobs |
| `http-proxy` | Probe listen + carrier check only |
| `script` | Daemon runs `hooks.*` |
| `cpe` | Bundled preset mapping to known hook scripts (opt-in per profile) |

### Hook contract

Workspace-relative executables. Exit code = verify signal; stdout may emit
`key=value` lines (`carrier=1.2.3.4`). Hooks must be idempotent; daemon dedupes
episodes with cooldown and in-flight guards.

### Orchestrator flow

```text
limit detector (provider)
        |
        v
  enqueue connectivity job
        |
        v
  daemon runs profile hook
        |
        v
  on success: optional resume wave via inject queue
```

Recovery runs **inside the daemon process**, never synchronously in an agent pane.

## Seats without a fixed tree

Use `npx seatmesh init` and set `seats.root` to your layout. Minimal profile
works without chat rooms or stack passthrough.

## FAQ

**Can I disable connectivity entirely?**  
Yes — `connectivity.enabled: false` or `driver: none`.

**Where does rotation run?**  
In the mesh inbox daemon async worker, triggered by limit hooks.

**Do I need Redis?**  
No for core operation. BullMQ accelerates drain when Redis is reachable; poll
loop remains the fallback.
