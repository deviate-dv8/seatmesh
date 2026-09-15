# `.sm/` dotdir — layout, locked roles, contracts, runtime, update

**Status:** spec (operator 2026-09-12) — implement with framework queue #1 / #1d  
**Prefs:** `tasks/seatmesh/queue/SEAT-MESH-PREFERENCES.md`

---

## Hard rule — no external harness paths

**All seatmesh runtime, logs, ledgers, and harness state live under the profile dotdir (`.sm/`).**
The engine must **not** read or write harness files outside `.sm/` except:

| Allowed outside `.sm/` | Why |
|------------------------|-----|
| Product source / docs (e.g. `.agent/`, app repos) | Not harness state |
| `stack.command` target (e.g. `./dc.sh`) | Consumer stack driver — workspace tool, not mesh state |
| Optional read-only `state.agentsJson` seed (legacy harness) | Read-only migration; mesh-owned file moves to `.sm/` |

**Forbidden for new work:**

- `tasks/seatmesh/daemon/*` (INBOX, PEER, CHECKBACK, logs)
- `tasks/seatmesh/minis.json`, `GATE-QUEUE.md`, `MINI-DONE.md`, …
- `tasks/chat-rooms/*`, `tasks/chat-files/*`
- Workspace-root `mesh-agents.json`
- Hardcoded `tasks/seatmesh` in TS — resolve **only** from profile + manifest

**Consumer:** `.sm/mesh.config.yaml` must use dotdir-relative harness paths (see target yaml below). Run `npx seatmesh migrate-runtime` once; then stop using external copies.

---

## Path resolution — everything in JSON

Human source: **`mesh.config.yaml`**.  
Engine canonical map: **`.sm/paths.json`** (generated on `init`, `update`, `profile validate`).

```json
{
  "version": 1,
  "profileDir": "/abs/.../project/.sm",
  "workspace": "/abs/.../project",
  "paths": {
    "dataRoot": ".sm/runtime",
    "daemonDir": ".sm/runtime/daemon",
    "seatsRoot": ".sm/seats",
    "meshAgentsJson": ".sm/mesh-agents.json",
    "chatRoomsRoot": ".sm/chat-rooms",
    "chatFilesRoot": ".sm/chat-files",
    "rolesDir": ".sm/roles",
    "contractsDir": ".sm/contracts"
  }
}
```

**Rules (implement):**

1. Keys under `data`, `seats`, `state`, `chatRooms`, `chatFiles`, `roles` in yaml are **relative to `profileDir`** (`.sm/`), not workspace root — unless key `paths.scope: workspace` is set for a one-off legacy migration.
2. `paths.json` stores workspace-relative strings for every resolved path; daemon/inbox code reads **`paths.json` only** after load (yaml → validate → write manifest → use manifest).
3. **`npx seatmesh update`** refreshes `_vendor/` and rewrites `paths.json` if yaml changed; never clobber user data under `runtime/`, `chat-rooms/`, `seats/`, `contracts/locks/`.
4. Init creates empty trees: `runtime/daemon/`, `chat-rooms/global/`, `seats/manager/`, … + `.gitignore` for `runtime/**`, `*.log`, `paths.json` optional commit.

---

## CLI entry

**Primary:** `npx seatmesh` prints plain help (no status probe). Use `report` for stack status.

```bash
npx seatmesh report            # stack status (was implicit default pre-1.0.3)
npx seatmesh init              # create .sm/ + paths.json
npx seatmesh update            # refresh locked vendor; rewrite paths.json; migrate hints
npx seatmesh profile validate  # yaml + paths.json + missing dirs
npx seatmesh agent context
npx seatmesh session attach
```

Workspace `./sm.sh` (when present) wraps `npx seatmesh --profile .sm`.

---

## Dotdir layout (full)

