# seatmesh NOW

**Updated:** 2026-09-17

**Design NOW:** open agent kinds — providers emit `kindBase` / `kindExtensions`.
CPE OpenCode = kind **`opencode-cpe`** (`extends: opencode`). Legacy name `oc-proxy`
is a normalize alias — **config that still says `oc-proxy` must keep working**.

**Migration CLOSED** when: (1) pia/zsign `providers`/`runners`/`cli: oc-proxy` launch CPE,
(2) four atomics record→kill→revive→CONTINUE work (`scripts/opencode-cpe-atomics.sh` /
`oc-proxy-atomics.sh` shim).

**Read:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [TODO.md](TODO.md) P6

## Done

- Open kinds + prove/satisfy/recovery (`1.2.4`)
- Canonical CPE kind rename: `opencode-cpe` (oc-proxy alias only)
- **oc-proxy config compat + 4 atomics proved** (stamp path aligned; type `opencode-cpe`|
  `oc-proxy` both selected)

## Next

1. **P6.1** `.sm/providers/` drop-in (Kimi without fork)
2. **P6.2** `sm kind list|show`
3. Delete `origin/oc-proxy` git branch when meshes no longer need the alias story
