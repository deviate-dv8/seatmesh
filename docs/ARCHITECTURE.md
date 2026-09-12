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

`seat-mesh-connectivity` is a library. Recovery policies enqueue jobs; the profile
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
