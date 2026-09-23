# TODO-prereq — design prerequisites for main TODO.md items

Cross-cutting design questions that block or shape a P-numbered item in
[TODO.md](TODO.md) but aren't themselves scoped work yet. Referenced from
TODO.md by id (e.g. "see TODO-prereq.md#optional-session-relation"); each
entry here should link back to the TODO.md item(s) it feeds.

---

## optional-session-relation

**Blocks:** [TODO.md P10](TODO.md) (modular architecture / sidebar UI vision)
**Voiced:** 2026-09-23, operator, re: whether a herdr-managed agent (a
different, separate AI-harness tool the operator also runs) can use seatmesh
modules like `notify`.

**The principle:** seatmesh modules should be independent by default. A
caller outside seatmesh's own tmux/session — another harness's agent, a
script, anything — should be able to use a module (notify, mds hosting, etc.)
without that module hard-requiring a full seatmesh session/profile to exist
first. The relation to a mesh/session should be *optional tagged metadata*
the caller can leave empty (fully standalone) or explicitly fill in as
"external" (related to a mesh, but not one of its own panes) — not a
structural dependency baked into the call path.

**Concrete evidence this isn't true today**, found by reading the actual
code (`packages/cli/src/commands/notify-cli.ts`): every `notify` subcommand
action calls `getLoaded()` unconditionally, before anything else. That means
even `notify desktop` — whose own description says "no tmux whoami…
cross-platform via node-notifier", i.e. explicitly designed not to need a
live pane — still hard-fails if no resolvable `.sm/mesh.config.yaml` exists
(via cwd walk-up or `--profile`). There's no path to "just send a toast,
unrelated to any mesh."

Breaking down what each `notify` subcommand actually needs today (not
assumed — read `packages/tmux/src/comms/notify-operator.ts`):
- `notify desktop` — needs a loaded profile only for `loaded.workspace`
  (passed to `sendDesktopToastSync` for per-workspace mute config / context).
  Delivery is OS-native (`osascript`/`powershell`/`notify-send`), no daemon.
  **Best candidate to decouple first** — the profile requirement here is
  incidental (a workspace path for config lookup), not load-bearing.
- `notify` (plain, session+check toast) — same profile requirement, but pane
  identity is *already* best-effort: `runWhoami(loaded, "here")` is wrapped
  in try/catch, falling back to `seatDisplay = "operator"` on failure. So the
  pane-optionality pattern this principle wants already exists one level up
  (session-optionality) — just needs the same treatment.
- `notify yesno` / `notify info` / `notify run` — genuinely need more: they
  register a card and route delivery through that mesh's own daemon/inbox
  ("inbox down" is a real failure mode). Decoupling these fully would mean
  either a session-independent card/delivery path (bigger change) or keeping
  these three mesh-attached while `desktop`/plain `notify` go standalone.

**Scope note:** calling `getLoaded()` unconditionally at the top of every
action isn't unique to `notify-cli.ts` — the same shape repeats across
essentially every CLI command module. So "make the session relation optional"
is one refactor pattern applied module-by-module, not a single localized fix.
Worth doing as one deliberate pass (decide the metadata shape once, apply it
consistently) rather than ad hoc per-command changes that could each land on
a different convention.

**Not scoped yet** — this is a design prerequisite, not an implementation
plan. Needs, before any code: (1) what the optional relation metadata
actually looks like (a flag? a nullable profile path? an explicit
`external: true`?), (2) which modules get it first (notify's `desktop`/plain
forms are the obvious pilot, per the breakdown above), (3) whether
`yesno`/`info`/`run`-style daemon-routed features get a session-independent
delivery path too, or stay intentionally mesh-attached.

See also: [[project_modular_architecture_vision]] (memory) for the broader
"herdr comparison" context this came from.
