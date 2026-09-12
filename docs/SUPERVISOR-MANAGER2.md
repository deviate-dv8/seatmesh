# Supervisor contract (secretary) + dual manager (manager-2)

**Status:** spec (operator 2026-09-12, approved) — contract seed + CI; layout implement follows  
**Prefs:** `tasks/seat-mesh/queue/SEAT-MESH-PREFERENCES.md`  
**Related:** [DOTDIR.md](DOTDIR.md), [STORAGE.md](STORAGE.md), [AGENT-FUNC-GUARDS.md](../../tasks/seat-mesh/queue/AGENT-FUNC-GUARDS.md)

---

## Goal

Speed up development by running **two manager coordinators** plus a **secretary supervisor contract** — not fake inbox magic, not a second product merge authority.

| Role | Job |
|------|-----|
| **manager** | Primary coordinator — spawn/review/kill minis, framework queue, operator chat |
| **manager-2** | Secondary coordinator — parallel framework/docs/verify slices, absorbs long generate so manager stays free |
| **secretary** | **Supervisor** on contract `supervise` — digest, mini collect, contract lock owner |

Both managers work **together** via room `supervise` + `managers` — no `to-master` relay.

---

## Fake supervisor contract (real locks + room)

**Definition:** `.sm/contracts/_vendor/supervise.yaml`  
**Lock:** `.sm/contracts/locks/supervise/secretary.on` (secretary bound; managers post to room)

```yaml
id: supervise
room_slug: supervise
supervisor: secretary
members: [manager, manager-2, secretary]
leads: [manager, manager-2]
scope: Framework queue + minis throughput — not product merge/QA
guards:
  deny: []
```

**Arm (implement / manual today):**

```bash
npx seatmesh contract on supervise --agent secretary
./sm.sh room create supervise --kind contract
```

**Coordination room:** `.sm/chat-rooms/supervise/` (ledger) + `.sm/chat-rooms/managers/` (digest).

Workers/minis: `./sm.sh room say -r supervise "CLAIMED|DONE|BLOCKED|FYI: …"`

Secretary: reads ledger, `./sm.sh secretary collect`, bulk digest to **both** managers via `-r managers` or direct `peer manager` / `peer manager-2`.

---

## Layout: manager + manager-2

Consumer `.sm/mesh.config.yaml` (target):

```yaml
layout:
  base:
    columns: [manager, manager-2, secretary]
    cli:
      manager: agent
      manager-2: agent
      secretary: opencode
seats:
  dirs:
    manager: manager
    manager-2: manager-2
    secretary: secretary
```

**Spawn manager-2:** `./sm.sh session up` with profile above, or `./sm.sh switch` handoff into `manager-2` column when layout lands in engine.

**Split work (standing):**

| manager | manager-2 |
|---------|-----------|
| operator chat, PROPOSAL gate, queue approve | Framework implement slices (#1d, #1e) |
| mini spawn/kill authority | parallel tester/researcher minis |
| board triage summary | docs/CI/migrate-runtime |

Either may `peer` workers; **only one** merges product (operator gate). Both read `supervise` room.

---

## CI test (seat-mesh package)

**Job:** `npm test` in `services/seat-mesh/` must include harness CI slices:

| Test file | Proves |
|-----------|--------|
| `packages/core/src/paths-manifest.test.ts` | profileDir paths, `paths.json` shape, dotdir guard |
| `packages/daemon/src/sqlite-store.test.ts` | SQLite inbox/peer/checkback roundtrip + JSONL migrate |
| `packages/core/src/contracts/supervise-contract.test.ts` | `supervise.yaml` parses; lock path convention |

**Future (mesh layout):** smoke that `columns` includes `manager-2` and secretary lock exists when `contract on supervise` ran.

**Not product CI** — application repo MR pipelines unchanged; this is **seat-mesh engine** CI only.

---

## Implement queue

| Row | Slice |
|-----|-------|
| **#1f** | Dual manager layout column + seat dirs `manager-2` |
| **#1g** | Contract seed + `contract on supervise` + room `supervise` |
| **#1h** | CI tests above in vitest |

Depends: **#1d** dotdir paths, **#1e** SQLite (optional for contract).

---

## Anti-patterns

- Second merge authority for manager-2
- Fake `contract arm` inbox daemon route
- manager-2 as a mini (minis ≠ managers)
- Skipping CI on contract/path regressions
