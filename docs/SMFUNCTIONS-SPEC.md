# SM functions: the convention

**Scope:** every `seatmesh` command ("sm function") an agent types on session
`mesh` via `sm`. Governs new functions proposed in
`tasks/seatmesh/brainstorm/slot-N.md` and accepted into the aggregate
`tasks/seatmesh/docs/SM-FUNCTIONS.md`.

**Anchor:** `doc-inputs/patterns.md` --
"Single Command, Zero Decisions" and "Fewer CLI commands = better token efficiency".
A **sm function exists to collapse a command an agent would otherwise hand-craft**
(tmux send-keys, curl to `:3100`, `notify.sh` flag soup, seat-file edits, git
worktree scripts). If a function does not collapse a repeated, token-costly
hand-crafted shape, it does not belong.

**One-line rule:** one command, `verb+target`, idempotent, no flags by default,
verify baked in, ASCII only, token-light output.

---

## Rule 1: One command shape

A sm function has exactly one callable shape. No sub-sub-command drill-down
(`sm foo bar baz start`), no mode flags to reach the same routine goal.

- The filesystem / live tmux session is the source of truth, not an argument
  registry. `sm whoami` does not ask "which slot" - it reads `TMUX_PANE`.
- A function does one routine job. Two jobs that always run together are one
  function (e.g. "save layout + persist mesh-agents.json" is ONE `sm save`,
  not `save` + `persist`).
- If the function needs a target, the target is the second word, not a flag:
  `sm to-slot 3 "..."`, `sm seat manager`, `sm checkback 3f2a`.

## Rule 2: Idempotent

Running the function twice back to back is safe and a no-op the second time.

- Nothing is force-recreated, force-pushed, or duplicated unless that is the
  whole point of the function (and then it must be an explicit opt-in flag).
- State-changing functions check current state first (like `dc.sh up` diffing
  container configs instead of `down` then `up`).
- Writes that append (logs, ledgers, jsonl queues) dedupe or are the natural
  "same message already queued" case - a retried toast, a retried `to-master`,
  a retried checkback arm must not double-fire.
- Defaults must be the *safe* outcome even when the agent reading no docs.

## Rule 3: No flags by default

Zero decisions for the routine path. The default invocation `sm <verb-target>`
must be the correct one for the common case.

- A flag exists only to overrule a default, never to reach the routine goal.
  `./scripts/notify.sh --confirm` is a mode, not a routine path - acceptable as
  an opt-in, never the default.
- Deriving defaults: seat/slot from `TMUX_PANE`, profile dir from the session,
  durations from `mesh.config.yaml` (checkback 5m / renew 3m), payload from the
  message body itself. If the answer is knowable, compute it - do not ask.
- Every flag must be the rare override, and each extra flag is a defect unless
  justified (token multiplier is real: each choice point burns a re-derivation).

## Rule 4: Verify baked in

Every function proves the thing happened, or says it did not and exits non-zero.

- Success prints one short machine-ish line: `ok <fact>` (`ok id=3f2a expiresAt=...`).
- Failure prints `FAIL <reason>` to stderr and exits non-zero (2 = bad usage,
  1 = operation failed) - never a silent success.
- Where the effect is external (toast sent, docker touched, pane injected),
  verify postcondition; a dry assertion is not a verify.
- Idempotency is verified mechanically where it matters (e.g. `dc.sh up` twice
  -> identical state), per `patterns.md` "verify the claim, don't just assert it".

## Rule 5: ASCII only

`-` not em/en dash, `->` / `>` not arrows. No emojis, no box-drawing, no
non-ASCII in help text, doc, usage, or output. HTML entities in tooling
payloads (notify `&lt;a&gt;`) stay as the underlying script needs them - the
*function* surface is plain ASCII.

## Rule 6: Token-light output

The default output is the smallest thing that proves success - because the
output is ingested back into context on every call.

| Do | Don't |
|----|-------|
| `ok id=3f2a exp=17:02` | full JSON dump |
| `3 checkbacks: 2 active, 1 cancelled` | 40-line table unrequested |
| first 80 chars of a message only | echo the payload back verbatim |
| `--json` opt-in for full data | JSON as the default shape |

If output would exceed ~10 lines by default, it is a `tail`-style last-N or a
summary line; full content moves behind an opt-in flag. Help text is one line
or a tight table - not prose.

## Naming rule: verb + target

Every sm function is `sm <verb>-<target>` (or `sm <verb> <target>` where target
is an argument, not a noun glued as a mode).

- **Verbs:** `get|list|set|to|checkback|notify|snapshot|save|flush|remind|stack|health|seat`
  --- short, imperative, one word.
