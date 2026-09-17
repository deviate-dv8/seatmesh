# Architecture

Product-agnostic multi-agent tmux workbench. **The inbox daemon is the only writer
to panes**; CLI commands and agents enqueue. Providers are pluggable; limit handling
uses hooks, not hardcoded CLI branches in the orchestrator.

One rule underpins everything: **producers enqueue, one daemon injects.** No command,
worker, secretary, or recovery job pastes into a pane directly. This is what keeps a
shared tty from being stomped by two writers at once.

## Packages

Five workspace packages under `packages/*` (npm workspaces, all `0.1.x` in lockstep).
Dependency direction flows one way: `core <- {tmux, providers, connectivity} <- daemon <- cli`.

| Package | Role | Depends on |
|---------|------|------------|
| `@seat-mesh/core` | Profile schema, path resolvers, contracts (supervise/balance), chat rooms, message copy consts. No tmux, no daemon. | — |
| `@seat-mesh/providers` | One `AgentProvider` per CLI family (cursor-agent, claude, opencode…): detect + composer state + inject plan + limit detectors. | core |
| `@seat-mesh/tmux` | tmux side-effects: pane snapshot/capture, inject path, seats read/write, supervise tick, comms/inbox bridge. | core, providers |
| `@seat-mesh/connectivity` | Connectivity/limit recovery library — policies enqueue jobs, never inject. | core |
| `@seat-mesh/daemon` | The inbox orchestrator: sole pane writer, queue drain, checkback fires, notify, border paint. | core, tmux, providers |
| `seatmesh` (cli) | User entry: profile init/update, room/peer/checkback/seat/notify commands, reports. Spawns the daemon. | all |

### Source layout (post-2026-09-14 reorg)

`@seat-mesh/daemon` and `seatmesh` were flat seas of `src/*.ts`; they now nest by domain.
Full map + rules: [PACKAGE-LAYOUT.md](PACKAGE-LAYOUT.md).

```
daemon/src/
  index.ts  mesh-inbox-server.ts  mesh-inbox-supervisor.ts   (root: barrel + entries)
  orchestrator/  inject/  peer/  store/  notify/  checkback/
  connectivity/  inbox/  border/  queue/  state/

cli/src/
  main.ts                                                    (root: bin entry)
  commands/  setup/  report/  ui/
```

**Root-kept entries are load-bearing:** `mesh-inbox-server.ts` / `mesh-inbox-supervisor.ts`
are located at runtime by a hardcoded `packages/daemon/dist/<name>.js` path
(`resolveDaemonScript`, `@seat-mesh/core`) and the supervisor's HMR watch; `main.ts` is the CLI
bin (`dist/main.js`). Moving them breaks resolution — they stay at `src/` root by design.

**Convention (all packages):** no new production `.ts` at `src/` root except `index.ts`
(barrel) and the load-bearing entry files above. Tests sit next to the module
(`peer/peer-skip.test.ts`). Folder = domain, not layer. Build/tooling scripts under
`packages/*/scripts/` are full TypeScript, run via Node type-stripping
(`node scripts/bundle-profiles.ts`) — no `.mjs`. `@seat-mesh/core` root is also
barrel-only (`profile/` `paths/` `runtime/` plus existing domain folders).

## Tmux layout (default profile shape)

| Index | Window | Layout | Purpose |
|------:|--------|--------|---------|
| 0 | `nvim` | 1 pane | Editor |
| 1 | `base` | 2 cols (+ optional stack) | Manager column, secretary |
| 2 | `workers` | 3×2 | Worker seats (count from profile) |
| 3 | `minis` | profile grid | Parallel minis (e.g. 4×2, eight panes) |

Worker count, port formula, window names, and minis grid come from
`mesh.config.yaml` (`layout`, `session.workerCount`, `ports.worker`).

Minis lead placement uses `layout.minis.leads` and `layout 4x2` (tmux
select-layout + swap-pane only — no kill/respawn to retile).

### Coordinator columns (kinds closed, ids open)

**Kinds** are four types: `manager`, `secretary`, `worker`, `mini`.
**Ids** are profile strings (`layout.base.columns`). `manager-2` is a consumer name, not an
engine enum member. N managers, N secretaries, N workers, N minis are all config.

| Allowed | Forbidden |
|---------|-----------|
| `columns: [manager, lead-west, secretary, secretary-2]` | Adding `manager-3` to a TypeScript enum |
| `kinds:` map when an id is not prefix-obvious | Hardcoding `role === "manager-2"` in resolve/stamp/authz |
| `seats.dirs` record keyed by column id | Closed `BaseColumnSchema` of three names |

