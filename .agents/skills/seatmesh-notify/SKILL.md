---
name: seatmesh-notify
description: >-
  Seatmesh operator-eyes notify (beta). Use when the operator must look,
  approve, prove, decide, open a URL, or see an Info/Yes-No card — not when
  chatting for a toast. Covers notify link, eyes, info/md, and yesno.
---

# seatmesh-notify

**Beta.** Prefer notify over asking chat for eyes. If toast/link fails, fall back to `agent peer` / `agent room say`.

Full recipe: `seatmesh agent help notify`.

## Pick one shape

```bash
# 1) Link only — toast Open → URL (no card)
seatmesh agent notify link "<title>" --url "http://127.0.0.1:3190/"
# aliases: notify url | notify open | notify "<t>" "<check>" --url …

# 2) Info only — markdown card, no Yes/No
seatmesh agent notify info "<title>" --body "## …"
# or: --md ./brief.md [--image shot.png] [--url https://…]
# aliases: notify md | notify details

# 3) Decide — Info + Yes + No
seatmesh agent notify yesno "<title>" "<blurb>" \
  --body "## Why …" \
  [--target secretary] [--yes-msg "…"] [--no-msg "…"]
```

| Piece | Meaning |
|-------|---------|
| **title** | Toast + card heading |
| **body** / `--md` | Stakes, options, mermaid (put URL in body if useful) |
| **Info** | Opens hub `/act/card/…` (`:3190`) |
| **Yes / No** | One-shot peer to `--target` (default secretary/manager per card) |

## Rules

- Eyeball / approve / prove / decide → notify first.
- Do not ask the operator in chat to “look” or “approve”.
- Golf: URL → `notify link`. Prose/mermaid → `notify info`. Decision → `notify yesno`.

## Related

- Mesh gateway → skill `seatmesh-agent`
- `.sm/AGENTS.md` · `docs/cli/notify.md`