```text
.sm/
  mesh.config.yaml           # human config; paths relative to this dir
  paths.json                 # generated resolved map (engine reads this)
  README.md
  mesh-agents.json           # live CLI + resume per slot (was workspace root)
  .gitignore                 # runtime logs, optional paths.json

  runtime/                   # data.root (default: runtime)
    daemon/                  # all daemon JSONL + inbox meta + logs
      INBOX.jsonl
      PEER.jsonl
      CHECKBACK.jsonl
      PANE_OPS.jsonl
      CALLS.jsonl
      mesh-inbox.json
      mesh-inbox.log
      mesh-inbox.stop
      cold-start.json
      ppa-state.json
      cpe-wifi-probe.lock
    minis.json               # campaign state (was tasks/seatmesh/)
    mini-manifest.json
    MINI-DONE.md
    GATE-QUEUE.md            # optional; framework queue mirror

  seats/                     # seats.root (default: seats) — FOCUS/TASKS/REMINDER
    manager/
    secretary/
    slot-{n}/
    mini-{n}/
    _shared/                 # HQ + workers + minis shared MDs (NOTES.md)
    _snapshots/              # cold archive

  chat-rooms/                # chatRooms.root (default: chat-rooms)
    global/
    managers/
    supervise/
      profile.yaml
      CHAT.jsonl

  chat-files/                # chatFiles.root — per-slot CHAT.jsonl if used
    slot-1/
      CHAT.jsonl

  roles/
    _vendor/                 # LOCKED — npx seatmesh update
      common.yaml
      manager.yaml
      secretary.yaml
      worker.yaml
      mini.yaml
    manager.extend.yaml      # USER — never overwritten
    ...

  contracts/
    _vendor/
      supervise.yaml
    supervise.extend.yaml
    locks/
      supervise/
        mini-3.on
    README.md
```

**Merge order (roles):** `_vendor/common.yaml` + `_vendor/<kind>.yaml` + `<kind>.extend.yaml`  
**Merge order (contracts):** `_vendor/<id>.yaml` + `<id>.extend.yaml` + runtime `locks/`

Optional footnote in seat `FOCUS.md`: `contract=supervise lock=.sm/contracts/locks/supervise/mini-3.on`

---

## Target consumer `mesh.config.yaml`

Replace workspace-scattered paths with dotdir-relative keys:

```yaml
name: consumer
workspace: ..

seats:
  root: seats                    # → .sm/seats/ (migrate from tasks/agent-seats)

state:
  meshAgentsJson: mesh-agents.json   # → .sm/mesh-agents.json
  agentsJson: tmux-main-agents.json  # optional legacy seed at workspace root (read-only)

chatRooms:
  root: chat-rooms               # → .sm/chat-rooms/

chatFiles:
  root: chat-files

data:
  root: runtime                  # → .sm/runtime/

roles:
  dir: roles

paths:
  scope: profile                 # default for greenfield; engine resolves under profileDir
```

**Migration (one-time, implement):**

1. `npx seatmesh migrate-runtime` (or `update --migrate`): copy `tasks/seatmesh/daemon/*` → `.sm/runtime/daemon/`, `tasks/chat-rooms/*` → `.sm/chat-rooms/`, `mesh-agents.json` → `.sm/mesh-agents.json`, `tasks/agent-seats/*` → `.sm/seats/` if `--seats`.
2. Rewrite `paths.json`; print diff of old vs new paths.
3. Leave legacy dirs in place with `README.migrated` stub pointing at `.sm/` — do not dual-write.

---

## Locked vs extend (update-safe)

| Path | Who writes | `npx seatmesh update` |
|------|------------|------------------------|
| `roles/_vendor/**` | package templates (role-pack) | **Replace** when content differs |
| `roles/_vendor/ROLE_PACK.json` | engine | **Stamp** pack version (e.g. 1.1.0) |
| `roles/_vendor/docs/*.md` | package | **Replace** — locked base POV MDs |
| `roles/*.extend.yaml` | user / project | **Never touch** |
| `contracts/_vendor/**` | package templates | **Replace** on update |
| `contracts/*.extend.yaml` | user | **Never touch** |
| `contracts/locks/**` | engine (`contract on`) + user | **Never touch** |
| `runtime/**`, `chat-rooms/**`, `seats/**` | engine + agents | **Never delete** on update |
| `mesh.config.yaml` | init + user | **Merge-only** new keys from template |
| `paths.json` | engine | **Regenerate** from yaml |

User **never edits `_vendor/`**. Project POV goes in `*.extend.yaml` only.