- **Targets:** `whoami|master|slot <N>|mini <N>|seat <id>|status|room|mesh-agents|checkbacks`.
- Same verb + different target = same underlying primitive. `to-slot 3`,
  `to-mini 2`, `to-master` are one shape (enqueue to peer/inbox) with a target
  argument - not three bespoke commands with different flag shapes.
- No `sm-*` sub-binary sprawl; no camelCase or dashes inside a target word.

---

## Acceptance checklist (every proposed sm function)

Pass = all boxes. Any no = reject the proposal until fixed, or drop it.

- [ ] **Collapses a real hand-crafted shape** - cites `file:line` of the
      repeated command it replaces (grep AGENTS.md, .agent/, scripts/, tasks/).
- [ ] **One command shape** - single `verb+target`, no mode flags to reach the
      routine goal, no sub-sub-command nesting.
- [ ] **Idempotent** - re-running is a safe no-op; appends/queues/writes
      dedupe or are naturally idempotent; default is the safe outcome.
- [ ] **No flags by default** - `sm <name>` works for the common case;
      every flag is a rare override with a justified token cost.
- [ ] **Verify baked in** - `ok ...` on success; `FAIL <reason>` + non-zero
      exit on failure; postcondition checked, not asserted.
- [ ] **ASCII only** - plain ASCII in help, output, and docs.
- [ ] **Token-light** - default output is one line / a tight summary; full data
      is behind `--json` or similar opt-in.
- [ ] **Named `verb+target`** - verb is imperative and one word; target is an
      argument or a single word, not a mode.

### Fast-fail reasons (do not accept)

- Output echoes the input back ("it worked" with zero evidence).
- Default path needs a flag to be correct.
- Not idempotent and not explicitly opt-in destructive.
- A second function with an overlapping purpose exists in another slot note
  (dup) - the aggregate (slot 8) picks the single winner.
- Token cost of the function exceeds the saved hand-crafting (new abstraction
  that only repackages; no collapse value).

---

## Example spec: `sm notify` (modeled fully)

Wraps the hand-crafted `./scripts/notify.sh` flag soup
(`--port` / `--url` / `--slot` / `--no-open` selection) into one shape. Collapse
value: agent stops choosing which notify variant and typing the flags; the
function derives the seat itself.

**Command shape**

```bash
sm notify "<session>" "<check>"            # single shape, both args positional
```

**Defaults (no flags)**

- Seat/port derived from `TMUX_PANE` via the live session border (slot N ->
  `slot-N`; main -> `main`; manager/secretary/mini -> their ids). No `--slot`.
- No auto-open (matches notify.sh convention; toast only).
- URL: none. `--url <url>` is the only flag, and it is a rare override (link
  to mdview / localhost when operator asked for a link).

**Idempotent**

Re-toasting the same session/check is a no-op state-wise: nothing is created,
queued, or mutated; the second toast is a harmless repeat (matches notify.sh
"do not spam" being the caller's duty, not a state the function owns). Optional
future: dedupe identical recent toasts before the 4s poll window.

**Verify baked in**

```text
ok toast slot-3 "Help Center clips"     # notify-send accepted, exit 0
FAIL no display (notify-send missing)   # exit 1, nothing fired silently
FAIL usage 2: need session text         # exit 2, bad args
```

Postcondition = `notify-send` return. Since `notify.sh` currently
`command -v notify-send >/dev/null || exit 0` (silent skip), the sm function
must flip that to a loud `FAIL` - a silent no-op is a verify violation.

**ASCII + token-light**

Output is exactly the `ok`/`FAIL` line above; title/body built by notify.sh
(ASCII enforced there). One line out, nothing echoed back.

**Subshape risk:** notify's `--confirm` (approve/reject buttons) does NOT spawn
a second function or a mode flag. It is out of scope unless operator asks - the
routine path is toast-and-continue.

---

## Relationships

| Doc | Role |
|-----|------|
| `tasks/seatmesh/brainstorm/slot-N.md` (1-5) | Candidate functions, evidence file:line |
| `tasks/seatmesh/brainstorm/slot-6.md` | Collision/test pass - scores vs this spec |
| `tasks/seatmesh/docs/SM-FUNCTIONS.md` | Aggregated accepted list (priority-ranked) |
| `doc-inputs/patterns.md` | North star: single command, zero decisions, fewer commands |
| `docs/ONE-PATH.md` | Runtime command picker for what exists today |

A function is only "spec'd" when it passes the checklist here
**and** appears in SM-FUNCTIONS.md with name, collapse value, default, and
verify. This doc is the gate on that list.