Kind inference: `secretary-*` -> secretary; `mini-*` / `slot-*` -> mini/worker; any other
base column id -> manager. Override with `layout.base.kinds`.

Workers = `layout.workers.slots`. Minis = `layout.minis.max`. Base coord count = `columns.length`
(1..128 — "100 managers" is a config array length, not a code change).

**Adding the Nth manager needs exactly one thing: its id in `layout.base.columns`.**
`seats.dirs`, a `roles/columns/<id>.yaml` overlay, and a `layout.base.cli.<id>` entry are all
*optional* — `seatDirSegment()` defaults an unmapped id to itself, `loadRoleIndex()` falls back
to base `manager.yaml`, and `cliForBaseColumn()` falls back to `defaultCliForKind()`. Don't
hand-author an identity `extends: manager` overlay or `dirs: {manager-4: manager-4}` — they do
nothing the fallback wasn't already doing. Use:

```bash
seatmesh --profile .sm layout column add manager-4 [--cli claude] [--after manager-3] [--co-typed]
seatmesh --profile .sm layout column list
seatmesh --profile .sm layout column remove manager-4
```

(`packages/core/src/profile-edit.ts`) rather than hand-editing the yaml array — it validates the
id, checks duplicates, preserves comments. Seat dir + FOCUS/TASKS/REMINDER are auto-created on
the next `up`/`reload` by `runSeatInit`, which iterates `layout.base.columns` generically.

### Supervise / balance (parallel leads)

Which coordinator columns are actively driven is contract config, not code:

- `.sm/contracts/_vendor/supervise.yaml` (locked, refreshed by `update`) + `supervise.extend.yaml`
  (user, never overwritten). `leads:` = the panes the daemon nudges CONTINUE when idle with open
  TASKS; `superviseLeadIds()` re-reads this **every tick** (`packages/core/src/contracts/supervise.ts`).
  To run managers 1..N in parallel, list them all under `leads:` — a single-lead list is why
  extra managers stall.
- `.sm/contracts/balance.extend.yaml` (`balancees:`) spreads work across leads/slots;
  `auto_assign` lets the balance tick assign directly.

The aggregate tick (`runSuperviseTick`, `packages/tmux/src/supervise/supervise-tick.ts`) writes
`.sm/seats/secretary/SUPERVISE-LAST.md`, optionally posts a `managers` room STATUS, and nudges
each idle lead. Per-lead `coord-nudge` and the aggregate `secretary-supervise` fire are stored
as renewing rows in `CHECKBACK.jsonl`, so they survive a daemon restart.

### Human co-typed panes (implemented)

Some base columns (e.g. `manager-2`) are panes where the **operator types in the same tty** as
the daemon. Blind paste there interleaves with the CLI footer redraw and corrupts input.

Handled in the inject path (`@seat-mesh/tmux`, `@seat-mesh/daemon`):

1. Co-typed panes are marked in the profile (`layout.base.humanCoTyped: [manager-2]`).
2. Inject **queues + gates on composer-ready** (same as a busy cursor-agent) and takes a
   short keyboard-input lock (`withPaneInjectLock`) so a human keystroke can't land mid
   clear/paste; a live human draft is preserved and restored, a stale `[mesh-inbox]` draft is
   cleared first.
3. No desktop toast for co-typed inject holds (removed — it was spammy). Holds are visible on
   the pane border only.

## No direct send

CLI commands, workers, secretary, and recovery jobs **do not** call tmux send-keys
directly. They append to a **queue** (JSONL and optional BullMQ). The inbox daemon
is the sole consumer that injects when policy allows (idle, settle, not typing).

```text
  producer  -->  queue (durable)  -->  inbox daemon
                                           |
                                           v
                                     pane inject (one path)
```

The same orchestrator owns mail delivery, checkback fires, pane ops, limit recovery,
border/status paint, and connectivity side effects that need a pane paste.

## Queue model

| Store | Producer | Consumer |
|-------|----------|----------|
| INBOX | workers, minis, schedule | inject manager/secretary; ack/resolve |
| PEER | worker, mini, secretary, room fan-out | inject target pane |
| CHECKBACK | comms, limits, supervise | timed poll inject |
| PANE_OPS | launch, layout, relayout | serial pane operations |

Goal: **best-effort empty** — fair, rate-limited, never stomp an active composer.

