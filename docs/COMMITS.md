# Commit messages (seat-mesh repo)

This repository is the **portable seatmesh engine**. History is public — keep it product-neutral.

## Forbidden in title or body

- Consumer names: `zsign`, `zsign-api`, `zsign-app`, `tmux-zsign`, `./sm.sh` as product branding
- Machine paths: `/home/...`, `tasks/seat-mesh/`, `Desktop/Work`, `.sm/` consumer trees
- Operator names in prose
- Agent trailers: `Co-authored-by`, `Generated with Cursor/Claude`, any tool byline

## Write instead

- **What changed in the engine** (daemon, cli, core, tmux package)
- **Why** (one line): e.g. "CONTINUE inject must not reference consumer TODO paths"

## Before push

```bash
git log -5 --oneline   # scan for forbidden words
npm run build && npm test
```

Optional hook: `scripts/check-commit-msg.sh .git/COMMIT_EDITMSG` (install via your own `prepare-commit-msg`).
