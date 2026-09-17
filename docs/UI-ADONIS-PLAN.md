# seatmesh web console — AdonisJS + Vue Inertia + PrimeVue

**Status:** Phase 2 in progress · **Nuxt UI** (MIT) · blocks `seatmesh@1.2.x`  
**Stack:** **AdonisJS 7** · Inertia · Vue 3 · **Nuxt UI** · Tailwind 4 · Vite  
**Package:** `packages/web` (`@seat-mesh/web`) · hub port default **`:3190`**  
**Scaffold:** Adonis 7 Vue kit — UI kit is Nuxt UI (not PrimeVue / not OpenVue forks)

---

## 1. Why

Today the “web UI” is thin static HTML inside each mesh inbox daemon:

| Surface | Today |
|---------|--------|
| Targets | `packages/daemon/static/ui/index.html` + `/targets` API |
| Decide | `decide.html` + `/act/card/:id` |
| Info / Yes-No | `notify-act-ui.ts` HTML strings |
| Multi-mesh | CLI only (`sessions` / `remote` / `report`) |

You want an **operator control plane**: landing dashboard, sessions, version, session view, terminals, hosted MDs, notifications, daemon healths, and the rest of the QoL surface — with **PrimeVue**.

That is a product UI, not a static page. Adonis + Inertia + Vue is the migration target; **1.2.x does not ship until this lands**.

---

## 2. Architecture (hybrid hub)

```
┌─────────────────────────────────────────────────────────┐
│  packages/web  (Adonis + Inertia + Vue + PrimeVue)      │
│  bind 127.0.0.1:3190  ← operator browser                 │
│                                                         │
│  Dashboard · Sessions · Session · Terminals ·           │
│  Notifications · Hosted MDs · Tools                     │
└────────────┬───────────────────────────┬────────────────┘
             │ server-side HTTP          │ optional proxy
             ▼                           ▼
   ~/.config/seatmesh/sessions.json    each mesh daemon
   + mesh.config remotes               :31680 / :31744 / …
             │                           │
             │                    /health /targets /act/*
             │                    /ack /patience /inbox …
             ▼                           ▼
        aggregate view            keep toast deep-links stable
```

**Decision: one global hub + keep daemon APIs.**

| Layer | Owns |
|-------|------|
| **Hub (`packages/web`)** | Multi-mesh dashboard, session views, terminals overview, MD center, notification inbox, QoL tools UI |
| **Daemon (unchanged contracts)** | `/health`, `/targets`, `/act/*`, `/ack`, `/patience`, `/inbox`, peer drain — CLI + toast URLs stay valid |
| **Compat** | Daemon `GET /ui` → **302 → hub** (or embed reverse-proxy). `GET /act/card/:id` keeps working (daemon renders **or** redirects to hub `/act/card/:id` with same id) |

**Not chosen:** rewrite the inbox daemon into Adonis (too coupled to tmux/jsonl/orchestrator). Hub talks *to* daemons.

**Localhost-first:** bind `127.0.0.1` only for v1. No multi-user auth until later.

---

## 3. Information architecture

### Nav (PrimeVue Menubar / Drawer)

1. **Dashboard** `/`  
2. **Sessions** `/sessions`  
3. **Notifications** `/notifications`  
4. **Hosted MDs** `/mds`  
5. **Tools** `/tools`  
6. Session-scoped (from a session row): **Overview · Terminals · Targets · Queues**

### Pages

| Route | Purpose | Primary data |
|-------|---------|----------------|
| `/` | Landing dashboard | Live session count, daemons up/down, open ACKs / peer backlog / pane-ops (sum), seatmesh version + npm latest, recent notify cards, proxy/carrier alerts |
| `/sessions` | All meshes | Global registry + parallel `/health` (reuse hardened probe: 2.5s × 3) |
| `/sessions/:id` | Session view | Health JSON, proxy/carrier, workers/minis, unresolved inbox, ack/cb counts, quick links |
| `/sessions/:id/terminals` | Terminals / panes | `mesh-agents.json` + pane meta (role, slot, CLI type, busy/idle, ports) — **read-only v1** |
| `/sessions/:id/targets` | Targets UI (migrate) | Daemon `GET/POST /targets` + done/cancel/triage |
| `/sessions/:id/queues` | Inbox / peer / pane-ops | `/inbox`, peer unsent, `/pane-ops`, `/patience` |
| `/notifications` | Notify center | Act card registry / recent Info+YesNo; deep-link to cards |
| `/act/card/:id` | Info / Decide (Inertia) | Same card payload as today; PrimeVue Dialog/Panel + Mermaid |
| `/mds` | Hosted markdown | Preview history / mdview.io links; open in-app Mermaid viewer |
| `/tools` | QoL toolbox | Version, update nudge, proxy check, inbox restart **hint** (operator-only; may shell out later), report snapshot |
| `/about` | Version | `seatmesh` package version, hub build, daemon engines per session |

### Dashboard widgets (PrimeVue)

