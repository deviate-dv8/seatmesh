# seatmesh notify

```text
notify "<session>" "<check>" [--url <link>]
  notify info|md "<title>" --md <file>|--body "…" [--image path] [--url https://…]
  notify yesno "<title>" "<blurb>" [--md file|--body "…"] [--image path]
           [--target seat] [--yes-msg "…"] [--no-msg "…"]
  Operator eyes (beta) — prefer over asking chat for a toast.

  Pick one shape:
    eyes-only   notify "Deploy?" "Check staging" --url http://…
    Info only   notify info "Brief" --body "## Why\n\n…" [--url https://mdview.io/s/…]
                → local /act/card. [--url] = Open button (clickable).
                  Bare https:// in body also autolinks. [label](url) works.
                Mermaid → use preview (mdview.io), then notify info --url <share>.
    Info+Yes/No notify yesno "Ship?" "Need your call" --body "## Diff\n…" --target manager
                → toast with Info · Yes · No on one card.

  yesno args: <title>=decision name · <blurb>=short toast line
  Full recipe: seatmesh agent help notify
```

- CLI: `seatmesh notify --help`
- Agent: `seatmesh agent help notify`
- Catalog: [../COMMANDS.md#notify](../COMMANDS.md#notify)
