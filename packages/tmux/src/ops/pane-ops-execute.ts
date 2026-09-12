import type { LoadedProfile, PaneOpRow } from "seat-mesh-core";
import { createRegistryForProfile } from "seat-mesh-providers";
import { launchSession, printLaunchResults } from "../agents/launch.js";
import { assertRelayoutSafe, printRelayoutPlan } from "../session/layout-guard.js";
import {
  miniSpawn,
  miniSpawnAll,
  loadMiniManifest,
} from "../roles/minis.js";
import { relayoutMeshSession } from "../session/session.js";
import { secretaryMeshWatch } from "../roles/secretary.js";
import { runSwitch } from "../agents/switch.js";

export interface PaneOpExecuteResult {
  ok: boolean;
  error?: string;
}

/** Run one pane-op (daemon-only — no re-queue). */
export function executePaneOp(loaded: LoadedProfile, row: PaneOpRow): PaneOpExecuteResult {
  const registry = createRegistryForProfile(loaded.profile);
  try {
    switch (row.kind) {
      case "launch": {
        const targets = row.payload.targets as string[] | undefined;
        const results = launchSession(loaded, { targets });
        printLaunchResults(results);
        if (results.some((r) => r.status === "failed")) {
          return { ok: false, error: "one or more launch targets failed" };
        }
        break;
      }
      case "switch": {
        runSwitch(
          loaded,
          registry,
          String(row.payload.target ?? ""),
          String(row.payload.newType ?? ""),
          {
            fresh: Boolean(row.payload.fresh),
            resumeId: row.payload.resumeId as string | undefined,
            reason: row.payload.reason as string | undefined,
          },
        );
        break;
      }
      case "relayout": {
        const force = Boolean(row.payload.force);
        const dryRun = Boolean(row.payload.dryRun);
        if (dryRun) {
          printRelayoutPlan(loaded);
          break;
        }
        assertRelayoutSafe(loaded, force);
        relayoutMeshSession(loaded, {
          skipMinisLeads: Boolean(row.payload.skipMinisLeads),
          force,
        });
        break;
      }
      case "mini-spawn": {
        miniSpawn(
          loaded,
          registry,
          Number(row.payload.n),
          String(row.payload.role ?? "helper"),
          String(row.payload.task ?? ""),
          {
            viaSecretary: row.payload.viaSecretary !== false,
            hub: row.payload.hub as string | undefined,
          },
        );
        break;
      }
      case "mini-spawn-all": {
        const manifest = row.payload.useManifest
          ? loadMiniManifest(loaded)
          : undefined;
        miniSpawnAll(loaded, registry, manifest);
        break;
      }
      case "secretary-dispatch": {
        miniSpawnAll(loaded, registry);
        secretaryMeshWatch(loaded, "on", String(row.payload.watchInterval ?? "5m"));
        console.log("OK: secretary dispatched minis + mesh-watch ON");
        break;
      }
      default:
        return { ok: false, error: `unknown pane-op kind: ${row.kind}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