- **Stat cards:** sessions live · daemons up · peer unsent · open acks  
- **Version chip:** local vs npm (`version --json` logic)  
- **Health table:** one row per session (port, ready, pollBusy, proxy)  
- **Alert list:** carrier down, wedged health, pane-ops backlog  
- **Recent notifications**  
- **CTA:** open session · open Targets · open Decide  

---

## 4. Map: CLI / daemon → UI

| QoL need | Today | Hub page / action |
|----------|--------|-------------------|
| List meshes | `sessions` / `remote` | `/sessions` |
| Daemon health | `inbox` / `report` / `GET /health` | Dashboard + session view |
| Version | `version` | Dashboard chip + `/about` |
| Targets | `target *` + `/ui` | `/sessions/:id/targets` |
| Notify Info/YesNo | `notify *` + `/act/card` | `/notifications` + `/act/card/:id` |
| Preview / mdview | `preview` | `/mds` |
| ACKs / CBs | `ack` / `cb` + `/ack` `/patience` | Session queues + Tools |
| Inbox resolve | `inbox list\|resolve` | Session queues |
| Proxy / carrier | `proxy status` | Dashboard alert + session overview |
| Pane kinds | `kind` / `peek` / scrape | `/terminals` |
| Layout / reload | CLI only | Tools → “run in pane” copy (no browser tmux) |

**Hard rule (same as mesh):** browser never raw `tmux send-keys`. Mutations go through **daemon HTTP** (or hub → daemon). Inject stays daemon-owned.

---

## 5. Tech choices

| Piece | Choice | Notes |
|-------|--------|--------|
| Backend | **AdonisJS 7** | Controllers + services; call daemons with `fetch`; typed `inertia.render` via codegen |
| Bridge | Inertia | Vue SFCs as pages; shared layout |
| UI kit | **PrimeVue 4** (Aura or Nora preset) | DataTable, Menubar, Card, Tag, Toast, Dialog, Tabs, Timeline |
| Style | CSS variables / seatmesh tokens | Avoid purple-on-white AI default; brand-first landing |
| Mermaid | mermaid.js in card + MD viewer | Port validation from `mermaid-validate.ts` |
| Markdown | marked + DOMPurify (already in daemon) | Shared util or duplicate thin wrapper in hub |
| State | Inertia props + small Pinia only if needed | Prefer server props for health snapshots |
| Realtime (later) | SSE or short poll | v1 = refresh / 5–10s poll on dashboard |

### Brand / landing

First viewport = **one composition**: seatmesh wordmark, one line (“operator control plane”), session/health summary, primary CTA (**Open sessions**). Not a widget dump. Dashboard density lives *below* or on `/sessions`.

---

## 6. Phased delivery

### Phase 0 — Scaffold (now)

- [x] Nuke any v6 attempt; fresh `packages/web` from **Adonis 7 Vue kit** (`-K=vue`)
- [x] PrimeVue + brand tokens + Menubar layout
- [x] Stub pages: Dashboard, Sessions
- [x] Port `:3190` · `npm run web` from repo root
- [ ] Keep publishing on **1.1.x**

### Phase 1 — Read-only control plane

- [ ] `SessionRegistry` service ← `~/.config/seatmesh/sessions.json` + tmux discover (reuse CLI logic via `@seat-mesh/core` / thin copy)  
- [ ] `DaemonProbe` ← parallel `/health` (2.5s × 3)  
- [ ] Dashboard + Sessions + Session overview wired to live data  
- [ ] Version service (local package + optional npm)  

### Phase 2 — Migrate Targets + Act cards

- [ ] Proxy/session-scoped Targets CRUD → daemon `/targets`  
- [ ] Inertia Info / Yes-No pages; Mermaid + light theme parity  
- [ ] Daemon: `/ui` → redirect hub; `/act/card/:id` either proxy-to-hub or keep HTML until parity  
- [ ] Delete/stop shipping static `static/ui` as primary  

### Phase 3 — Terminals, MDs, notifications

- [ ] Terminals grid from scrape / mesh-agents  
- [ ] Notifications center (card index + filters)  
- [ ] Hosted MDs (preview URLs + in-app render)  

### Phase 4 — Mutations / QoL tools

- [ ] Safe writes: target done/cancel, inbox resolve, cb cancel (via daemon)  
- [ ] Tools page: report snapshot, proxy status, copy-paste CLI recipes  
- [ ] Optional: “open card” / re-notify  

### Phase 5 — Cutover → **1.2.0**

- [ ] Feature parity checklist signed off  
- [ ] Daemon `/ui` always redirects; docs/COMMS updated  
- [ ] Publish `seatmesh@1.2.0` (+ note hub: `npx seatmesh web` or `seatmesh console`)  

---

## 7. CLI entry (planned)

```bash
seatmesh web up           # start hub :3190 (detached; or web down|restart|status)
seatmesh web --port 3190
# agents stay on `seatmesh agent …`; hub is operator/shared (like session/report)
```

Outside-`agent` verb — humans and session ops.

