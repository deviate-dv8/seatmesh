# Common (locked base)

Engine-owned POV for every seat. Refreshed by `seatmesh update`.

- Enqueue only — daemon injects; no raw tmux send-keys for mesh mail.
- `seatmesh agent whoami` then `seatmesh agent` every turn.
- Operator eyes → `agent notify` (beta); do not ask chat for a toast.
- Chat prose does not clear ACK or cancel checkback.

**Extend:** `.sm/roles/common.extend.yaml` (append only; see EXTEND.md).
