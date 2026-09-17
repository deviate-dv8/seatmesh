# OC-proxy / CPE

**Surfaces:** CLI · daemon

- CliType `oc-proxy` → `agents.runners.oc-proxy` (usually `scripts/opencode-cpe.sh`).
- Plain `opencode` / `oc` stay bare (no proxy).
- `sm pane resume` — autodetect `ses_*` → inject or relaunch with keep-resume.
- OC-LIMIT: `scripts/oc-reset.sh` via `connectivity.hooks.reset`.
- Stuck OC panes (kill→revive→CONTINUE all meshes): `./scripts/oc-proxy-atomics.sh`
