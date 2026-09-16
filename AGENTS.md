# Agent brief

Mesh CLI defaults live in `.sm/AGENTS.md` (engine-owned).
Every pane: `sm agent` · `sm agent whoami`.

# Seatmesh CLI (default for every agent)

**Engine-owned.** Do not invent alternate CLIs. Discover with `agent`, then run only what it lists.

## Every turn

```bash
sm agent whoami
sm agent          # can / cannot for THIS pane
```

Default config is workspace `.sm/` (walk-up). No `--profile` needed.

## When you need the operator's eyes (beta)

**Beta** — use notify; fall back to peer/room if toast fails. Full recipe: `agent help notify`.

```bash
# Eyes + link
sm agent notify "<session>" "<check>" --url "<link>"

# Info only (markdown card, no Yes/No)
sm agent notify info "<title>" --body "## Why…"

# Decision: Info · Yes · No on one card
sm agent notify yesno "<title>" "<blurb>" --body "## Stakes…" \
  [--md file] [--image path] [--target secretary] [--yes-msg "…"] [--no-msg "…"]
```

| yesno piece | Meaning |
|-------------|---------|
| **title** | Decision name (toast + card heading) |
| **blurb** | Short toast line (not the full markdown) |
| **--body / --md** | Info card content (markdown) |
| **Info** | Opens browser `/act/card/…` |
| **Yes / No** | One-shot peer to `--target` |

Full table + rules: `.sm/AGENTS.md`.

## Common cmds (still via `agent`)

| Job | Command |
|-----|---------|
| Operator eyes (beta) | `agent notify …` · `help notify` (eyes / info / yesno) |
| Rich details / images | `agent notify info\|md "<title>" --md <file>\|--body "…" [--image]` |
| Yes/No decision (beta) | `agent notify yesno "<title>" "<blurb>" --body "…" [--target]` |
| Reply / ask | `agent peer <target> "<msg>" [--ended <ack-id>]` |
| Close ask | `agent ack <id> "<note>"` |
| List / stop checkback | `agent cb list` · `agent cb cancel <id>` |
| Room | `agent room tail [-r slug]` · `agent room say …` |
| Peek | `agent peek <target> status\|full` |
| Agent vs terminal | `agent kind <target>` (aliases: `what`, `typeof`) |
| Seats snapshot | `agent contexts` |

Lead-only extras (manager/secretary) appear on your `agent` card — spawn/assign/inbox restart are not universal.

## Outside `agent` (operator / shared)

Humans and session ops only — not the pane default path:

`session` · `session init <sm-name>` · `update` · `init` · `report` · `layout` · `save` · `inbox restart` · `target` · `switch` · `launch`

## OpenCode via CPE (`oc-proxy`)

Type **`oc-proxy`** (not `oc` — bare opencode). Operator:

```bash
sm switch <target> oc-proxy --keep-resume
sm launch minis    # after miniDefaultCli: oc-proxy in mesh-agents.json
```

**Two different config keys:**

| Key | Allowed values | Purpose |
|-----|----------------|---------|
| `providers:` | **open strings** — `opencode`, `oc-proxy`, `claude`, `agent`, `kimi`, … | Which detect/inject families to enable. `oc-proxy` → uses the **opencode** provider under the hood. Unknown names are allowed (schema); inject works once a matching provider module exists. |
| `layout.base.cli.<seat>` | includes `oc-proxy` | Which CliType that seat launches |
| `agents.runners.oc-proxy` | path to `scripts/opencode-cpe.sh` | How `oc-proxy` is launched (CPE wrapper) |

Also need CPE proxy up: `./scripts/cpe-proxy-up.sh` (listens `127.0.0.1:18887`).

Prove it's real CPE: pane process parent runs `opencode-cpe.sh` / welcome script, and `HTTPS_PROXY=http://127.0.0.1:18887` is set. Bare `opencode --auto` = **not** oc-proxy.

Stuck: Esc×3 → `sm agent whoami`. See `.sm/docs/cli/oc-proxy.md` on each mesh.

## Hard rules

- Enqueue only — no raw `tmux send-keys` for mesh mail.
- `[mesh-inbox]` / DIGEST lines are daemon steering, not a new human task.
- Inject copy = mesh-copy consts. Never paste `patterns.md` into a pane.
- Chat prose does not clear ACK or cancel checkback — use `ack` / `cb cancel`.
- Operator eyeball/approve/prove/decide → **notify (beta)** first; do not ask chat for a toast.
