# Quick start

## One command (fresh or existing)

```bash
cd your-project
npx seatmesh start
```

That will:
1. `init` `.sm/` if missing
2. create the tmux session **or** attach if it already exists
3. leave the **manager pane as a terminal** with whoami / switch hints printed

Wedge recovery:

```bash
npx seatmesh session down   # kill session + inbox
npx seatmesh start          # clean create + attach
```

Pick among all meshes on this machine:

```bash
npx seatmesh sessions
```

## Manager pane (first paint)

```text
Run your agents HERE.
  1) seatmesh agent whoami
  2) switch CLI on this pane:
       seatmesh agent switch here agent      # Cursor
       seatmesh agent switch here claude
       seatmesh agent switch here opencode
```

## Cold start (automatic)

`bin/seatmesh` checks for a built CLI (`packages/cli/dist/main.js`) and
`node_modules`. If anything is missing or `package.json` is newer than dist, it
runs `npm install` and `npm run build` once, then starts Node.

## Init only (optional)

```bash
npx seatmesh init              # creates .sm/ only — prefer `start` instead
npx seatmesh profile show
```

`init` never deletes existing seat files under your configured `seats.root`.

## Existing checkout with `.sm/`

```bash
npx seatmesh start           # attach or create
npx seatmesh sessions        # global picker
npx seatmesh session status
npx seatmesh session down    # teardown
```

Inside a mesh pane: `seatmesh agent whoami`.
