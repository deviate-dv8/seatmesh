# @seat-mesh/web — operator console

**AdonisJS 7** + Inertia + Vue 3 + **PrimeVue**.

Canonical plan: [`docs/UI-ADONIS-PLAN.md`](../../docs/UI-ADONIS-PLAN.md)  
Blocks `seatmesh@1.2.x` until cutover (TODO **G-1.2**).

Fresh scaffold from official v7 Vue kit (`npm create adonisjs@latest -- -K=vue`). No v6 migration.

## Dev

```bash
cd packages/web
npm run dev
# → http://127.0.0.1:3190
```

From repo root: `npm run web`

## Phase 0

- Dashboard landing + Sessions stubs (PrimeVue)
- Port **3190** · bind `127.0.0.1`
- Kit auth (login/signup) kept; hub pages are public for now

## Next

Phase 1 — live `sessions.json` + daemon `/health` probes.