---

## 8. Repo layout (target)

```
packages/web/
  adonisrc.ts
  app/Controllers/Http/…
  app/Services/SessionRegistry.ts
  app/Services/DaemonProbe.ts
  inertia/pages/Dashboard.vue
  inertia/pages/Sessions/Index.vue
  inertia/pages/Sessions/Show.vue
  inertia/pages/Sessions/Terminals.vue
  inertia/pages/Notifications/Index.vue
  inertia/pages/Mds/Index.vue
  inertia/pages/Tools/Index.vue
  inertia/pages/Act/Card.vue
  inertia/layouts/AppLayout.vue
  resources/css/app.css          # PrimeVue + brand tokens
  start/routes.ts
  package.json                   # @seat-mesh/web
```

Workspace wire-up in root `package.json` `workspaces` + build order (web optional for CLI publish until 1.2).

---

## 9. Risks & constraints

| Risk | Mitigation |
|------|------------|
| Toast URLs break (`/act/card` on daemon port) | Compat shim on daemon forever or dual-publish card on hub with same ids (shared registry dir) |
| `/health` slow under drain | Already retried probes; hub caches 2–5s |
| Adonis in npm `seatmesh` tarball bloat | Ship hub as optional `@seat-mesh/web` or `seatmesh-web`; CLI depends when ready |
| Accidental 1.2 publish | RELEASE.md + TODO G-1.2 gate |
| Browser tmux abuse | No PTY; read-only terminals until explicit API |

---

## 10. Success bar (before 1.2.0)

- [ ] Hub shows all registry sessions with correct daemon up/down  
- [ ] Session view matches `report --verbose` essentials  
- [ ] Targets usable from hub (parity with old `/ui`)  
- [ ] Info/Yes-No cards usable from hub (Mermaid OK)  
- [ ] Notifications + MD entry points exist  
- [ ] Terminals list panes for a session  
- [ ] `seatmesh web` documented in help + ONE-PATH  
- [ ] Old `/ui` redirects; no regression on CLI notify toasts  

---

## Immediate next actions

1. ~~Scaffold `packages/web` (Phase 0)~~ — done (`@seat-mesh/web`, PrimeVue, Dashboard/Sessions stubs, `:3190`)
2. Wire `SessionRegistry` + `DaemonProbe` (Phase 1)
3. Do **not** bump version to 1.2.x

**Dev:** `npx seatmesh web up` → http://127.0.0.1:3190 · or `npm run web` from repo root (foreground).

---

## Appendix A — Daemon API inventory (hub calls these)

Per-mesh inbox on `127.0.0.1:<daemonPort>` (`mesh-inbox-server.ts`). **Hard constraint:** keep `/act/register`, `/act/card/:id`, `/act/v1/:token` stable for CLI notify toasts.

### Browser / act (compat)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/ui`, `/ui/*` | Static Targets/Decide (migrate → hub; then 302) |
| GET | `/ui/demo-yesno` | Yes/No demo page |
| GET | `/act/card/:id` | Info/decision card (GFM+Mermaid) |
| GET | `/act/v1/:token` | One-shot act → result HTML |
| POST | `/act/register` | Register actions (± card); `links`, optional `infoUrl` |

Act types: `peer` · `inbox-resolve` · `checkback-ack` · `ping`.

### Health / queues

| Method | Path | Hub use |
|--------|------|---------|
| GET | `/health` | Dashboard + session overview |
| GET/POST | `/pane-ops`, POST `/pane-ops/clear` | Queues / Tools |
| GET/POST | `/targets`, POST `/targets/:id/{done,cancel,triage,remind}` | Targets page |
| GET/POST | `/ack*`, `/patience*` | ACK/CB panels |
| GET | `/inbox`, POST `/inbox/resolve` | Inbox queue |
| POST | `/to-peer`, `/room-fanout`, `/to-master` | Comms (CLI-first; optional Tools) |
| POST | `/limit/idle`, `/limit/idle/clear` | QoL |
| POST | `/connectivity/oc-resume` | Proxy recovery |

### Data sources (not all HTTP yet)

| Domain | Source |
|--------|--------|
| Sessions | `~/.config/seatmesh/sessions.json` + tmux discover + `/health` |
| Targets | `TARGET.jsonl` / sqlite via `/targets` |
| PEER / ACK / CB / Inbox / Pane-ops | `*.jsonl` under `.sm/runtime/daemon/` |
| Act cards | In-memory registry (lost on daemon restart) |
| Version | CLI `version` (no daemon route) — hub reads package.json + optional npm |
| Preview / MD | `preview` → mdview.io; local Mermaid on `/act/card` |

Store root: `profilePaths().stateDir` → e.g. `.sm/runtime/daemon/`.

### CLI ↔ page map (QoL)

`sessions`/`remote` → Sessions · `report`/`inbox` → health strip · `target` → Targets · `notify`/`preview` → Notifications + MDs · `ack`/`cb` → queues · `version` → About · `hub` → landing sections.
