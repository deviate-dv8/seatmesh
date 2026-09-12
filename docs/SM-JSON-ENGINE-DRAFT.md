# sm as JSON-driven tmux engine (DRAFT, internal)

Planning doc — not part of the public handout. See [README.md](README.md).

**Status:** proposal  
**North star:** `npx seatmesh` / `./sm.sh` is a thin engine. All durable behavior
lives in **dotdir `.sm/`** + `mesh-agents.json`. No project-specific branches in
packages. OC-LIMIT, proxy recovery, coord repair, launch, comms prefixes,
checkback — all config, not TypeScript magic.

---

## 0. Dotdir + npx init (implemented v0.1)

```bash
# Greenfield project:
cd /path/to/myapp
npx seatmesh init
npx seatmesh session up

# Consumer (existing seat tree preserved):
# .sm/mesh.config.yaml → seats.root: tasks/agent-seats
# tasks/agent-seats/slot-N/FOCUS.md NOT moved or deleted
```

| Path | Owns |
|------|------|
| `.sm/mesh.config.yaml` | Layout, daemon, connectivity, **seats.root pointer** |
| `.sm/roles/*.yaml` | Agent cold-start context (whoami banners) |
| `.sm/mesh-agents.json` | Live slot state (greenfield default) |
| `.sm/runtime/` | Daemon jsonl (target; runtime may use `tasks/seatmesh` until Phase A) |
| `seats.root` (yaml key) | **FOCUS/TASKS/REMINDER** — may be `tasks/agent-seats` (consumer) or `.sm/seats` (new) |

**Profile discovery order:** `--profile` > walk up for `.sm/mesh.config.yaml` >
bundled package profile (legacy dev checkout).

**Init flags:** `--force`, `--seats-root tasks/agent-seats` (migrate without
moving seat files), `--name slug`.

---

## 1. Two config layers (single merge rule)

| File | Owns | Mutated by |
|------|------|------------|
| `.sm/mesh.config.yaml` | Layout, daemon poll/settle, connectivity recovery, comms prefixes, guards, roles dir, seats.root | Humans / `npx seatmesh init` |
| `mesh-agents.json` (path from yaml `state.meshAgentsJson`) | Per-pane CLI type, resumeId/resumeCmd, minis grid override, runtime convention overrides | `./sm.sh save`, future switch/set/tag |

**Merge rule (canonical):**

1. Load profile yaml → Zod validate → `LoadedProfile`
2. If `mesh-agents.json` exists → merge overrides (`layout.minis`, `conventions.*`, slot rows)
3. Engine reads **only** merged profile + mesh-agents — never hardcoded consumer paths

**Engine-only entry:**

```bash
# Today (consumer wrapper — stays at workspace root):
./sm.sh …   # → services/seatmesh --profile .sm/ (or services/seatmesh/profiles/consumer)

# Portable shape:
seatmesh --profile /path/to/profile …
```

---

## 2. What is already JSON-driven (keep, document, wire gaps)

| Concern | Config key(s) | Gap |
|---------|---------------|-----|
| Session name / worker count | `session.*` | OK |
| Base layout + CLI types | `layout.base.{managerStack,cli,coordSync}` | OK after coordSync fix |
| Minis grid | yaml + `mesh-agents.json` `layout.minis` | OK |
| Slot resume | `mesh-agents.json` `manager`/`managerB`/`secretary`/`workers`/`minis` | Write path incomplete (TODO 4.1) |
| Skip empty on launch | `conventions.launchSkipsEmpty` | OK — internal `skipEmpty` param reads JSON |
| Coord reload policy | `layout.base.coordSync` + `conventions.coordSync` | OK — **not** a CLI flag |
| Daemon port / poll | `daemon.port`, `daemon.pollMs` | OK |
| Chat checkback defaults | `chatRooms.checkback.*` | CLI `checkback start` ignores yaml today |
| Connectivity enable + port | `connectivity.enabled`, `connectivity.proxyPort` | OK |
| CPE policy (schema) | `connectivity.policy.*` | **Parsed, not used** by recovery |

---

## 3. Must move off TypeScript / CLI flags → JSON

### 3.1 Connectivity + OC-LIMIT (highest pain)

**Today:** `packages/daemon/src/connectivity-recovery.ts` hardcodes cooldowns,
script paths, pane scan batch, episode timers, resume ack timeout. Limit regex
lives in `packages/providers/src/shared.ts`. Border strings `OC-LIMIT:*` /
`PROXY-DOWN` are fixed in `border-paint.ts`.

**Target:** profile yaml section `connectivity.recovery` (engine reads; consumer
profile fills CPE script paths).

