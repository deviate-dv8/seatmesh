# sm opencode-cpe

```text
OpenCode via CPE proxy — spawn / relaunch any seat

  sm switch <target> opencode-cpe [--keep-resume|--fresh] [--queue]
  sm launch minis | launch secretary | launch <slot-N>

  <target> = secretary | manager | mini-N | slot-N | here

  opencode-cpe  ≠  oc / opencode  (direct, no CPE script)
```

## Config (once)

```yaml
agents:
  runners:
    opencode-cpe: scripts/opencode-cpe.sh
connectivity:
  driver: cpe
  proxyPort: 18887
```

| Default for… | Where |
|--------------|--------|
| Base columns | `layout.base.cli.<id>: opencode-cpe` |
| Minis / workers | `.sm/mesh-agents.json` → `conventions.miniDefaultCli: opencode-cpe` |

`sm config check`

## Examples

```bash
sm switch secretary opencode-cpe --keep-resume
sm switch mini-3 opencode-cpe --keep-resume
sm launch minis                    # after miniDefaultCli = opencode-cpe
env -u TMUX_PANE sm switch …       # from plain shell (stale TMUX_PANE)
```

## Stuck mid-build

Esc×3 → composer idle → `sm agent whoami`. Full relaunch only if needed: `--fresh`.

All opencode-cpe panes stuck / need CONTINUE without typing it: `./scripts/opencode-cpe-atomics.sh`
(record → kill CPE OC → revive → CONTINUE across pia/zsign/seatmesh).

- CLI: `sm switch --help` · `sm launch --help`
- Agent card: `sm agent help switch`
- Profile: `.sm/AGENTS.md` § OpenCode via CPE
