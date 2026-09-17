# seatmesh NOW

**Updated:** 2026-09-17

**Design NOW:** open agent kinds — providers emit `kindBase` / `kindExtensions`.
CPE OpenCode = kind **`opencode-cpe`** (`extends: opencode`). Legacy name `oc-proxy`
is only a normalize alias (not a CliType / not a provider).

**Read:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [TODO.md](TODO.md) P6

## Done

- Open kinds + prove/satisfy/recovery (`1.2.4`)
- Canonical CPE kind rename: `opencode-cpe` (oc-proxy alias only)

## Next

1. **P6.1** `.sm/providers/` drop-in (Kimi without fork)
2. **P6.2** `sm kind list|show`
3. Delete `origin/oc-proxy` git branch when ready
