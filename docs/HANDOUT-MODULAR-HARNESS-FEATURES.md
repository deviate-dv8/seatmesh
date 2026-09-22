# Running harness features standalone (TODO 11.5)

Practical answer to "how do I run mds hosting / notifications without the rest of
the mesh" — not the full modular-architecture split (that's TODO 10.1, long-term,
not scoped). This documents what's **already** independently runnable today, and
draws the line at what still isn't.

## What's already standalone

`packages/web` (the operator hub, `:3190`) is its own AdonisJS app — it does not
need a live tmux session or an active per-mesh daemon to *start*. Verified by
reading the actual controllers, not assuming:

- **mds hosting** (`mds_controller.ts`) reads `.sm/mds/*.md` straight off disk via
  `loadProfile(profilePath)` for each mesh in `~/.config/seatmesh/sessions.json`
  (`listHubSessions({ probe: false })` — `probe: false` means it does **not** try
  to reach any daemon's `/health`). Viewing hosted markdown works with every mesh's
  daemon stopped.
- **Notification cards** (`act_cards_controller.ts`) are similar for *viewing* a
  card. The nuance: a card's **action buttons** (Yes / No / Run) work by delivering
  a peer message or running a command against a specific mesh's daemon when
  clicked — those need that mesh's daemon reachable *at click time*, not at hub
  startup. Read-only Info cards need nothing beyond the hub itself.

### Run it

```bash
sm web up [--open]      # starts packages/web detached, opens :3190
sm web status [--json]  # up? pid/log, daemon reachability per registered mesh
sm web down             # stop it
```

No mesh needs to be live for `web up` to work or for `mds`/Info cards to render.
`sm mds hosted host <file.md>` (write a file into `.sm/mds/` so the hub can see it)
and `sm notify info "<title>" --body "..."` (post an Info card) both only need
*this* mesh's `.sm/` on disk — not a running daemon — to produce something the hub
can display. The daemon is only in the loop for the interactive parts:
delivering a peer message when someone clicks Yes/No, or running a command for
`notify run`.

## What's not standalone yet

`packages/web` is still one AdonisJS app bundling the hub dashboard, mds hosting,
sessions/queues views, and the notification-card surface together — you get all of
it or none of it; there's no way to run "just mds hosting" as a smaller standalone
process today. That's exactly what TODO 10.1 (long-term, not scoped) is about:
splitting these into pieces usable standalone or composed with a different core
engine. This doc is the "how do I use what exists today" answer, not a preview of
that split.

## Quick reference

| Feature | Standalone today? | What it actually needs |
|---|---|---|
| mds hosting (view) | Yes | `sm web up`, files under `.sm/mds/` |
| Info notification cards (view) | Yes | `sm web up` |
| Yes/No/Run card actions (click) | No | That mesh's daemon reachable at click time |
| Everything else in the hub (sessions/queues/host-supervisor status) | No | Bundled into the same `packages/web` process |
