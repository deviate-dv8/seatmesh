# Storage — JSONL today, SQLite target, Redis optional cut

**Status:** proposal (operator 2026-09-12) — record only; implement after continue  
**Prefs:** `tasks/seat-mesh/queue/SEAT-MESH-PREFERENCES.md`  
**Related:** [DOTDIR.md](DOTDIR.md) (#1d runtime paths), [ARCHITECTURE.md](ARCHITECTURE.md)

---

## What exists today

| Layer | Role | Location (legacy) | Target |
|-------|------|-------------------------|--------|
| **JSONL** | Source of truth (INBOX, PEER, CHECKBACK, PANE_OPS) | `tasks/seat-mesh/daemon/*.jsonl` | `.sm/runtime/daemon/` then **SQLite** |
| **Redis + BullMQ** | Optional wake for drain (`drain-tick`, row nudge) | `orchestrator.redisUrl` in mesh.config | **Remove** (see phase 1) |
| **Poll loop** | Reliable drain when Redis down | `daemon.pollMs` in inbox daemon | **Keep** (primary wake) |
| **HTTP inbox** | Sole mutator for queue rows | localhost `:31670` | unchanged |

Producers (CLI) already POST to the daemon — they do **not** append JSONL directly. That makes a single-writer SQLite store feasible.

**Out of scope:** product-app Redis (email/webhook Bull queues) — separate stack; this doc is **seat-mesh harness only**.

---

## operator direction (2026-09-12)

Move harness persistence toward **SQLite under `.sm/`**, drop external Redis dependency for seat-mesh, keep everything defined in profile + `paths.json` (no scattered paths).

---

## Recommendation (phased)

### Phase 1 — Drop Redis for seat-mesh (low risk, do with #1d)

**Action:** Remove `orchestrator.redisUrl` / BullMQ path; poll + in-process coalesce only.

**Why first:**

- Redis adds **zero durability** today — jobs only trigger `runDrain()`; rows live in JSONL.
- Docs already say Redis is optional ([PORTABILITY.md](PORTABILITY.md)).
- A sibling product stack may still run Redis for its API; seat-mesh does not need a second reason to require it.
- One less moving part for agents (`agent-golf`).

**Config after cut:**

```yaml
orchestrator:
  drain:
    maxInjectPerTick: 1
    digestCooldownMs: 5000
    idleSettleMs: 5000
  # redisUrl: removed — use poll + scheduleDrain coalesce
```

**Risk:** Burst room fan-out may drain ~one poll interval slower — already mitigated by `runDrainCoalesced()`. Smoke: global room broadcast + `/health` latency.

---

### Phase 2 — SQLite replaces JSONL (medium; after dotdir paths land)

**Single file:** `.sm/runtime/mesh.sqlite` (path from `paths.json` → `storage.db` or `runtime/mesh.sqlite`).

**Engine:** `better-sqlite3` in the inbox daemon only (sync, single process, WAL mode). No separate DB server.

**Tables (mirror current rows):**

```sql
-- inbox (legacy name; rows are peer/mail inject queue)
CREATE TABLE inbox (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  from_agent TEXT,
  slot TEXT,
  ports TEXT,
  msg TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  deliver_pane TEXT,
  deliver_mode TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  read_flag INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE peer (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_slot TEXT,
  target_pane TEXT NOT NULL,
  target_label TEXT,
  room_slug TEXT,
  msg TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  deliver_pane TEXT,
  deliver_mode TEXT
);

CREATE TABLE checkback (
  id TEXT PRIMARY KEY,
  kind TEXT,
  status TEXT NOT NULL,
  renew_sec INTEGER,
  expect TEXT,
  owner_pane TEXT,
  expires_at TEXT,
  sender_label TEXT,
  recipient_label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pane_ops (
  id TEXT PRIMARY KEY,
  op TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value_json TEXT
);
```

**Indexes for drain hot paths:**

```sql
CREATE INDEX peer_pending ON peer(sent) WHERE sent = 0;
CREATE INDEX inbox_pending ON inbox(sent, resolved) WHERE sent = 0 AND resolved = 0;
CREATE INDEX checkback_active ON checkback(status, expires_at) WHERE status = 'active';
```

**Wake model (replaces BullMQ):**

1. HTTP handler `INSERT` row → `scheduleDrain()` in-process (same as Redis-off path today).
2. Poll loop (`pollMs`) scans pending + expired checkbacks — unchanged semantics.
3. Optional: `INSERT` trigger not needed; explicit `scheduleDrain()` after commit.

**Migration:**

```bash
npx seatmesh migrate-storage   # or update --migrate-storage
```

- If `mesh.sqlite` missing and `daemon/*.jsonl` exist → import once, write `meta.schema_version=1`, keep `.jsonl.migrated` stubs.
- New installs: SQLite only; no JSONL files created.

**Interface:** `QueueStore` trait — `JsonlStore` impl today, `SqliteStore` impl phase 2; orchestrator depends on interface only.

---

### Phase 3 — Optional extras (defer until pain)

| Idea | When |
|------|------|
| Room ledger in SQLite (`chat_messages` table) | If `.sm/chat-rooms/*/CHAT.jsonl` grep/append hurts |
| `paths.json` includes `storage.backend: sqlite \| jsonl` | Transition flag only; default `sqlite` after phase 2 |
| Export `mesh export-jsonl` for debugging | Agent-golf: rare full dump, not daily path |

**Not recommended:**

- SQLite as cross-machine queue (seat-mesh is single-host tmux).
- Sharing one DB with product Postgres — different domains.
- libSQL/Turso — overkill for local daemon.

---

## Config shape (target)

```yaml
# .sm/mesh.config.yaml
storage:
  backend: sqlite          # jsonl | sqlite (default sqlite after phase 2)
  sqlite:
    path: runtime/mesh.sqlite   # relative to profileDir → .sm/runtime/mesh.sqlite
  jsonl:
    dir: runtime/daemon         # legacy fallback during migration

orchestrator:
  drain:
    maxInjectPerTick: 1
    idleSettleMs: 5000
  # no redisUrl
```

`paths.json` resolves absolute `storage.sqlite.path` for the daemon.

---

## Tradeoffs

| | JSONL + Redis (today) | Poll only (phase 1) | SQLite (phase 2) |
|--|------------------------|----------------------|------------------|
| Dependencies | Redis optional | none extra | better-sqlite3 |
| Atomic updates | rewrite whole file | rewrite whole file | row-level |
| Burst fan-out wake | BullMQ nudge | poll + coalesce | in-process + poll |
| Debuggability | `tail *.jsonl` | same | `sqlite3 .sm/runtime/mesh.sqlite` + export cmd |
| Dotdir alignment | scattered | JSONL under `.sm/` | one file under `.sm/` |
| Agent-golf | extra service | simplest | one file, queryable |

---

## Implement queue

| Row | Slice | Depends on |
|-----|-------|------------|
| **#1e-a** | Remove BullMQ + `redisUrl` from profile schema/docs | #1d paths optional |
| **#1e-b** | `QueueStore` interface + `SqliteStore` + migrate from JSONL | **#1d** dotdir runtime |
| **#1e-c** | `storage` section in mesh.config + `paths.json` | #1e-b |

**Suggested order:** #1d (paths) → #1e-a (drop Redis) → #1e-b (SQLite) in one or two MRs.

---

## Open questions (operator to decide on continue)

1. **Default backend for greenfield:** `sqlite` immediately, or `jsonl` until SQLite proven?
2. **Keep JSONL export** as permanent debug path, or migration-only?
3. **Room chat** — stay JSONL under `.sm/chat-rooms/` for now? (recommended yes; inbox queues are the hot path)

---

## Related docs to sync on implement

- [CONFIG.md](CONFIG.md) — remove redisUrl; add `storage`
- [PORTABILITY.md](PORTABILITY.md) — "Do I need Redis?" → No
- [ARCHITECTURE.md](ARCHITECTURE.md) — queue model diagram
- `.sm/mesh.config.yaml` — drop `orchestrator.redisUrl`
