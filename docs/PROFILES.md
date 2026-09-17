# Profiles — package vs consumer workspace

Where config lives, how paths resolve, and why bundled `profiles/consumer/` is messy
(operator 2026-09-12).

Read with [PORTABILITY.md](PORTABILITY.md) and [CONFIG.md](CONFIG.md).

---

## Two layers (target)

| Layer | Location | Relative to | Contains |
|-------|----------|-------------|----------|
| **Engine package** | `services/seatmesh/profiles/minimal/` | seatmesh repo root | Generic session layout, daemon defaults, **no product paths** |
| **Consumer dotdir** | `<workspace>/.sm/` | consumer project root (`workspace: ..`) | Product seats, roles, func registry, connectivity hooks |

```text
seatmesh/                          # npm package / git submodule
  profiles/minimal/mesh.config.yaml # default when no .sm
  profiles/minimal/roles/           # generic role stubs only

consumer/                              # consumer workspace
  .sm/mesh.config.yaml              # workspace: ..
  .sm/paths.json                    # generated harness path manifest (engine reads)
  .sm/roles/*.yaml                  # .agent read_first, func deny, consumer banners
  .sm/runtime/daemon/               # logs + INBOX/PEER/CHECKBACK JSONL
  .sm/seats/                        # FOCUS/TASKS/REMINDER (migrate from tasks/agent-seats)
  .sm/chat-rooms/                   # room ledgers (migrate from tasks/chat-rooms)
  .sm/mesh-agents.json              # live CLI map (migrate from workspace root)
```

**Rule:** product-specific yaml (**consumer**, `.agent/`, `./dc.sh`, CPE scripts) belongs in **consumer `.sm/`**, not committed as the engine's only bundled profile.

---

## How paths resolve today

`loadProfile()` reads `mesh.config.yaml`, then:

| Key | Resolved from |
|-----|----------------|
| `workspace:` | Relative to **directory containing mesh.config.yaml** (`profileDir`) |
| `roles.dir:` | Relative to **profileDir** (e.g. `.sm/roles/`) |
| `data.root`, `seats.root`, `chatRooms.root`, `chatFiles.root`, `state.meshAgentsJson` | Relative to **profileDir** (`.sm/`) — see [DOTDIR.md](DOTDIR.md) |
| `stack.command`, connectivity hooks | Relative to **resolved workspace** |

Example (correct consumer):

```yaml
# consumer/.sm/mesh.config.yaml
workspace: ..
roles:
  dir: roles
seats:
  root: seats              # → .sm/seats/
data:
  root: runtime
chatRooms:
  root: chat-rooms
state:
  meshAgentsJson: mesh-agents.json
stack:
  command: ./dc.sh
paths:
  scope: profile
```

Example (legacy bundled — **avoid**):

```yaml
# services/seatmesh/profiles/consumer/mesh.config.yaml
workspace: ../../../../    # escapes package tree to monorepo root — fragile
roles:
  dir: roles               # consumer-specific read_first inside package
```

---

## Why bundled `profiles/consumer/` is unclean

1. **`workspace: ../../../../`** — profile dir is deep inside `services/seatmesh/`; workspace pointer jumps out to consumer root instead of living in `.sm/`.
2. **Role yaml cites consumer-only paths** — `.agent/*`, `AGENTS.md`, `tasks/seatmesh/GATE-QUEUE.md`, `30N0/30N1` banners, `./dc.sh` policies.
3. **Duplicate config** — same content copied in `profiles/consumer/` and workspace `.sm/` (drift risk).
4. **Default profile pick** — `defaultProfilePath()` prefers bundled consumer when `.sm` missing; couples engine default to one consumer.

**Current consumer checkout:** `sm` uses `.sm/mesh.config.yaml` when present (walk-up / `--profile .sm`) — good. The bundled copy is fallback / historical.

---

## Target cleanup (framework queue)

| Step | Action |
|------|--------|
| 1 | `defaultProfilePath()` -> **minimal** only |
| 2 | Treat `profiles/consumer/` as deprecated; document migration to `.sm/` |
| 3 | All consumer role yaml only under `consumer/.sm/roles/` |
| 4 | Package `roles/` = neutral stubs (`read_first: docs/ONE-PATH.md` under seatmesh) |
| 5 | Func registry + `guards` in consumer yaml (see `tasks/seatmesh/queue/SEAT-MESH-PREFERENCES.md`) |

Greenfield: `npx seatmesh init` already emits `workspace: ..` and `.sm/runtime` — that shape is canonical.

---

## Role docs in dotdir (operator 2026-09-12)

Init must scaffold **complete** role yaml for all pane kinds — not empty stubs:

```text
.sm/roles/common.yaml
.sm/roles/manager.yaml
.sm/roles/secretary.yaml
.sm/roles/worker.yaml
.sm/roles/mini.yaml
```

Each file carries predefined `read_first`, `files`, `banner`, `policies`, and (when
implemented) `guards` / `funcs`. Generic docs point at seatmesh package docs; the
**user extends** with project paths (e.g. consumer `.agent/manager-agent.md`) in dotdir
only.

Spec: [ROLE-YAML.md](ROLE-YAML.md), [DOTDIR.md](DOTDIR.md) (locked `_vendor/`, `*.extend.yaml`, `npx seatmesh update`).

---

## consumer vs minimal feature matrix

| Feature | minimal (package) | consumer (.sm consumer) |
|---------|-------------------|----------------------|
| connectivity / CPE | off | on + workspace scripts |
| stack passthrough | none | `./dc.sh` |
| seats.root | `seats` → `.sm/seats/` | same (after migrate from `tasks/agent-seats`) |
| data.root | `runtime` → `.sm/runtime/` | same (after migrate from `tasks/seatmesh`) |
| paths.json | generated | generated |
| role read_first | ONE-PATH only | `.agent/` + GATE-QUEUE |
| ports formula | optional | `30{n}0/30{n}1` |

---

## FAQ

**Why not put everything in the seatmesh repo?**  
seatmesh is a reusable engine; seatmesh is profile-driven. Mixing them forces every downstream user to inherit consumer paths.

**Where do I edit roles for consumer agents?**  
`consumer/.sm/roles/` — not `services/seatmesh/profiles/consumer/roles/` (once cleanup lands).

**Relative paths — which root?**  
- Harness keys (`data`, `seats`, `chatRooms`, `chatFiles`, `state.meshAgentsJson`, `roles.dir`) -> **profileDir** (`.sm/`). Engine resolves via **`paths.json`**.  
- Stack driver + connectivity hooks -> **workspace root**.  
- **No harness paths under `tasks/seatmesh/` or workspace-root `mesh-agents.json`** (operator 2026-09-12).
