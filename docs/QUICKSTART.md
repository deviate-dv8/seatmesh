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

## Put an agent on a pane (human)

`assign` = give **work**. `switch` = put a **CLI** on an empty terminal.

```bash
npx seatmesh help human          # cheat sheet

npx seatmesh switch slot-1 opencode
npx seatmesh switch secretary claude
npx seatmesh switch here agent   # this pane → Cursor agent
npx seatmesh switch mini-1 empty # back to shell

npx seatmesh kind slot-1         # agent vs terminal?
npx seatmesh launch slot-1       # resume configured CLI (no type pick)
```

## Manager pane (first paint)

```text
Run your agents HERE.
  1) seatmesh agent whoami
  2) switch CLI on this pane:
       seatmesh switch here agent      # Cursor
       seatmesh switch here claude
       seatmesh switch here opencode
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
