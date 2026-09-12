import { spawnSync } from "node:child_process";
import {
  profilePaths,
  loadRoleIndex,
  renderRoleIndex,
  validateRoleIndex,
  portsForSlot,
  type LoadedProfile,
} from "@seat-mesh/core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { buildWhoamiContextLines } from "./whoami-context.js";
import { printColdStart } from "../seats/cold-start.js";

export interface WhoamiResult {
  inTmux: boolean;
  paneId: string | null;
  session: string | null;
  window: string | null;
  role: string;
  slot: number | null;
  slotLabel: string | null;
  ports: string | null;
  profile: string;
  workspace: string;
}

/** @deprecated use WhoamiResult */
export type WhereResult = WhoamiResult;

function tmuxDisplay(pane: string, format: string): string | null {
  const r = spawnSync("tmux", ["display-message", "-t", pane, "-p", format], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim() || null;
}

function detectRole(pane: string): string {
  const role = tmuxDisplay(pane, "#{@mesh_role}") ?? "worker";
  return role || "worker";
}

function detectSlot(pane: string): number | null {
  const raw = tmuxDisplay(pane, "#{@mesh_slot}");
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function slotFromLabel(label: string): number | null {
  const n = Number.parseInt(label, 10);
  return Number.isFinite(n) ? n : null;
}

export function runWhoami(loaded: LoadedProfile, target?: string): WhoamiResult {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }
  const { paneId: pane, row } = resolved;
  const inTmux = Boolean(pane);

  let role = "worker";
  let slot: number | null = null;
  let slotLabel: string | null = null;
  let ports: string | null = null;
  let session: string | null = row.session;
  let window: string | null = row.window;

  if (pane) {
    role = row.role || detectRole(pane);
    slotLabel = row.slot || null;
    slot = slotFromLabel(row.slot) ?? detectSlot(pane);
    if (slot != null) {
      ports = portsForSlot(loaded.profile.ports.worker, slot);
    } else {
      ports = row.ports || tmuxDisplay(pane, "#{@mesh_ports}");
    }
    if (!session) session = tmuxDisplay(pane, "#{session_name}");
    if (!window) window = tmuxDisplay(pane, "#{window_name}");
  }

  return {
    inTmux,
    paneId: pane,
    session,
    window,
    role,
    slot,
    slotLabel,
    ports,
    profile: loaded.profile.name,
    workspace: loaded.workspace,
  };
}

/** @deprecated use runWhoami */
export const runWhere = runWhoami;

export function roleKindFromWhoami(role: string): string {
  if (role === "manager-mini") return "mini";
  if (role === "secretary") return "secretary";
  if (role === "manager-2") return "manager-2";
  if (role === "manager") return "manager";
  return "worker";
}

export function validateWhoamiRoleIndex(
  loaded: LoadedProfile,
  target?: string,
): { ok: boolean; missing: string[]; kind: string } {
  const w = runWhoami(loaded, target);
  const paths = profilePaths(loaded);
  const kind = roleKindFromWhoami(w.role);
  const index = loadRoleIndex(paths.rolesDir, kind);
  const result = validateRoleIndex(index, loaded.workspace);
  return { ...result, kind };
}

export function whoamiJson(loaded: LoadedProfile, target?: string): Record<string, unknown> {
  const w = runWhoami(loaded, target);
  const paths = profilePaths(loaded);
  const mini = w.paneId ? tmuxDisplay(w.paneId, "#{@mesh_mini}") ?? "" : "";
  const jobRole = w.paneId ? tmuxDisplay(w.paneId, "#{@mesh_job_role}") ?? "" : "";
  const kind = roleKindFromWhoami(w.role);
  const payload: Record<string, unknown> = {
    profile: w.profile,
    workspace: w.workspace,
    workspaceId: loaded.workspaceId,
    meshSession: loaded.sessionName,
    inTmux: w.inTmux,
    session: w.session,
    window: w.window,
    pane: w.paneId,
    youAre: w.role,
    kind,
    slot: w.slotLabel ?? w.slot,
    ports: w.ports,
    mini: mini || null,
    jobRole: jobRole || null,
    daemonPort: paths.daemonPort,
    dataRoot: paths.dataRoot,
    seatsRoot: paths.seatsRoot,
  };
  return payload;
}

export function whoamiJsonWithValidate(
  loaded: LoadedProfile,
  target?: string,
): Record<string, unknown> {
  const payload = whoamiJson(loaded, target);
  const validation = validateWhoamiRoleIndex(loaded, target);
  payload.roleIndex = {
    kind: validation.kind,
    ok: validation.ok,
    missing: validation.missing,
  };
  return payload;
}

export function printWhoami(loaded: LoadedProfile, target?: string): void {
  const w = runWhoami(loaded, target);
  const paths = profilePaths(loaded);

  const kind = roleKindFromWhoami(w.role);

  try {
    const index = loadRoleIndex(paths.rolesDir, kind);
    for (const line of index.banner ?? []) {
      console.log(line);
    }
  } catch {
    console.log("docs=docs/ONE-PATH.md | enqueue-only comms; daemon injects");
  }

  console.log(`profile=${w.profile}`);
  console.log(`workspace=${w.workspace}`);
  console.log(`workspace_id=${loaded.workspaceId}`);
  console.log(`mesh_session=${loaded.sessionName}`);
  console.log(`in_tmux=${w.inTmux}`);
  if (w.session) console.log(`session=${w.session}`);
  console.log(`daemon_port=${paths.daemonPort}`);
  console.log(`data_root=${paths.dataRoot}`);
  if (w.window) console.log(`window=${w.window}`);
  if (w.paneId) console.log(`pane=${w.paneId}`);
  console.log(`you_are=${w.role.toUpperCase()}`);
  if (w.slotLabel) console.log(`slot=${w.slotLabel}`);
  else if (w.slot != null) console.log(`slot=${w.slot}`);
  if (w.ports) console.log(`ports=${w.ports}`);
  console.log(`seats_root=${paths.seatsRoot}`);
  console.log("--- index ---");

  try {
    const index = loadRoleIndex(paths.rolesDir, kind);
    const jobRole = tmuxDisplay(w.paneId ?? "", "#{@mesh_job_role}") ?? "";
    console.log(
      renderRoleIndex(
        index,
        {
          jobRole,
          mini: tmuxDisplay(w.paneId ?? "", "#{@mesh_mini}") ?? "",
        },
        { skipBanner: true },
      ),
    );
  } catch (e) {
    console.log(`(no role index for ${kind}: ${(e as Error).message})`);
  }

  const mini = tmuxDisplay(w.paneId ?? "", "#{@mesh_mini}") ?? "";
  const jobRole = tmuxDisplay(w.paneId ?? "", "#{@mesh_job_role}") ?? "";

  for (const line of buildWhoamiContextLines(loaded, w, { mini, jobRole })) {
    console.log(line);
  }

  printColdStart(loaded, w, { mini: mini || null });
}

/** @deprecated use printWhoami */
export const printWhere = printWhoami;
