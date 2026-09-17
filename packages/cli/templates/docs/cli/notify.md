# seatmesh notify

```text
notify link|url|open "<title>" --url <https> [--check "…"]
  notify "<session>" "<check>" [--url <link>]
  notify info|md "<title>" --md <file>|--body "…" [--image path] [--url https://…]
  notify yesno "<title>" "<blurb>" [--md file|--body "…"] [--image path] [--url https://…]
           [--target seat] [--yes-msg "…"] [--no-msg "…"]
  Operator eyes (beta) — prefer over asking chat for a toast.

  Pick one shape:
    link-only   notify link "Staging" --url http://127.0.0.1:5080
                → toast Open button → URL (no Info card). Same: notify "…" "…" --url
    Info only   notify info "Brief" --body "## Why\n\n…" [--url https://mdview.io/s/…]
                → hub /act/card (:3190). [--url] = Open button on card.
                  Bare https:// in body also autolinks. [label](url) works.
                Mermaid → local Info card renders ```mermaid (mermaid.js). Optional: preview (mdview.io) then --url share.
    Info+Yes/No notify yesno "Ship?" "Need your call" --body "## Diff\n…" [--url https://…]
                → toast buttons Info · Yes · No; card Open if --url.
                Agents may still put links in --body/--md; toast body stays blurb-only.

  yesno args: <title>=decision name · <blurb>=short toast line
  Full recipe: seatmesh agent help notify
```

- CLI: `seatmesh notify --help`
- Agent: `seatmesh agent help notify`
- Catalog: [../COMMANDS.md#notify](../COMMANDS.md#notify)