Each vendor role yaml declares:

```yaml
locked:
  - banner
  - read_first
  - policies
```

`seatmesh roles migrate` / `roles migrate --to 1.0.0` moves packs **up or down**.
`seatmesh update` refreshes `_vendor` and auto-migrates to the current pack.

---

## `npx seatmesh update`

1. Compare package template manifest vs `.sm/.seatmesh-version`.
2. Copy refreshed `roles/_vendor/*`, `contracts/_vendor/*`.
3. **Do not** modify `*.extend.yaml`, `contracts/locks/**`, `runtime/**`, `chat-rooms/**`,
   or overwrite live seat `FOCUS`/`TASKS`. **Do** seed missing `seats/_shared/` + seat trios
   (idempotent, create-only).
4. Merge new `mesh.config.yaml` keys from template when missing (`# added by seatmesh update`):
   `layout.base.humanCoTyped`, `layout.logs`.
5. Regenerate `paths.json`.
6. Stamp `.sm/.seatmesh-version` with the running CLI package version.
7. If this profile's inbox has run before, restart it on **this profile's daemon port only**
   (`portScope: workspace` — other meshes e.g. zsign are untouched). Skip with
   `--no-restart-inbox`.
8. Print summary (refreshed / skipped / role-pack / config-merge).

Vendor sync is **file-by-file** under `_vendor/` only (content diff) — never wipe
`runtime/`, `seats/`, `chat-rooms/`, or the npx/npm install tree.

```bash
npx seatmesh update
npx seatmesh update --dry-run
npx seatmesh update --migrate   # also move legacy tasks/seatmesh → .sm/runtime
npx seatmesh update --no-restart-inbox
```

---

## Contracts in dotdir

| Piece | Location |
|-------|----------|
| Contract definition | `.sm/contracts/_vendor/<id>.yaml` + `<id>.extend.yaml` |
| Room ledger | `.sm/chat-rooms/<slug>/` — slug matches contract id |
| Seat bound to contract | `.sm/contracts/locks/<id>/<agent-id>.on` |

```bash
npx seatmesh contract on supervise --agent mini-3
npx seatmesh contract off supervise --agent mini-3
npx seatmesh contract list
```

Contract yaml (minimal):

```yaml
id: supervise
room_slug: supervise
members: [mini-1, mini-2]
leads: [mini-1, mini-2]
supervisor: secretary
guards:
  deny: [peer, mini.spawn]
```

---

## Init vs update

| Command | Creates | Copies locked | paths.json |
|---------|---------|---------------|------------|
| `npx seatmesh init` | full `.sm/` tree | yes `_vendor/*` | yes |
| `npx seatmesh update` | — | refresh `_vendor/*` | regenerate |

Greenfield: commit `_vendor/` + extend stubs; gitignore `runtime/daemon/*.log` and large JSONL if desired.

---

## Engine changes (implement checklist)

- [ ] `resolveDataRoot` / `meshRuntimePaths` / chatroom / chatfile / seat paths → **profileDir-relative** via `paths.json`
- [ ] Remove defaults `tasks/chat-rooms`, `tasks/seatmesh`, workspace `mesh-agents.json` from schema defaults → dotdir defaults
- [ ] Daemon startup: refuse if resolved path escapes `.sm/` (safety guard)
- [ ] Consumer `.sm/mesh.config.yaml` + `migrate-runtime` command
- [ ] Docs: ONE-PATH, COMMS, PROFILES, `.agent/agent-seats.md` seat path → `.sm/seats/`

---

## Storage (SQLite target)

Daemon queue state moves from JSONL files to **`.sm/runtime/mesh.sqlite`**; Redis/BullMQ
cut (optional wake only). See [STORAGE.md](STORAGE.md). Implement after paths (#1d) land.

---

## Related

- [STORAGE.md](STORAGE.md) — SQLite vs JSONL, Redis cut, phased plan
- [ROLE-YAML.md](ROLE-YAML.md) — role sections
- [PROFILES.md](PROFILES.md) — package vs consumer
- [AGENT-FUNC-GUARDS.md](../../tasks/seatmesh/queue/AGENT-FUNC-GUARDS.md) — guards + chat comms
