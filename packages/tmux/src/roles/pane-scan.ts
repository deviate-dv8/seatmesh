import type { ProviderRegistry } from "@seat-mesh/core";
import { capturePaneSnapshot, listSessionPanes } from "../lib/snapshot.js";

export interface PaneScanRow {
  paneId: string;
  role: string;
  providerId: string | null;
  resumeId: string | null;
  phase: string;
  limitKind: string | null;
  slot: string;
  ports: string;
  window: string;
}

/**
 * Detect the live agent (provider/kind, composer phase) in every pane of a
 * session. Shared by `sm providers scan` (main.ts) and `sm sidebar` (TODO
 * 10.2b) — pulled out of main.ts's inline `providers scan` implementation so
 * both consume the exact same detection logic instead of two copies drifting.
 */
export function scanSessionPanes(reg: ProviderRegistry, session: string): PaneScanRow[] {
  const rows: PaneScanRow[] = [];
  for (const paneId of listSessionPanes(session)) {
    const snap = capturePaneSnapshot(paneId);
    if (!snap) continue;
    const prov = reg.detect(snap);
    const det = prov?.detect(snap);
    const state = prov?.composerState(snap) ?? { phase: "plain_shell" };
    rows.push({
      paneId,
      role: snap.options.mesh_role?.trim() || "plain",
      providerId: prov?.id ?? null,
      resumeId: det?.resumeId ?? null,
      phase: state.phase,
      limitKind: state.limitKind ?? null,
      slot: snap.options.mesh_slot || "-",
      ports: snap.options.mesh_ports || "-",
      window: snap.windowName,
    });
  }
  return rows;
}
