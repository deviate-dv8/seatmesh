import { spawnSync } from "node:child_process";
import path from "node:path";
import { seatMeshPackageRoot, type LoadedProfile } from "seat-mesh-core";
import { applyMeshSessionBorders } from "./borders.js";
import { labelMeshSession } from "./labels.js";
import { ensureMeshInbox } from "../comms/inbox-bridge.js";
import { assertRelayoutSafe } from "./layout-guard.js";
import { submitPaneOp } from "../ops/pane-ops-client.js";
import { relayoutMeshSession } from "./session.js";
import { activeSessionWindows } from "./session-windows.js";
import { tmuxHasSession } from "../lib/tmux-run.js";
import { ensureSeatFiles } from "../seats/seat-init.js";
import { ensureBaseLayout } from "./base-layout.js";
import {
  logCoordSyncResults,
  syncCoordClisFromProfile,
} from "../agents/coord-cli-sync.js";

export interface ReloadOptions {
  /** Re-run equal 3x2 / 4x2 grid (disruptive — kills extra panes). */
  layout?: boolean;
  /** With layout: skip minis lead swap (profile `layout.minis.leads` applied by default). */
  skipMinisLeads?: boolean;
  /** With layout: kill active panes when shrinking (default: refuse). */
  force?: boolean;
  /** Skip npm build (labels-only). */
  skipBuild?: boolean;
}

/**
 * Lazy reload: rebuild seat-mesh CLI, refresh labels/borders — no session kill.
 * `bin/seat-mesh` also auto-builds on stale dist; this is the explicit "keep hacking" path.
 */
export function reloadMesh(loaded: LoadedProfile, opts: ReloadOptions = {}): void {
  const session = loaded.sessionName;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");
  if (!tmuxHasSession(session)) {
    throw new Error(`session '${session}' missing — ./sm.sh session up`);
  }

  if (!opts.skipBuild) {
    const seatMeshRoot = seatMeshPackageRoot();
    const r = spawnSync("npm", ["run", "build"], {
      cwd: seatMeshRoot,
      stdio: "inherit",
    });
    if (r.status !== 0) {
      throw new Error(`npm run build failed in ${seatMeshRoot} (exit ${r.status ?? 1})`);
    }
  }

  if (opts.layout) {
    submitPaneOp(
      loaded,
      "relayout",
      { skipMinisLeads: opts.skipMinisLeads, force: opts.force ?? false },
      "reload --layout",
      () => {
        assertRelayoutSafe(loaded, opts.force ?? false);
        relayoutMeshSession(loaded, {
          skipMinisLeads: opts.skipMinisLeads,
          force: opts.force,
        });
      },
    );
    return;
  }

  ensureSeatFiles(loaded);
  ensureBaseLayout(loaded, session);
  labelMeshSession(loaded, session);
  applyMeshSessionBorders(session, activeSessionWindows(loaded, session));
  ensureMeshInbox(loaded, { quiet: true });
  logCoordSyncResults(syncCoordClisFromProfile(loaded, { trigger: "reload" }));
}
