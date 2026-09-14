# npm release schedule

| Date (Asia/Manila) | Package | Notes |
|--------------------|---------|--------|
| **2026-09-14** | `seatmesh@1.0.5` | Fast `session attach` (tmux first); auto-scrape 60s + detach/shutdown save hooks |
| **2026-09-14** | `seatmesh@1.0.4` | whoami lists open ACKs; checkback cancel ids work; peer/room CB auto-stop after 3 fires |
| **2026-09-14** | `seatmesh@1.0.3` | Info · Yes · No on local `/act/card`; notify details/images |
| **2026-09-14** | `seatmesh@1.0.2` | Cross-tier peer, bypass comms, remote peer, cursor usage fallback; `update` file-sync + inbox restart |
| **2026-09-14** | `seatmesh@1.0.1` | `portScope: workspace`; Claude idle UX fix |

Installed CLI compares to `npm view seatmesh version` (6h cache). When outdated, stderr prints upgrade lines (`npm install -g seatmesh@latest` / `npx seatmesh@latest`).

Skip check: `SEATMESH_SKIP_VERSION_CHECK=1`.

Publish: `bash scripts/publish-npm.sh` from repo root (after `npm login`).

Inbox blips (2026-09-13 prove): daemon `/health` flaps and `checkback ack` 404 while inbox is up (cancel still works). Drain can wedge on `peer_unsent` if coord holds are not backlogged. Not a ship blocker after `seatmesh@1.0.0`; cancel orphan checkbacks instead of retrying ack.