```yaml
connectivity:
  enabled: true
  proxyPort: 18887
  driver: cpe
  policy:
    smartRestart: false
    rotateMaxAttempts: 3
    cooldownMs: 1800000
  recovery:
    scripts:
      proxyUp: scripts/cpe-proxy-up.sh
      smartRestart: scripts/cpe-proxy-smart-restart.sh
      rotateUntil: scripts/cpe-proxy-rotate-until.sh
    timings:
      proxyUpCooldownMs: 60000
      rotateCooldownMs: 180000
      ipifyPollMs: 30000
      ipifyEpisodeMinMs: 15000
      paneScanBatch: 4
      rateLimitEpisodeClearMs: 120000
      proxyDownStuckNotifyMs: 120000
      resumeAckTimeoutMs: 300000
    smartRestart:
      stampPath: /tmp/cpe-proxy-smart-restart.last
      cooldownSec: 1800   # default = policy.cooldownMs / 1000
  limits:
    # optional overrides; default = bundled patterns in profile or engine defaults
    ocLimit: "<regex>"
    ocConnect: "<regex>"
    ccLimit: "<regex>"
  notify:
    resumeAckHowto: "…"   # toast copy; no hardcoded "5m" in TS
```

**Engine behavior:** rising-edge detectors in providers stay generic; **policy**
(when to rotate, when to resume wave, when to clear banner on ack) reads yaml.
No `if (product)` branches.

### 3.2 Daemon / inbox drain

**Today:** `orchestrator.drain.*` and `daemon.idleSettleSec` in schema — **zero
runtime reads**. `compose-gate.ts` uses env `MESH_INBOX_IDLE_SETTLE_MS`.
`mesh-orchestrator.ts` hardcodes checkback fire budget, PEER priority, ACK regex.

**Target:**

```yaml
daemon:
  port: 3100
  pollMs: 4000
  idleSettleMs: 5000          # single field — compose-gate + drain
  checkbackFireBudget: 1
  drain:
    maxInjectPerTick: 1
    digestCooldownMs: 5000
  peer:
    kindPriority: { prompt: 0, remind: 1, to-slot: 2, to-mini: 3, room: 4 }
    skipGlobalThinFyiToWorkers: true
    ackPatterns: ["^ACK:", "^FYI:", …]

data:
  root: tasks/seatmesh
  daemonSubdir: daemon        # replaces hardcoded tasks/seatmesh/daemon strings
```

### 3.3 Launch / agent commands

**Today:** `agent-builder.ts` hardcodes `opencode-cpe.sh`, claude
`--permission-mode auto`, env prefix.

**Target:**

```yaml
agents:
  launch:
    envPrefix: "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor"
    wrappers:
      opencode: scripts/opencode-cpe.sh
      opencodeMain: scripts/opencode-main.sh
    claude:
      permissionMode: auto
```

Resume rows stay in `mesh-agents.json` (`resumeCmd` wins when present).

### 3.4 Comms prefixes (documented but missing from schema)

**Today:** `COMMS.md` mentions `comms.prefixes`; schema has only
`daemon.managerPromptPrefix`. Mini/secretary prefixes hardcoded in TS.

**Target:**

```yaml
comms:
  prefixes:
    manager: "[agent-manager-kiro-cursor-claude]"
    worker: "[agent-worker-slot-{n}]"
    mini: "[agent-manager-mini-{n}]"
    secretary: "[mesh-secretary]"
    supervisor: "[mesh-supervisor]"
```

### 3.5 Layout / coord roles

**Today:** `manager-b` is a structural enum (OK). Special cases: launch never
skips manager-b empty, fanout audience hardcoded, `@mesh_title` strings in TS.

**Target:** keep role ids in schema enum; move **display titles**, **fanout
audience**, and **coord repair role list** to yaml:

```yaml
layout:
  base:
    managerStack: [manager, manager-b]
    coordRoles: [manager-b, secretary]   # derived default from stack + columns
    titles:
      manager: master
      manager-b: master-b
      secretary: secretary

chatRooms:
  globalAudience: [manager, manager-b, secretary]   # default coord panes
```

### 3.6 Guards / permissions

**Today:** `packages/core/src/slot/guards.ts` `DEFAULT_GUARDS` — comment says
profile may override; no yaml schema.

**Target:** `guards:` per role in profile (manager, manager-b, secretary, worker,
mini) with allow/deny action lists.

### 3.7 CLI flags → yaml defaults (operational flags stay)

| CLI flag today | Move to yaml | Keep on CLI |
|----------------|--------------|-------------|
| `layout --no-leads` | `layout.minis.applyLeadsOnRelayout: true` | `--no-leads` one-shot override |
| `reload --layout` | `session.reloadRelayout: false` | `--layout` explicit relayout |
| `MESH_SKIP_LAUNCH=1` | `session.launchOnCreate: true` | env for emergencies only |
| `checkback start 5m --renew 3m` | read `chatRooms.checkback` | explicit args override |
| `secretary watch on 5m` | `daemon.secretary.watchInterval: 5m` | — |
| `--profile` | — | always (portability) |
| `layout --dry-run` / `--yes` | — | safety gates |

