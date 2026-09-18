# npm release schedule

| Date (Asia/Manila) | Package | Notes |
|--------------------|---------|--------|
| **2026-09-18** | `seatmesh@1.2.5` | CLI declares `yaml` dep — fixes npx/global `ERR_MODULE_NOT_FOUND` on merge-mesh-config |
| **2026-09-17** | `seatmesh@1.2.4` | Open agent kinds (`kindBase`/`extends`); opencode-cpe extends opencode; prove/satisfy/recovery; act/card hub; wave OC relaunch; Orca credit CONTINUE; cross-mesh inbox restart |
| **2026-09-17** | `seatmesh@1.2.3` | Republish after connectivity@1.2.2 npm staging E409; same surface as 1.2.2 |
| **2026-09-17** | `seatmesh@1.2.2` | `npx seatmesh web up\|down\|restart\|status`; `agent mds hosted\|agent-self\|agent <kind>`; hub `/mds` live; OC-V2 supervisor health rescue + oc-credit CONTINUE |
| **2026-09-16** | `seatmesh@1.2.0` | opencode-cpe CliType + runners; `sm pane resume`; OC-LIMIT `scripts/oc-reset.sh` + daemon relaunch; todo-check remaining TASKS DIGEST bulk; `sm web status\|open\|url`; `config upgrade` (npm i -g first); human help + patterns modular `docs/patterns/` |
| **2026-09-15** | `seatmesh@1.1.5` | Notify Info/Yes/No native buttons; local Info cards GFM+Mermaid (zoom/pan/expand); session check/repair; CB workspace scope; policy config; agent help/COMMANDS |
| **2026-09-15** | `seatmesh@1.1.4` | Early-adopter UX: `start` idempotent create-or-attach; `session down`; manager terminal welcome (whoami/switch); `sessions` documented |
| **2026-09-15** | `seatmesh@1.1.3` | Cursor/Claude respawn prove: agent --trust; composer-ready verify+retry (OC parity); fresh whoami on success expected |
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

**GitHub Releases:** yes — notes in `docs/releases/vX.Y.Z.md` + row in this file.
Create/update: `bash scripts/gh-release.sh 1.2.0` (needs `gh auth login`).
Optional: `bash scripts/gh-release.sh 1.2.0 --publish` (npm then release).

Inbox blips (2026-09-13 prove): daemon `/health` flaps and `checkback ack` 404 while inbox is up (cancel still works). Drain can wedge on `peer_unsent` if coord holds are not backlogged. Not a ship blocker after `seatmesh@1.0.0`; cancel orphan checkbacks instead of retrying ack.
