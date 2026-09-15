# Extending roles (user)

## Layout (role-pack 1.1+)

```text
.sm/roles/
  _vendor/           # LOCKED — seatmesh update / roles migrate
    ROLE_PACK.json
    *.yaml
    docs/*.md
  *.extend.yaml      # USER — never overwritten
  columns/           # optional column overlays (user)
```

## Locked sections

Each `_vendor/<kind>.yaml` lists:

```yaml
locked:
  - banner
  - read_first
  - policies
```

| Section | Extend may |
|---------|------------|
| `banner` / `read_first` / `files` | **Append** only |
| `policies` | **Add new ids** only — cannot replace engine ids (`peer`, `checkback`, …) |
| unlocked | Child wins on conflict |

## Commands

```bash
seatmesh roles status              # pack version + gaps
seatmesh roles migrate             # up to current pack (default 1.1.0)
seatmesh roles migrate --to 1.0.0  # down: flatten to legacy flat yaml
seatmesh update                    # refresh _vendor + auto-migrate pack
```

Never edit `_vendor/`. Put project POV in `*.extend.yaml`.