**Rule:** CLI may override json **for one invocation**; json is the default operator
never has to remember.

---

## 4. mesh-agents.json extensions

```jsonc
{
  "schemaVersion": 2,
  "conventions": {
    "launchSkipsEmpty": true,
    "coordSync": { "reload": false, "attach": true },
    "miniDefaultRole": "helper"
  },
  "layout": {
    "minis": { "grid": "4x2", "max": 8, "leads": [1, 2] },
    "workers": { "grid": "3x2", "slots": 6 }
  },
  "secretary": { "wanted": true, "type": "opencode", "resumeCmd": "…" },
  "managerB": { "type": "opencode", "resumeCmd": "…" }
}
```

**TODO 4.1 (blocker for full json engine):** switch / set / tag / launch must
**write** mesh-agents.json — not only `./sm.sh save` scrape.

---

## 5. Package boundaries (engine vs profile)

```
profiles/consumer/
  mesh.config.yaml     # consumer layout + CPE + comms
  roles/*.yaml         # cold-start banners (already profile-local)

seatmesh/packages/
  core/                # Zod schemas ONLY — no consumer strings
  tmux/                # generic tmux verbs (layout, launch, labels, reload)
  daemon/              # inbox drain — reads connectivity.* + daemon.*
  providers/           # CLI detect/inject — limit patterns from profile or defaults
  cli/                 # argv → load profile → dispatch (no business rules)
```

**Delete over time:** hardcoded `tasks/seatmesh/daemon` paths, duplicated
defaults in `base-layout.ts` when yaml always supplies `cli`, env-only settle
knobs, legacy `tmux-main-agents.json` write path.

---

## 6. Implementation phases (agent-golf order)

### Phase A — Config actually read (no new features)

1. Wire `data.root` + `daemonSubdir` everywhere state jsonl is opened
2. Wire `daemon.idleSettleMs` → compose-gate (drop env-only path)
3. Wire `orchestrator.drain` / `daemon.drain` in mesh-orchestrator
4. Wire `connectivity.policy` + `connectivity.recovery.timings` in
   connectivity-recovery (delete TS constant block)
5. Checkback CLI defaults ← `chatRooms.checkback`

**Verify:** change yaml cooldown → recovery behavior changes without TS edit.

### Phase B — OC-LIMIT end-to-end json

1. Move limit regex overrides to `connectivity.limits` (optional)
2. Move resume ack timeout + notify copy to yaml
3. Border labels from `connectivity.recovery.labels` or comms section
4. Tests: profile fixture with fake short timeouts

**Verify:** `./sm.sh test` + forced limit fixture.

### Phase C — Launch + comms json

1. `agents.launch` section drives agent-builder
2. `comms.prefixes` in schema + all inject paths
3. `guards` in schema + whoami/prompt gate

### Phase D — mesh-agents write path

1. switch/set/tag persist to mesh-agents.json
2. Deprecate tmux-main-agents.json reads for mesh session
3. `./sm.sh save` remains scrape fallback

### Phase E — CLI debloat

1. Remove redundant flags where yaml default matches operator preference
2. ONE-PATH.md: one table "config key → behavior" (no flag forest)
3. Debloat TS special-case branches replaced by config loops

---

## 7. Acceptance criteria ("sm is just the engine")

- [ ] Zero product-specific strings / `18887` / `cpe-proxy` in `packages/*`
      (only in `profiles/consumer/mesh.config.yaml`)
- [ ] `./sm.sh reload` behavior fully explained by `coordSync` + `managerB` row
      — no hidden skip params
- [ ] OC-LIMIT recovery timings changed only in yaml on a test profile
- [ ] New profile directory + mesh-agents.json runs without code changes
- [ ] `mesh.config.yaml` validates unused keys (or schema documents all keys read)

---

## 8. Open questions (operator)

1. **Schema version bump** mesh-agents `schemaVersion: 2` — OK to migrate now?
2. **Role ids** — keep `manager-b` as stable enum vs generic `coord-2` slots?
3. **Limit patterns** — yaml regex (flexible) vs named presets (`cpe-zen`)?
4. **Legacy harness** — when can mesh stop reading `tmux-main-agents.json` entirely?

---

## 9. Related docs to update on approve

- `docs/ONE-PATH.md` — config table replaces flag list
- `docs/STATE.md` — full conventions + connectivity.recovery
- `docs/ARCHITECTURE.md` — engine vs profile boundary
- `docs/COMMS.md` — add `comms.prefixes` to schema (currently doc-only)
- `tasks/seatmesh/TODO.md` — Phase A–E rows

---

*Draft v0.1 — 2026-09-12. Source: full seatmesh grep audit (cli, tmux, daemon,
providers, schema vs runtime).*
