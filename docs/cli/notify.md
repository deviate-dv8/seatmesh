# seatmesh notify

```text
notify "<session>" "<check>" [--url <link>]
  notify info|md "<title>" --md <file>|--body "…" [--image path] [--url https://…]
  notify yesno "<title>" "<blurb>" [--md file|--body "…"] [--image path] [--url https://…]
           [--target seat] [--yes-msg "…"] [--no-msg "…"]
  notify run|cmd "<title>" --cmd "…" [--body "…"] [--cwd rel]
  Operator eyes (beta) — prefer over asking chat for a toast.

  Pick one shape:
    eyes-only   notify "Deploy?" "Check staging" --url http://…
    Info only   notify info "Brief" --body "## Why\n\n…" [--url https://mdview.io/s/…]
                → hub /act/card (:3190). [--url] = Open button (clickable).
                  Bare https:// in body also autolinks. [label](url) works.
                  Mermaid → local Info card renders ```mermaid (mermaid.js). Optional: preview (mdview.io) then --url share.
    Info+Yes/No notify yesno "Ship?" "Need your call" --body "## Diff\n…" [--url https://…]
                → toast buttons Info · Yes · No; card Open if --url.
                Agents may still put links in --body/--md; toast body stays blurb-only.
    Run cmd     notify run "Reload layout" --cmd "sm layout reload"
                → toast **Review** → card shows exact command → **Run** | **Decline**
                  Run never on the toast — only after you see the command on the card.

  yesno args: <title>=decision name · <blurb>=short toast line
  Full recipe: seatmesh agent help notify
```

- CLI: `seatmesh notify --help`
- Agent: `seatmesh agent help notify`
- Catalog: [../COMMANDS.md#notify](../COMMANDS.md#notify)