BullMQ is optional when Redis is up; the poll loop (`daemon.pollMs`) remains the
reliable drain on a single host.

**A queue is a queue:** a peer to a busy pane is **not** a failure. It is parked
(`deliverPane: "backlog"` in `PEER.jsonl`, mirrored in `PEER-BACKLOG.jsonl`) and the daemon
promotes it when the target goes idle. `isPeerDelivered()` treats `backlog`/`skipped` as **not
delivered**; the CLI reports `QUEUED` (not `FAIL`); `reconcileBacklogOrphans` re-adds any
backlog row lost across a restart. See `packages/daemon/src/store/jsonl-store.ts` and
`packages/daemon/src/peer/peer-backlog.ts`.

### When agents "do not receive" inbox (diagnosis)

Delivery is **not** chat — it is PEER/CHECKBACK inject when policy allows.

| Symptom | Likely cause | Check |
|---------|--------------|--------|
| CLI `QUEUED … (inbox inject when idle)` | Target composer **busy/typing** — normal; will land when idle | `seatmesh --profile .sm peer verify <target>` |
| CC blank composer stuck **typing** | False draft on rule-only `❯ ───` row; or need TEMP bypass | Fix in `@seat-mesh/providers`; `daemon.skipTypingGate: true` or `MESH_INBOX_SKIP_TYPING_GATE=1` then inbox restart |
| Secretary **Bun crashed** on `opencode-cpe.sh` | Stale `mesh-agents.json` secretary=opencode while profile `cli.secretary=claude` | coord sync uses profile CLI first; `seatmesh secretary restart` |
| OC panes **no proxy** after switch | `agents.runners.opencode` missing or old engine | Set runner in yaml; rebuild tmux/core; `switch <t> oc`; check `resumeCmd` contains `opencode-cpe.sh` |
| Added CLI name in yaml, **daemon ignores it** | Runners/launch ≠ Provider | See **Agent CLI: three layers** — need provider + CliType, not yaml alone |
| `peerUnsent` high in `/health` | Backlog of not-yet-delivered rows; many targets busy at once | Wait for idle + settle; reduce concurrent peer spam |
| Room line saved, `fan-out sent=0` | Same busy gate; line still in `.sm/chat-rooms/.../ROOM.jsonl` | `seatmesh --profile .sm room tail -r managers` |
| Truly no daemon | `/health` not ok | `seatmesh --profile .sm inbox restart` |

**Work still lands on disk:** `assign` writes FOCUS NOW + TASK **before** peer proof;
a failed `assign` exit code does not mean the seat has no hub — run `whoami` on the target pane.

**Prefix:** daemon injects carry `[mesh-inbox]` (see `stampDaemonInject` in
`packages/daemon/src/inject/inject-delivery.ts`).

## Agent CLI: three layers (do not confuse them)

Adding a name to yaml — or a runner script — is **not** a finished feature. Three
separate layers must agree.

| Layer | What it controls | Where it lives | Config-only? |
|-------|------------------|----------------|--------------|
| **1. Kind** | `switch` / `set` / `tag`; `mesh-agents.json` `type`; `layout.base.cli` | Open string validated against **resolved kinds** (`resolveAgentKinds`) | **Mostly** — overlays in `agents.kinds`; bases emitted by providers |
| **2. Launch** | Full one-liner pasted into pane; `resumeCmd` on save | `kind.launch` (builtin or `command`) + legacy `agents.runners` shim | **Yes** for wrappers |
| **3. Provider** | Detect live CLI, busy/typing gate, inject plan, limits | `@seat-mesh/providers` TS class; enabled by `profile.providers` | **No** — one module per family |

```text
  provider.kindBase() + kindExtensions()
            │
            ▼
  agents.kinds overlay  ⊎  agents.runners shim
            │
            ▼
  resolveAgentKinds → switch / layout / mesh-agents.type / launch / prove
            │
  inbox drain ──► registry.detect(pane)  (provider id only)
```

**Kinds can `extends` another kind.** CPE OpenCode is not a second CLI family:

```yaml
# Engine default (from opencode.kindExtensions) — mesh may overlay
agents:
  kinds:
    opencode-cpe:
      extends: opencode
      launch: { command: scripts/opencode-cpe.sh }
      prove: { cmdline: [opencode-cpe\.sh], resumeCmd: [opencode-cpe\.sh] }
      satisfy: { whenProvider: opencode, requireProve: true }
      recovery: { onProxyUp: true }
```

