# Architecture

Product-agnostic multi-agent tmux workbench. **The inbox daemon is the only writer
to panes**; CLI commands and agents enqueue. Providers are pluggable; limit handling
uses hooks, not hardcoded CLI branches in the orchestrator.

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
(1..12).

Consumer profile may still list `[manager, manager-2, secretary]` — those are **names in yaml**,
not schema variants. See `packages/core/src/schema/seat-kind.ts`.

### Human co-typed panes (`manager-2` inject hazard) — needs ACK + fix

**Reported (manager-2, 2026-09-13):** the `manager-2` pane is the only base column where
**operator types in the same tty** as the daemon. Blind `send-keys` / paste inject can interleave
with Claude Code footer redraw → corrupted / "footer bleed" messages. Other panes are
agent-only.

**Required engine behavior (FQ, not docs-only):**

1. Mark co-typed panes in profile or pane metadata (e.g. `layout.base.humanCoTyped: [manager-2]`).
2. Daemon inject path: **queue + composer-ready gate** (same as cursor-agent busy), never
   paste mid-keystroke; optional steer-to-follow-up instead of raw paste.
3. **manager** must ACK this FQ to **manager-2** in room/peer when scheduled; **manager-2**
   owns the inject-path patch in `@seat-mesh/daemon` / `@seat-mesh/tmux`.

Spec pointer: `tasks/seat-mesh/FQ-inject-co-typed-pane.md`.

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
| CHECKBACK | comms, limits | timed poll inject |
| PANE_OPS | launch, layout, relayout | serial pane operations |

Goal: **best-effort empty** — fair, rate-limited, never stomp an active composer.

BullMQ is optional when Redis is up; the poll loop (`daemon.pollMs`) remains the
reliable drain on a single host.

### When agents "do not receive" inbox (diagnosis)

Delivery is **not** chat — it is PEER/CHECKBACK inject when policy allows.

| Symptom | Likely cause | Check |
|---------|--------------|--------|
| CLI `FAIL: prompt not sent … last=queued` | Target composer **busy/typing** (common on cursor-agent) | `./sm.sh peer verify <target>` |
| `peerUnsent` high in `/health` | Backlog of not-yet-delivered rows; many targets busy at once | Wait for idle + settle; reduce concurrent peer spam |
| Room line saved, `fan-out sent=0` | Same busy gate; line still in `.sm/chat-rooms/.../ROOM.jsonl` | `./sm.sh room tail -r managers` |
| Truly no daemon | `/health` not ok | `./sm.sh inbox restart` |

**Work still lands on disk:** `./sm.sh assign` writes FOCUS NOW + TASK **before** peer proof;
a failed `assign` exit code does not mean the seat has no hub — run `./sm.sh whoami` on the
target pane.

**Prefix:** daemon injects must carry `[mesh-inbox]` (see `stampDaemonInject` in
`packages/daemon/src/inject-delivery.ts`).

## Agent provider interface

One **AgentProvider** per CLI family. Detection returns a provider id.

```ts
interface AgentProvider {
  id: string;
  detect(pane: PaneSnapshot): Detection | null;
  composerState(pane: PaneSnapshot): ComposerState;
  injectTarget(pane: PaneSnapshot): InjectPlan;
  limits?: LimitDetector[];
}
```

The orchestrator calls `registry.getProvider(pane)` — no central if/else on CLI names.

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

## Profile-driven everything

`mesh.config.yaml` declares session name, slot count, port formula, provider ids,
daemon port, seats paths, chat roots, stack passthrough, and connectivity. Shipped
profiles under `profiles/` are examples; consumers use `.sm/` or their own tree.

See [CONFIG.md](CONFIG.md).

## Out of scope for core

- Issue trackers / GitLab (consumer workflow)
- Product application ports in engine docs (profile `ports` only)
- Board triage plugins
