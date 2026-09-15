# seatmesh documentation

Product documentation for the engine. Paths and defaults are **profile-driven**
(`mesh.config.yaml` or project `.sm/mesh.config.yaml`); examples use placeholders
like `{data.root}` and `{seats.root}` unless noted.

## Start here

1. [QUICKSTART.md](QUICKSTART.md) — init, attach, reload, cold start behavior
2. [ONE-PATH.md](ONE-PATH.md) — pick one command per task
3. [FEATURES.md](FEATURES.md) — what the engine provides

## Reference

| Doc | Topic |
|-----|--------|
| [COMMANDS.md](COMMANDS.md) · [cli/](cli/) | **All CLI verbs** — greppable (`rg "^## " docs/COMMANDS.md`) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Tmux layout, daemon, providers, queues |
| [CONFIG.md](CONFIG.md) | Profile schema and keys |
| [SLOTS.md](SLOTS.md) | Manager, secretary, workers, minis |
| [STATE.md](STATE.md) | Persisted CLI/resume state |
| [COMMS.md](COMMS.md) | Enqueue → drain → inject |
| [CHATROOM.md](CHATROOM.md) | Parallel agent room ledger |
| [CHATFILE.md](CHATFILE.md) | Append-only shared files |
| [PORTABILITY.md](PORTABILITY.md) | Custom proxy, hooks, runtime data dir |
| [PORTS.md](PORTS.md) | Inbox HTTP ports (`:31670` mesh, `:31699` harness) |
| [PROXY-NOTIFICATIONS.md](PROXY-NOTIFICATIONS.md) | CPE/proxy desktop toast budget |

## Shipped profiles

| Profile | Purpose |
|---------|---------|
| `profiles/minimal/` | Smallest demo (connectivity off, default paths) |
| `profiles/consumer/` | Full layout for the consumer workspace consumer |

Profile READMEs describe checkout-specific wiring only.

## Internal / planning

Not required for day-to-day use:

- [../TODO.md](../TODO.md) — parity and implementation checklist
- [../NOW.md](../NOW.md) — current slice
- [PARALLEL.md](PARALLEL.md) — coexistence with other tmux harnesses (historical)
- [SURPASS.md](SURPASS.md) — migration notes
- [SM-JSON-ENGINE-DRAFT.md](SM-JSON-ENGINE-DRAFT.md) — config engine proposal
- [SMFUNCTIONS-SPEC.md](SMFUNCTIONS-SPEC.md) — CLI surface conventions
