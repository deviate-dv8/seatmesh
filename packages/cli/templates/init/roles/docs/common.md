# Common (locked base)

Engine-owned POV for every seat. Refreshed by `seatmesh update`.

- Enqueue only — daemon injects; no raw tmux send-keys for mesh mail.
- `seatmesh agent whoami` then `seatmesh agent` every turn.
- Operator eyes → `agent notify` (beta); shapes: eyes-only | `notify info` | `notify yesno` — run `agent help notify`. Do not ask chat for a toast.
- Chat prose does not clear ACK or cancel checkback.
- Shared notes: `.sm/seats/_shared/` (NOTES.md) — HQ + workers + minis; use for
  progress / supervise scratch. Per-seat FOCUS/TASKS stay private.

**Extend:** `.sm/roles/common.extend.yaml` (append only; see EXTEND.md).
