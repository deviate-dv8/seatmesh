---
name: seatmesh-cpe
description: >-
  Seatmesh OpenCode via CPE proxy (opencode-cpe.sh, HTTPS_PROXY :18887). Use when
  launching/resuming OC panes on CPE, fixing scrape wiping resumeCmd, or
  coordinating with zsign/PIA meshes that require proxied OpenCode.
---

# seatmesh-cpe

Keep OpenCode panes on the CPE wrapper — not bare `opencode --auto`.

## Launch

```bash
# workspace script (seatmesh / zsign)
scripts/opencode-cpe.sh [--session ses_…]
# sets HTTPS_PROXY=http://127.0.0.1:18887 (+ MESH_OC_WORKSPACE when needed)
```

Store full wrapper in `mesh-agents.json` → `resumeCmd`.

## Engine rules (do not regress)

1. **`resolveLaunchCmd`** — prefer `resume_cmd` / `resumeCmd` over `resume_id` → bare `buildAgentLaunchCmd`.
2. **`finalizePaneState` / scrape / save** — if preserved `resumeCmd` contains `opencode-cpe.sh`, keep it and only refresh `--session <id>`.
3. **Secretary scrape** — never null CPE `resumeCmd` just because `@mesh_oc_session` is empty.
4. After engine changes: rebuild `@seat-mesh/tmux` (+ daemon) and `seatmesh inbox restart` so auto-scrape loads the fix.

## Prove

```bash
# pin CPE resumeCmd, then:
seatmesh save
# resumeCmd must still contain opencode-cpe.sh after save AND ~60s auto-scrape
```

## Related

- `packages/tmux/src/session/save-session.ts` (`isOpenCodeCpeResumeCmd`, `injectOpenCodeSessionIntoCmd`)
- `packages/tmux/src/agents/agents-state.ts` (`resolveLaunchCmd`)
- skill `seatmesh-agent`
