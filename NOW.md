# seatmesh NOW

**Updated:** 2026-09-13 05:50

**Slice:** **2.1e /health wedge** — snap refresh + auto-scrape off poll/drain path.

**Read:** [docs/ONE-PATH.md](docs/ONE-PATH.md) · [TODO.md](TODO.md)

## Done this session

- **2.1e** — `/health` stays responsive during poll/drain: deferred snap refresh (2s), async auto-scrape, poll releases before drain; `ready`, `healthSnapAgeMs`, `pollBusy` on `/health`
- **2.1f / 2.4** (prior) — checkback reset/ack + auto-start on down

## Next (one at a time)

1. **5.7** — `sm notify` wrapper
2. **4.1** — mesh-agents json engine polish
3. **5.2** — inbox list/resolve CLI parity

**Tracker:** [TODO.md](TODO.md) · [IMPLEMENT-CHECK.md](../tasks/seat-mesh/IMPLEMENT-CHECK.md)
