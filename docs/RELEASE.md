# npm release schedule

| Date (Asia/Manila) | Package | Notes |
|--------------------|---------|--------|
| **2026-09-15** | `seatmesh@1.1.2` | ACK redirect temp-block: after manager→secretary redirect, mini ACK to manager rewritten to secretary |
| **2026-09-15** | `seatmesh@1.1.0` | Official 1.1: role-pack locked `_vendor` + `*.extend.yaml` + base role MDs; `roles status\|migrate`; CC-limit CB + `limit idle` |
| **2026-09-15** | `seatmesh@1.0.14` | Auto CC-limit checkback: reset+1m fanout to all Claude panes; skip if seat no longer Claude; `limit idle` for operator/manager/secretary |
| **2026-09-15** | `seatmesh@1.0.13` | Operator ACK: no reminder inject (fixes n+1 prompt); auto-close on pane busy→idle reply |
| **2026-09-15** | `seatmesh@1.0.12` | ChatFile speaker ids: [human]/[system]/[slot-3-kiro]/[mini-1-oc]; agent switch safe dedupe |
| **2026-09-15** | `seatmesh@1.0.11` | OC ChatFile scrape: ┃ prompt + reply above completed ▣ Build (no footer chrome) |
| **2026-09-15** | `seatmesh@1.0.10` | OC draft box-only extract (no Escape spam); mid-gen inject queues; kiro monthly usage → KIRO-LIMIT (hold queue) |
| **2026-09-15** | `seatmesh@1.0.9` | Draft save/restore for claude/kiro/opencode: kiro extractor + wait idle composer before paste-back |
| **2026-09-14** | `seatmesh@1.0.7` | checkback-verify CONTINUE consts + kiro single-Enter; blazing attach: bash short-circuit → `tmux attach` (tmux-zsign style); sync detached |
| **2026-09-14** | `seatmesh@1.0.5` | Fast attach prep + auto-scrape 60s + detach/shutdown save hooks |
| **2026-09-14** | `seatmesh@1.0.4` | whoami lists open ACKs; checkback cancel ids work; peer/room CB auto-stop after 3 fires |
| **2026-09-14** | `seatmesh@1.0.3` | Info · Yes · No on local `/act/card`; notify details/images |
| **2026-09-14** | `seatmesh@1.0.2` | Cross-tier peer, bypass comms, remote peer, cursor usage fallback; `update` file-sync + inbox restart |
| **2026-09-14** | `seatmesh@1.0.1` | `portScope: workspace`; Claude idle UX fix |

Installed CLI compares to `npm view seatmesh version` (6h cache). When outdated, stderr prints upgrade lines (`npm install -g seatmesh@latest` / `npx seatmesh@latest`).

Skip check: `SEATMESH_SKIP_VERSION_CHECK=1`.

Publish: `bash scripts/publish-npm.sh` from repo root (after `npm login`).

Inbox blips (2026-09-13 prove): daemon `/health` flaps and `checkback ack` 404 while inbox is up (cancel still works). Drain can wedge on `peer_unsent` if coord holds are not backlogged. Not a ship blocker after `seatmesh@1.0.0`; cancel orphan checkbacks instead of retrying ack.
