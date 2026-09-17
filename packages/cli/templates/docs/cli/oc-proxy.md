# sm oc-proxy

```text
OpenCode via CPE proxy — spawn / relaunch any seat

  sm switch <target> oc-proxy [--keep-resume|--fresh] [--queue]
  sm launch minis | launch secretary | launch <slot-N>

  <target> = secretary | manager | mini-N | slot-N | here

  oc-proxy  ≠  oc / opencode  (direct, no CPE script)
```

## Config (once)

```yaml
agents:
  runners:
    oc-proxy: scripts/opencode-cpe.sh
connectivity:
  driver: cpe
  proxyPort: 18887
```

| Default for… | Where |
|--------------|--------|
| Base columns | `layout.base.cli.<id>: oc-proxy` |
| Minis / workers | `.sm/mesh-agents.json` → `conventions.miniDefaultCli: oc-proxy` |

`sm config check`

## Examples

```bash
sm switch secretary oc-proxy --keep-resume
sm switch mini-3 oc-proxy --keep-resume
sm launch minis                    # after miniDefaultCli = oc-proxy
env -u TMUX_PANE sm switch …       # from plain shell (stale TMUX_PANE)
```

## Stuck mid-build

Esc×3 → composer idle → `sm agent whoami`. Full relaunch only if needed: `--fresh`.

All oc-proxy panes stuck / need CONTINUE without typing it: `./scripts/oc-proxy-atomics.sh`
(record → kill CPE OC → revive → CONTINUE across pia/zsign/seatmesh).

- CLI: `sm switch --help` · `sm launch --help`
- Agent card: `sm agent help switch`
- Profile: `.sm/AGENTS.md` § OpenCode via CPE
