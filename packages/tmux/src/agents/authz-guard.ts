import { isCoordKind, seatKindFromId, type LoadedProfile } from "@seat-mesh/core";
import { tmux } from "../lib/tmux-run.js";
import { runWhoami } from "./whoami.js";

/**
 * Central UNAUTHORIZED guard (FRAMEWORK-QUEUE #1). Deny-by-default for the listed
 * command against the pane's own role. Prints the spec's exact format and exits 2 —
 * callers do not catch this, it terminates the process.
 *
 * `allowed` names SeatKinds (`manager`, `secretary`, `worker`, `mini`, `plain`), not
 * raw column ids — resolved through `seatKindFromId`/`layout.base.kinds` the same
 * way `requireCoordRole` already does (TODO 8.6). A custom persona column (e.g.
 * `layout.base.kinds: { lead: "manager" }`) authorizes correctly without also being
 * named `"manager"` — literal ids like `"manager"` still resolve to themselves by
 * default, so every existing profile's behavior is unchanged.
 */
export function requireRole(loaded: LoadedProfile, allowed: string[], cmdLabel: string): void {
  const w = whoamiHereOrOperator(loaded);
  if (!w) return; // cross-mesh / unknown pane → operator shell
  const kind = seatKindFromId(w.role, loaded.profile?.layout?.base.kinds);
  if (allowed.includes(kind)) return;
  console.error(
    `UNAUTHORIZED: ${cmdLabel} requires role=${allowed.join("|")} (you_are=${w.role})`,
  );
  console.error("hint: seatmesh --profile .sm agent");
  process.exit(2);
}

/** One tmux read — prefer over full whoami for hot paths (spawn --fast). */
export function paneRoleHere(): string | null {
  const pane = process.env.TMUX_PANE;
  if (!pane) return null;
  const r = tmux(["display-message", "-t", pane, "-p", "#{@mesh_role}"]);
  const role = r.out.trim();
  return role || null;
}

/** Coordinator tier — any manager-kind or secretary-kind column id. */
export function requireCoordRole(loaded: LoadedProfile, cmdLabel: string): void {
  if (!process.env.TMUX_PANE) return;
  // Hot path: @mesh_role only (no list-panes / whoami dump).
  const lite = paneRoleHere();
  if (lite && isCoordKind(lite, loaded.profile?.layout?.base.kinds)) return;
  const w = whoamiHereOrOperator(loaded);
  if (!w) return;
  if (isCoordKind(w.role, loaded.profile?.layout?.base.kinds)) return;
  console.error(
    `UNAUTHORIZED: ${cmdLabel} requires role=manager|secretary (you_are=${w.role})`,
  );
  console.error("hint: seatmesh --profile .sm agent");
  process.exit(2);
}

/**
 * Inbox lifecycle (start/stop/restart) — manager-1 + secretary only. Deliberately
 * narrower than `requireCoordRole`'s coord tier: manager-2/3 bouncing inbox on
 * first blip wedges the shared daemon for everyone, and `seatKindFromId` collapses
 * manager/manager-2/manager-3 to the same SeatKind (TODO 8.6 note: this specific
 * exclusion doesn't generalize under the current kind-mapping model without a way
 * to say "the primary manager column, not just any manager-tier column" — not
 * solved here, kept as literal-id matching on purpose, not an oversight).
 * Outside tmux (operator shell) is always allowed.
 * Cross-mesh: TMUX_PANE from another session (e.g. seatmesh pane + pia --profile)
 * is treated as operator — otherwise whoami throws "pane %N not found".
 */
export function requireInboxLifecycleRole(loaded: LoadedProfile, cmdLabel: string): void {
  if (!process.env.TMUX_PANE) return;
  const w = whoamiHereOrOperator(loaded);
  if (!w) return;
  if (w.role === "manager" || w.role === "secretary") return;
  console.error(
    `UNAUTHORIZED: ${cmdLabel} requires role=manager|secretary (you_are=${w.role})`,
  );
  console.error(
    "hint: ask manager or secretary to run inbox restart — do not bounce from manager-2/3",
  );
  process.exit(2);
}

/** null = treat as operator shell (no pane in this mesh). */
function whoamiHereOrOperator(loaded: LoadedProfile): ReturnType<typeof runWhoami> | null {
  try {
    return runWhoami(loaded, "here");
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/pane .+ not found/i.test(msg)) return null;
    throw e;
  }
}
