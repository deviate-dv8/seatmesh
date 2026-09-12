# Role YAML — dotdir schema (manager, secretary, worker, mini)

**Status:** spec (operator 2026-09-12) — implement with framework queue #1  
**Canonical prefs:** `tasks/seatmesh/queue/SEAT-MESH-PREFERENCES.md`

Every in-session agent gets POV docs + can/cannot from **consumer dotdir**, not from
consumer paths baked into the npm package.

---

## Where files live

```text
<workspace>/.sm/
  mesh.config.yaml
  roles/
    common.yaml       # merged into every role (banner, shared policies, shared guards)
    manager.yaml
    secretary.yaml
    worker.yaml
    mini.yaml
  README.md           # human: what .sm is, how to extend roles
```

**Engine package** ships **init templates** only:

```text
services/seatmesh/packages/cli/templates/init/roles/
  common.yaml
  manager.yaml        # not master.yaml
  secretary.yaml
  worker.yaml
  mini.yaml
```

`npx seatmesh init` copies templates -> `.sm/roles/`. User edits dotdir; init never
overwrites on re-run unless `--force`.

**Not in package `profiles/consumer/`** — consumer extends `.sm/roles/` with `.agent/` paths.

---

## Merge rules (same as today + extensions)

1. Load `roles/common.yaml` + `roles/<kind>.yaml` (`loadRoleIndex`).
2. `banner`, `read_first`, `files`, `policies` — union/dedupe (existing).
3. **New:** `guards`, `commands`, `funcs` — merge per `SEAT-MESH-PREFERENCES.md`
   (deny accumulates; child role overrides allow).

Pane `@mesh_role` picks kind: `manager` | `secretary` | `worker` | `manager-mini` -> `mini`.

---

## CLI: agent context

| Command | Job |
|---------|-----|
| `./sm.sh agent` | Role-filtered command tree (builtins + funcs) |
| `./sm.sh agent context` | List registered MDs (`read_first` + `files`) for **this pane**; flag `missing` |
| `./sm.sh agent context init` | Scaffold/fix `.sm/` dotdir; validate role paths; prompt agent to read registry; ensure inbox/labels/cold-start active |

`context init` is the **onboarding + stay-active** path: dotfiles exist, role yaml complete,
registered docs validated, then explicit read order before work.

---

## Section reference (every role file)

| Section | Purpose | Printed by |
|---------|---------|------------|
| `kind` | `manager` \| `secretary` \| `worker` \| `mini` | whoami index |
| `banner` | One-liners at top of cold-start / whoami | `./sm.sh whoami` |
| `read_first` | `{ path, note }` — read before work | whoami `file=` lines |
| `files` | Extra context paths (FYI grep) | whoami `file=` lines |
| `policies` | `{ id, text \| cmd \| path, rule? }` | whoami `policy_*=` lines |
| `guards` | `{ allow: [], deny: [] }` comms + builtins | `./sm.sh agent` (filtered tree) |
| `commands` | Builtin `./sm.sh` groups (optional; can stay TS catalog) | `./sm.sh agent` |
| `funcs` | `{ allow: [dc-sh], deny: [] }` attached externals | `./sm.sh agent`, `./sm.sh func` |
| `vars` | e.g. mini `job_role: "{{jobRole}}"` | whoami substitution |

Paths in `read_first` / `files` are **relative to workspace root** (parent of `.sm/`).

---

## Predefined templates (generic — init copies to dotdir)

### `common.yaml`

- Banner: engine pointer, `./sm.sh agent` + `./sm.sh whoami`
- `read_first`: `services/seatmesh/docs/ONE-PATH.md`, `.sm/README.md`
- `guards.deny`: `[merge, board.mutate]` for all roles
- `external.default: allow` in `mesh.config.yaml` (not in role file)

### `manager.yaml`

- `read_first`: manager coordination (package doc stub or `.sm/docs/manager.md` if user adds)
- `files`: `ONE-PATH.md`, `CHATROOM.md`, minis/secretary charter stubs under seatmesh docs
- `guards.allow`: coord, spawn.mini, prompt.worker, …
- `funcs.allow`: all registered (or explicit list including `dc-sh`, `notify`)

### `secretary.yaml`

- `read_first`: secretary transformer POV (digest, not flood master)
- `guards.allow`: send.coord, spawn.mini (limited), room.broadcast
- `guards.deny`: prompt.worker
- `funcs`: mini spawn subset, room broadcast
- `policies`: comms via `room say` / collect — not `to-master`

### `worker.yaml`

- `read_first`: worker POV (operator vs manager, prove, seat files)
- `files`: workflow/permissions stubs — **user replaces** with project docs (consumer: `.agent/`)
- `guards.allow`: room.say, to-slot, send.peer, snapshot
- `policies`: status via `./sm.sh room say "DONE|BLOCKED|PROVED|FYI: …"` (optional `-r managers`)
- `funcs.deny`: `[docker-exec]` example in template comment; user extends

### `mini.yaml`

- `read_first`: mini POV — not a worker seat; `mini done` protocol
- `policies`: checkback cmd, must-not (no prompt/switch/remind); status via `room say` not to-master
- `guards.deny`: spawn.mini, prompt.worker, peer
- `vars.job_role`: `"{{jobRole}}"` at spawn

---

## User extension (operator intent)

1. Run `npx seatmesh init` — get full role set with generic docs.
2. Edit `.sm/roles/worker.yaml` — add project `read_first` (consumer: `.agent/agent-seats.md`).
3. Edit `.sm/roles/common.yaml` — shared banner for whole team.
4. Add `deny_funcs` / `guards` on one role without copy-paste across eight minis.
5. Optional `.sm/docs/*.md` — reference from `read_first` for long POV (keep yaml thin).

**Do not** fork seatmesh package to change agent POV — extend dotdir only.

---

## Gaps today (implement queue)

| Gap | Fix |
|-----|-----|
| Init has `master.yaml`, no `mini.yaml` | Rename -> `manager.yaml`; add `mini.yaml` template |
| Init roles are stubs (`extends: common` unused) | Flesh out predefined sections per table above |
| Bundled `profiles/consumer/roles/` duplicates `.sm/` | Deprecate; consumer uses `.sm/roles/` only |
| No `guards` / `funcs` in schema | Extend `RoleIndex` + `renderRoleIndex` + `./sm.sh agent` |
| `./sm.sh agent` not wired | Filter TS catalog + yaml funcs by merged role |

---

## consumer consumer example (extends generic init)

After generic init, consumer adds to `.sm/roles/worker.yaml`:

```yaml
read_first:
  - path: .agent/agent-seats.md
    note: seat POV + worker gates
  - path: tasks/seatmesh/GATE-QUEUE.md
    note: serial framework queue when on consumer-all
funcs:
  deny: [docker-exec]
```

Manager yaml adds `.agent/manager-agent.md`, etc. — **never** checked into
`services/seatmesh/profiles/consumer/`.
