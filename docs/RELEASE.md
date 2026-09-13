# npm release schedule

| Date (Asia/Manila) | Package | Notes |
|--------------------|---------|--------|
| **2026-09-14** | `seatmesh@0.1.21+` | Registry update nudge on global/npx installs; optional `better-sqlite3`; inbox intent / supervise tick |

Installed CLI compares to `npm view seatmesh version` (6h cache). When outdated, stderr prints upgrade lines (`npm install -g seatmesh@latest` / `npx seatmesh@latest`).

Skip check: `SEATMESH_SKIP_VERSION_CHECK=1`.

Publish: `bash scripts/publish-npm.sh` from repo root (after `npm login`).
