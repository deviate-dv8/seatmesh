# seatmesh NOW

**Updated:** 2026-09-19

**Design NOW:** open agent kinds — providers emit `kindBase` / `kindExtensions`.
CPE OpenCode = kind **`opencode-cpe`** (`extends: opencode`). Legacy name `oc-proxy`
is a normalize alias — **config that still says `oc-proxy` must keep working**.

**Migration CLOSED** when: (1) pia/zsign `providers`/`runners`/`cli: oc-proxy` launch CPE,
(2) four atomics record→kill→revive→CONTINUE work (`scripts/opencode-cpe-atomics.sh` /
`oc-proxy-atomics.sh` shim).

**Read:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [TODO.md](TODO.md) P6

## Done

- Open kinds + prove/satisfy/recovery (`1.2.4`)
- Canonical CPE kind rename: `opencode-cpe` (oc-proxy alias only)
- **oc-proxy config compat + 4 atomics proved** (stamp path aligned; type `opencode-cpe`|
  `oc-proxy` both selected)
- `1.2.5` — CLI declares `yaml` (npx/global)
- **Suite stabilized (2026-09-19)** — `npm run test:ci` was 15 failing tests / 12 files
  (stale `seatmesh agent` → `sm agent` fixtures, `triage-inject` never re-exported from
  `@seat-mesh/core`, OC composer stale-vs-live limit/credit ordering, `ack-redirect-block`
  over-matching PROVED/DONE as redirectable, `--agents help` shim arg-parse bug). All 141
  files green now; see git log for the individual fixes.
- **`test/docker`** — isolated CI runner (build+typecheck+vitest in a container, source
  COPYed not bind-mounted, no host tmux/mesh state touched). Also caught a real bug: root
  `build` script built `@seat-mesh/tmux` before `@seat-mesh/connectivity` even though
  `tmux/src/smoke-test.ts` imports it — worked on host only because stale `dist/` was
  already lying around. Fixed the declared dep + build order.

## Direction (2026-09-18)

**Single host daemon** — stop N× mesh-inbox (pia/zsign/seatmesh each supervisor+server).
Today is federation (ports + remotes + `/tmp` CPE stamps + sessions.json + hub :3190).
Herdr already owns “agent status” (idle/working/blocked) better; we should not keep
growing that surface inside every mesh-inbox.

**Do not reinvent Herdr.** Seatmesh keep: seats, contracts/supervise, peer/ack/cb,
enqueue-only inject, CPE atomics. Daemon slim toward: one process (or one supervisor
over N listeners), per-mesh queue isolation, drop duplicate status/scrape theater.

## Lab (upgrade / poke — not host meshes)

Isolated Docker lab so `npm i -g seatmesh` / `sm update` does not pop live
pia/zsign sessions:

```bash
cd test/lab && ./lab.sh up          # SSH :2222  inbox :31691
./lab.sh ssh                        # or password lab / seatmesh-lab
./lab.sh upgrade latest             # upgrade drill inside only
./lab.sh wipe                       # destroy lab volume only
```

Note: published `seatmesh` still lists `file:../` workspace deps — plain
`npm i -g seatmesh` is broken outside the monorepo. Lab `upgrade` rewrites
those deps. Default lab mode uses the bind-mounted repo bin.

## test/docker (CI runner — not the lab above)

Isolated container for build/typecheck/vitest on THIS checkout. Different job than
the lab: lab drills `npm i -g seatmesh` upgrades against a fake mesh; this runs the
actual test suite with no host tmux/mesh coupling (source is COPYed into the image).

```bash
npm run test:docker                 # == ./test/docker/run.sh test → build + test:ci
./test/docker/run.sh ci             # build + typecheck (not web) + test:ci
./test/docker/run.sh test:all       # vitest run, incl. sqlite-store.test.ts
./test/docker/run.sh shell          # interactive bash in the built image
```

## Next

1. **Single daemon (phase 1)** — one supervisor walks `sessions.json` / remotes; still
   one inject consumer per mesh (ports or namespaced). Smallest ops win.
2. **Slim tick** — split CPE/connectivity host sidecar if it keeps wedging `/health`
3. **P6.1** `.sm/providers/` drop-in (Kimi without fork)
4. **P6.2** `sm kind list|show`
5. Delete `origin/oc-proxy` git branch when meshes no longer need the alias story
