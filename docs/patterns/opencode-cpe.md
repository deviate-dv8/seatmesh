# OC-proxy / CPE

**Surfaces:** CLI · daemon

- CliType `opencode-cpe` → `agents.runners.opencode-cpe` (usually `scripts/opencode-cpe.sh`).
- Plain `opencode` / `oc` stay bare (no proxy).
- `sm pane resume` — autodetect `ses_*` → inject or relaunch with keep-resume.
- OC-LIMIT: `scripts/oc-reset.sh` via `connectivity.hooks.reset`.
- Stuck OC panes (kill→revive→CONTINUE all meshes): `./scripts/opencode-cpe-atomics.sh`
