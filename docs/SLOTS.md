# Slots

Manager, secretary, workers, and minis are **slots** with the same underlying
features. **Guards** (profile + role YAML) restrict what each role may do — not
separate inject code paths.

## Registry (typical six-worker profile)

| Slot id | Pane | Ports | Role |
|---------|------|-------|------|
| `manager` | base col 0 | `manager` | coordination, spawn minis |
| `secretary` | base col 1 | `secretary` | inbox transform, digest |
| `worker-1` .. `worker-6` | workers 3×2 | profile formula | delivery / product seat |
| `mini-1` .. `mini-8` | minis grid | `mini-N` | parallel jobs for manager |

Slot count and port pattern come from `session.workerCount` and `ports.worker`
in the profile.

## Shared capabilities

| Feature | API | Notes |
|---------|-----|-------|
| Seat files | FOCUS, TASKS, REMINDER | under `seats.root` |
| Comms | `to-master`, `to-slot`, `to-mini` | enqueue only |
| Border | `@mesh_status` | daemon-painted |
| Title | `@mesh_title` | CLI or manager set |
| Provider | detect + inject plan | empty = no inject |
| Checkback | arm on expect-reply | all roles |
| Snapshot | `snapshot here <slug>` | cold archive |

Guards belong in role policy and the send router, not `if (role === manager)` in
the orchestrator.

## Seat file snapshot (cold archive)

On `snapshot here <slug>`:

- Copy FOCUS + TASKS + REMINDER (+ optional NAV) to
  `{seats.root}/_snapshots/<date>_<seatId>_<slug>/`
- Reset live trio to templates; Mark OPEN with pointer to cold path
- Snapshots are grep-ignored by default; `contexts --snapshots` lists them

Unified seat ids: `manager`, `secretary`, `worker-3`, `mini-2`.

## Runtime snapshot (live pane)

For orchestrator / triage / `providers scan`:

- Tmux pane id, window, cwd, capture tail
- Provider id, resume id, composer state
- Border segments

Used for drain holds (do not inject while typing). Complements cold archive, does
not replace it.

## Paths on disk (profile-driven)

```text
{seats.root}/
  manager/
  manager-b/
  secretary/
  slot-1/ .. slot-N/     # worker dirs from seats.dirs.worker
  mini-1/ ..             # optional per-mini dirs
  minis.json             # campaign state (profile-specific)
  _snapshots/
```

Exact dir names use `seats.dirs` templates (`slot-{n}`, `mini-{n}`, …).

## CLI

```bash
seatmesh snapshot here my-slug
seatmesh snapshot capture
seatmesh contexts
seatmesh contexts --snapshots
```
