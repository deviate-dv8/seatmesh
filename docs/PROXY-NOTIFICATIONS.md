# Proxy / OC recovery desktop notifications

How many Plasma toasts to expect when the CPE proxy rotates or OpenCode panes hit
PROXY-DOWN / OC-LIMIT. All **mesh-owned** toasts use title prefix **`inbox ·`**
(not `manager ·`).

Canonical notifier: `services/seatmesh/packages/daemon/src/oc-resume.ts`
(`INBOX_NOTIFY_SLOT = "inbox"`). Manual / standalone scripts use
`scripts/notify-inbox.sh` (same title shape).

## One recovery path only

| Path | When |
|------|------|
| **Mesh inbox daemon** (`./sm.sh`, `connectivity.enabled: true`) | Default — owns probe, rotate, resume, toasts |
| **Harness** `scripts/inbox-server.mjs` **`:31699`** | Legacy `dev` session only — **do not run with mesh** |
| **Standalone** `oc-recovery-loop.sh` / `oc-recovery-cron.sh` | Offline fallback — **stop these if mesh daemon is up** |

Running two daemons or standalone + mesh **doubles** recovery runs and toasts.

### Single mesh daemon

This workspace listens on **`:31670`** only. Port table: [PORTS.md](PORTS.md). Check:

```bash
curl -sS -m 3 http://127.0.0.1:31670/health | jq '{port, pid, ocLimitActive, proxyDownActive}'
ss -ltnp | grep -E '31670|31699'
./sm.sh inbox restart   # after port or daemon changes
```

## Expected toast count (mesh daemon, happy path)

All titles look like: `inbox · <TOPIC> (<phase>)`.

### PROXY-DOWN (connect error / ipify down, debounced)

| # | Phase | Topic | When |
|---|--------|--------|------|
| 1 | `starting` | PROXY-DOWN | Episode starts; `cpe-proxy-up.sh` runs |
| 2 | `resume sent` | OC resume | Carrier back; resume pasted to OC panes |
| 3 | `complete` | OC resume | All resumed panes cleared limit/connect UI |

Optional **4th**: `incomplete` PROXY-DOWN if still down ~120s after start.

**Typical: 3 toasts.** Shell scripts do **not** add extra toasts when spawned by
the daemon (`CPE_SKIP_DESKTOP_NOTIFY=1`).

### OC-LIMIT (rate limit rising edge)

| # | Phase | Topic | When |
|---|--------|--------|------|
| 1 | `starting` | OC-LIMIT | First limited pane in episode |
| 2 | `escalating` | OC-LIMIT | Only if Proxy-SMART did not change IP and rotate-until runs |
| 3 | `resume sent` | OC resume | After carrier IP change; resume pasted |
| 4 | `complete` | OC resume | All OC panes acked (limit screen gone) |

Optional **5th**: `incomplete` OC resume if some panes still limited after 5 minutes.

**Typical: 3–4 toasts** (4 if SMART chains to rotate-until).

### Manual rotate / reset (you run the script)

When **you** run `./scripts/cpe-proxy-rotate-until.sh` or `./legacy harness oc-proxy reset`
(not daemon-spawned), you may see **one** script toast:

- `inbox · Proxy rotate (complete)` or `inbox · Proxy reset (complete)`

The daemon may still send resume `sent` + `complete` if it detects the IP change.

## What should NOT appear

| Bad pattern | Cause |
|-------------|--------|
| `manager · Proxy rotate` / `manager · Proxy-SMART` | Old scripts — fixed to `inbox ·` |
| Two identical resume waves seconds apart | Two inbox daemons (`:31670` + `:31699` or stale `:3167`) |
| Extra `OC recovery (standalone)` toasts | `oc-recovery-loop.sh` / cron still running |
| Harness + mesh resume toasts | Both `:31699` and `:31670` up |

## Quick audit

```bash
pgrep -af 'mesh-inbox-server|inbox-server\.mjs|oc-recovery'
tail -5 tasks/agent-seats/manager/cpe-rotate-history.jsonl 2>/dev/null || true
```

## Related

- `.agent/fix-attempts.md` hub `cpe-oc-resume`
- `scripts/notify-inbox.sh` — shell parity with daemon titles
- `connectivity-recovery.ts` — episode machine + `CPE_SKIP_DESKTOP_NOTIFY` on spawn
