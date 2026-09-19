# Example: adding a custom CLI kind (Kimi)

Worked example for the "Agent CLI: three layers" model in
[ARCHITECTURE.md](ARCHITECTURE.md) — using Kimi as the running example since it's
also the one named in `TODO.md` P6.1/P6.7. The CLI invocation shown here
(`kimi-cli`, `--resume`) is illustrative — swap in whatever the real binary and
flags are; the shape of the two paths below does not change.

Two ways to get a new CLI family on a pane, in increasing order of capability:

## Path 1 — launch-only, yaml only (no code, no fork)

Add it to your profile's `agents.kinds` overlay — nothing else. A bare `launch:`
with no `provider`/`extends` is silently dropped by the kind resolver (it needs one
or the other to inherit a provider id from), so extend `empty` — the placeholder
"no detect capability" base — and override just `launch`:

```yaml
# .sm/mesh.config.yaml
agents:
  kinds:
    kimi:
      extends: empty
      launch:
        command: kimi-cli   # or { builtin: ... } if it matches an existing family
```

```bash
seatmesh --profile .sm switch slot-1 kimi
seatmesh --profile .sm kind show kimi   # confirm it resolved (P6.2) — provider: empty, launch: {command: kimi-cli}
```

This works **today, with zero seatmesh code changes** — `switch`/`launch`/`set`/`tag`
all go through `kindsForLoaded` → `buildKindLaunchCmd`, which only needs a resolvable
`launch` entry (see the "Agent CLI: three layers" table in ARCHITECTURE.md, "Config-
only?" column — layer 1 is "mostly" config-only for exactly this reason).

**The catch:** the daemon's inbox has no `AgentProvider` for `kimi`, so it can't
detect the pane, read its composer state, or inject PEER/queue mail into it. The
pane runs the CLI, but as far as `seatmesh --profile .sm inbox`/`peer`/`room fanout`
are concerned it's plain shell — mail queues as backlog and never delivers,
`providers scan` won't see it live. Fine for solo/manual use; not fine for an agent
you want the mesh to talk to.

## Path 2 — full provider (inject works)

Needs a real `AgentProvider` — `kindBase()` for the kind resolver, plus `detect`/
`composerState`/`injectPlan`/`sessionId` so the daemon can actually drive the pane.
Today (before P6.1 lands) that means a file in `packages/providers/src/` and a line
in `builtin.ts` — a real change to seatmesh itself, not something a consumer project
can drop in on its own yet. Once P6.1 (`.sm/providers/` drop-in loader) ships, the
same file drops into a project's `.sm/providers/kimi.js` instead — true "no fork."

Smallest real provider, modeled on `packages/providers/src/kiro.ts` (same shape —
single-turn CLI, UUID-style resume id, no special composer chrome to parse):

```ts
// packages/providers/src/kimi.ts
import type { AgentProvider, Detection, InjectPlan, PaneSnapshot } from "@seat-mesh/core";
import {
  cmdlines,
  composerFromCapture,
  defaultComposerReady,
  extractUuid,
  matchAny,
  modelFromCmdlines,
  scrapePromptTurnGeneric,
  sessionIdFromDetection,
} from "./shared.js";

const PATTERNS = [/kimi-cli/];

export const kimiProvider: AgentProvider = {
  id: "kimi",

  detect(pane: PaneSnapshot): Detection | null {
    const lines = cmdlines(pane);
    if (!matchAny(lines, PATTERNS)) return null;
    let resumeId: string | undefined;
    for (const line of lines) {
      resumeId = extractUuid(line, ["--resume"]);
      if (resumeId) break;
    }
    return { providerId: "kimi", resumeId };
  },

  composerState(pane: PaneSnapshot) {
    return composerFromCapture(pane, "kimi"); // add a `kimi` branch in shared.ts if its
  },                                          // chrome/busy/limit text differs from the default

  composerReady(pane: PaneSnapshot) {
    return defaultComposerReady(pane, "kimi");
  },

  injectPlan(_pane: PaneSnapshot): InjectPlan {
    return { prefix: "", useBracketedPaste: true, enterDelayMs: 280, flushEscFirst: true };
  },

  sessionId(_pane, detection) {
    return sessionIdFromDetection(detection);
  },

  modelId(pane) {
    return modelFromCmdlines(cmdlines(pane), "kimi");
  },

  scrapePromptTurn(pane) {
    return scrapePromptTurnGeneric(pane);
  },

  kindBase() {
    return {
      provider: "kimi",
      launch: { command: "kimi-cli" },
    };
  },
};
```

Register it:

```ts
// packages/providers/src/builtin.ts
import { kimiProvider } from "./kimi.js";
// … add kimiProvider to the registry array alongside kiroProvider, claudeProvider, etc.
```

Add `kimi` to the profile's `providers:` list (enables detect/inject — see
[CONFIG.md](CONFIG.md)'s provider-enable table) — the `agents.kinds` overlay from
Path 1 becomes optional once `kindBase()` supplies the default launch command.

Per the checklist in ARCHITECTURE.md: also add a detect/kind-resolve/launch smoke
test (`packages/providers/src/kimi.test.ts`, mirroring `kiro.ts`'s pattern) before
calling this done.
