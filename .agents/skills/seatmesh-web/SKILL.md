---
name: seatmesh-web
description: >-
  Seatmesh operator web console (packages/web). Use when editing the AdonisJS 7
  + Inertia + Vue hub on :3190, dashboard/sessions/targets/queues UI, or hub
  styling. Stack is Nuxt UI (MIT) — not PrimeVue / OpenVue forks.
---

# seatmesh-web

Package: `packages/web` (`@seat-mesh/web`) · hub **`:3190`**  
Stack: **AdonisJS 7** · Inertia · Vue 3 · **Nuxt UI** · Tailwind 4  
Plan: `docs/UI-ADONIS-PLAN.md` · blocks `seatmesh@1.2.x`

## Do / don’t

- **Do** use Nuxt UI (`UButton`, `UCard`, `UBadge`, `UApp`, …) + teal primary theme in `inertia/css/app.css`.
- **Don’t** reintroduce PrimeVue / OpenVue / `@primeuix` / `@openvue`.
- **Don’t** ship login — localhost-first (plan §2).
- Vite: `ui({ router: 'inertia' })` in `vite.config.ts`; `app.use(ui)` from `@nuxt/ui/vue-plugin`.
- Mutations go hub → daemon HTTP only (never browser `tmux send-keys`).

## Routes

| Path | Role |
|------|------|
| `/` | Dashboard (poll health, alerts, deep links) |
| `/sessions` | Registry list |
| `/sessions/:id` | Overview + CTAs |
| `/sessions/:id/targets` | Targets CRUD via daemon |
| `/sessions/:id/queues` | ACK / CB / inbox / pane-ops |
| `/notifications` | Multi-mesh alert feed |

## Dev / lifecycle

```bash
# preferred (detached; works via npx seatmesh when checkout is findable)
npx seatmesh web up
npx seatmesh web status
npx seatmesh web down
npx seatmesh web restart --open

# foreground HMR (repo root)
npm run web   # → packages/web ace serve --hmr

# outside checkout
export SEATMESH_WEB_ROOT=/path/to/seatmesh/packages/web
seatmesh web up
```

Help: `seatmesh help web` · docs: `docs/cli/web.md` · `docs/patterns/cli-web-parity.md`

## Waygraph E2E (hub UI)

Consumer: `packages/web/waygraph/` (`waygraph@0.7.4`). Test env:
`packages/web/.env.waygraph` boots hub on **`:3191`** (Playwright `webServer`).
Engine handout: zsign `.sm/seats/_shared/WAYGRAPH-HANDOUT.md`.

```bash
npm run web:test                         # self-contained — no dev hub needed
cd packages/web/waygraph && npm run test:reuse   # hit dev hub :3190 instead
```

Optional: `SEATMESH_WG_SESSION_ID` to pin registry row; else global-setup picks first.

Notify when glance-ready:

```bash
seatmesh agent notify link "Hub UI" --url "http://127.0.0.1:3190/"
```