| Concern | Home |
|---------|------|
| Detect / inject / limits | Provider class (`opencode`) |
| Kind id, extends, launch, prove, satisfy, recovery | JSON kinds (provider-emitted ⊎ profile) |
| Custom wrap of OC | `agents.kinds.my-oc: { extends: opencode, launch: … }` |

**If layer 2 works but layer 3 does not:** the pane boots, but the daemon treats it
as plain shell — peer/inbox never injects.

**If you add `kimi` to yaml only:** launch may work via `agents.kinds` / runners; inject
needs a provider module with `kindBase()`.

### Checklist: adding a new CLI family (e.g. Kimi)

| Step | Required work |
|------|----------------|
| Provider | New `AgentProvider` with `kindBase()` in `packages/providers/src/`; register in `builtin.ts` |
| Profile | Add id to `providers:` array |
| Kind | Comes from `kindBase()`; mesh may overlay `agents.kinds` |
| Launch | `kindBase().launch` builtin **or** `{ command: … }` |
| Tests | Provider detect + kind resolve + launch smoke |

### Legacy `agents.runners` (shim)

Still supported: `runners.X` → overlays `kinds.X.launch.command`. Prefer `agents.kinds`
for new meshes. `runners.opencode` alone also overlays `opencode-cpe` launch (compat).

| Code path | Uses kinds? |
|-----------|-------------|
| `switch` / `launch` / `set` / `tag` | Yes — `kindsForLoaded` → `buildKindLaunchCmd` |
| Live satisfy / coord-sync | Yes — `prove` / `satisfy` (`harness-satisfy.ts`) |
| CPE revive / atomics | Yes — `kind.recovery.onProxyUp` |
| Inbox inject / busy gate | **No** — providers only |

### Built-in kinds (provider-emitted defaults)

| Switch / type | Extends | Default launch | Provider id |
|---------------|---------|----------------|-------------|
| `agent`, `cursor` | — | `agent --trust …` | `cursor-agent` |
| `claude`, `cc` | — | `claude --permission-mode auto …` | `claude` |
| `kiro` | — | `kiro-cli chat …` | `kiro` |
| `oc`, `opencode` | — | `opencode --auto …` | `opencode` |
| `opencode-cpe` | **opencode** | `scripts/opencode-cpe.sh` | `opencode` |
| `empty` | — | (plain shell) | `empty` |

Implementation: `packages/core/src/agents/kinds.ts`, `harness-satisfy.ts`,
`packages/providers/src/builtin.ts` (`resolveKindsForProfile`),
`packages/tmux/src/agents/agent-launch.ts`.

## Agent provider interface (layer 3)

One **AgentProvider** per CLI family. Detection returns a provider id. The daemon
never branches on CLI names — only on `registry.detect(pane)`.

```ts
interface AgentProvider {
  id: string;
  detect(pane: PaneSnapshot): Detection | null;
  composerState(pane: PaneSnapshot): ComposerState;
  injectPlan(pane: PaneSnapshot): InjectPlan;
  limits?: LimitDetector[];
  kindBase?(): ProviderKindBase;           // auto-built base kind JSON
  kindExtensions?(): Array<ProviderKindBase & { id: string }>;
}
```

Builtin registry (`packages/providers/src/builtin.ts`) is fixed at compile time.
`createRegistryForProfile(profile)` filters by `profile.providers`. Kind JSON is
merged from those providers + `profile.agents.kinds`.

## Limits (hooks)

```ts
interface LimitDetector {
  id: string;
  match(state: ComposerState, pane: PaneSnapshot): boolean;
  onRisingEdge(ctx: LimitContext): Promise<void>;  // enqueue jobs, not inject
}
```

Handlers enqueue work; daemon workers execute. Handlers never call tmux directly.

## Connectivity

`@seat-mesh/connectivity` is a library. Recovery policies enqueue jobs; the profile
names the driver and hooks (`connectivity.driver`, `hooks.*`, `policy.*`).
CPE seat selection uses `kind.recovery.onProxyUp`, not a hard-coded CliType name.

## Profile-driven everything

`mesh.config.yaml` declares session name, slot count, port formula, provider ids,
daemon port, seats paths, chat roots, stack passthrough, connectivity, and optional
`agents.kinds` overlays. Shipped profiles under `profiles/` are examples; consumers
use `.sm/` or their own tree.

See [CONFIG.md](CONFIG.md).

## Out of scope for core

- Issue trackers / GitLab (consumer workflow)
- Product application ports in engine docs (profile `ports` only)
- Board triage plugins
