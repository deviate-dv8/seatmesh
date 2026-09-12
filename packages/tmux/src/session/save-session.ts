import fs from "node:fs";
import path from "node:path";
import {
  MeshAgentsSchema,
  type CliType,
  type LoadedProfile,
  type MeshAgents,
  type MiniSlot,
  type SavedLayout,
  type WorkerSlot,
  buildResolvedPaths,
  mergeMeshAgentsIntoProfile,
  normalizeMinisLeads,
  portsForSlot,
} from "seat-mesh-core";
import type { ProviderRegistry } from "seat-mesh-core";
import {
  extractOpenCodeSession,
  guessSecretaryOpenCodeSession,
  normalizeOpenCodeSessionId,
} from "seat-mesh-providers";
import { buildAgentLaunchCmd } from "../agents/agent-builder.js";
import { loadMeshAgents } from "../agents/agents-state.js";
import { loadMinisState } from "../roles/minis.js";
import {
  coordPaneForRole,
  listMeshMinis,
  listMeshWorkers,
  meshManagerPane,
  meshSecretaryPane,
} from "../lib/pane-meta.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { tmux, tmuxHasSession } from "../lib/tmux-run.js";
import { listWindowPaneIds } from "./window-panes.js";

function cliTypeFromProvider(providerId: string | undefined): CliType {
  if (!providerId) return "empty";
  if (providerId === "cursor-agent") return "agent";
  if (
    providerId === "opencode" ||
    providerId === "claude" ||
    providerId === "kiro" ||
    providerId === "empty"
  ) {
    return providerId;
  }
  return "empty";
}

interface PreservedSlot {
  type?: CliType;
  resumeId?: string | null;
  resumeCmd?: string | null;
}

function finalizePaneState(
  workspace: string,
  live: { type: CliType; resumeId: string | null },
  preserved?: PreservedSlot,
): { type: CliType; resumeId: string | null; resumeCmd: string | null } {
  let type = live.type;
  let resumeId = live.resumeId;

  let preservedId =
    preserved?.resumeId ??
    (preserved?.resumeCmd ? extractOpenCodeSession(preserved.resumeCmd) : undefined);
  if (type === "opencode" || preserved?.type === "opencode") {
    preservedId = normalizeOpenCodeSessionId(preservedId);
    if (resumeId) resumeId = normalizeOpenCodeSessionId(resumeId) ?? null;
  }

  if (preservedId) {
    if (type === "empty" && preserved?.type && preserved.type !== "empty") {
      type = preserved.type;
    }
    if (!resumeId) resumeId = preservedId;
  }

  const harnessType = type === "agent" ? "agent" : type;
  const resumeCmd =
    type === "empty" ? null : buildAgentLaunchCmd(harnessType, workspace, resumeId);
  return { type, resumeId, resumeCmd };
}

function stampOpenCodeSessionOnPane(paneId: string, resumeId: string | null): void {
  const sid = normalizeOpenCodeSessionId(resumeId);
  if (!sid) {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", ""]);
    return;
  }
  tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", sid]);
}

function detectPane(
  paneId: string,
  registry: ProviderRegistry,
  workspace: string,
  preserved?: PreservedSlot,
): { type: CliType; resumeId: string | null; resumeCmd: string | null } {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) {
    const out = finalizePaneState(workspace, { type: "empty", resumeId: null }, preserved);
    if (out.resumeId) stampOpenCodeSessionOnPane(paneId, out.resumeId);
    return out;
  }
  const prov = registry.detect(snap);
  if (!prov) {
    const out = finalizePaneState(workspace, { type: "empty", resumeId: null }, preserved);
    if (out.resumeId) stampOpenCodeSessionOnPane(paneId, out.resumeId);
    return out;
  }
  const det = prov.detect(snap);
  const type = cliTypeFromProvider(prov.id);
  const resumeId = det?.resumeId ?? null;
  const out = finalizePaneState(workspace, { type, resumeId }, preserved);
  if (out.resumeId) stampOpenCodeSessionOnPane(paneId, out.resumeId);
  return out;
}

/** Apply mesh-agents.json layout overrides onto a loaded profile. */
export function applyMeshState(loaded: LoadedProfile): LoadedProfile {
  const rel = loaded.profile.state.meshAgentsJson;
  const mesh = loadMeshAgents(loaded.workspace, rel);
  return {
    ...loaded,
    profile: mergeMeshAgentsIntoProfile(loaded.profile, mesh),
  };
}

/** Patch mesh-agents.json `layout` (extendable — e.g. base.managerStack). */
export function persistSavedLayout(
  loaded: LoadedProfile,
  layoutPatch: SavedLayout,
): LoadedProfile {
  const rel = loaded.profile.state.meshAgentsJson;
  const existing = loadMeshAgents(loaded.workspace, rel);
  const base = existing ?? {
    schemaVersion: 1 as const,
    session: loaded.sessionName,
    workdir: loaded.workspace,
    workers: [],
    minis: [],
    conventions: {
      secretaryDefaultCli: "opencode" as const,
      miniDefaultCli: "opencode" as const,
      launchSkipsEmpty: true,
    },
  };
  const next = MeshAgentsSchema.parse({
    ...base,
    layout: {
      ...base.layout,
      ...layoutPatch,
      base: { ...base.layout?.base, ...layoutPatch.base },
    },
    updatedAt: new Date().toISOString(),
  });
  saveMeshAgentsFile(loaded.workspace, rel, next);
  return applyMeshState(loaded);
}

export function scrapeMeshAgents(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
): MeshAgents {
  const session = loaded.sessionName;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");
  if (!tmuxHasSession(session)) {
    throw new Error(`session '${session}' does not exist — ./sm.sh session up`);
  }

  const minisCfg = layout.minis;
  const minisLayout = {
    grid: minisCfg.grid,
    max: minisCfg.max,
    leads: normalizeMinisLeads(minisCfg.leads),
  };

  const miniState = loadMinisState(loaded);
  const existing = loadMeshAgents(loaded.workspace, loaded.profile.state.meshAgentsJson);
  const workerMeta = listMeshWorkers(session, layout.workers.window);
  const miniMeta = listMeshMinis(session, layout.minis.window);

  const workers: WorkerSlot[] = [];
  for (let slot = 1; slot <= loaded.profile.session.workerCount; slot++) {
    const paneId = workerMeta.find((w) => Number(w.slot) === slot)?.paneId;
    if (!paneId) continue;
    const prev = existing?.workers.find((w) => w.slot === slot);
    const det = detectPane(paneId, registry, loaded.workspace, prev);
    workers.push({
      type: det.type,
      slot,
      name: `worker-${slot}`,
      ports: portsForSlot(loaded.profile.ports.worker, slot),
      resumeId: det.resumeId,
      resumeCmd: det.resumeCmd,
      paneIndex: slot - 1,
    });
  }

  const minis: MiniSlot[] = [];
  for (let n = 1; n <= minisLayout.max; n++) {
    const paneId = miniMeta.find((m) => Number(m.mini) === n)?.paneId;
    if (!paneId) continue;
    const prev = existing?.minis.find((m) => m.mini === n);
    const det = detectPane(paneId, registry, loaded.workspace, prev);
    const row = miniState.minis[String(n)];
    minis.push({
      type: det.type,
      mini: n,
      name: `mini-${n}`,
      role: row?.job_role,
      task: row?.task,
      resumeId: det.resumeId,
      resumeCmd: det.resumeCmd,
      paneIndex: n - 1,
    });
  }

  const mgrPane = meshManagerPane(session, layout.base.window);
  const mgr2Pane = coordPaneForRole(session, layout.base.window, "manager-2");
  const secPane = meshSecretaryPane(session, layout.base.window);
  const manager = mgrPane
    ? (() => {
        const det = detectPane(mgrPane, registry, loaded.workspace, existing?.manager);
        return {
          type: det.type,
          name: "manager",
          resumeId: det.resumeId,
          resumeCmd: det.resumeCmd,
        };
      })()
    : undefined;

  const manager2 = mgr2Pane
    ? (() => {
        const det = detectPane(mgr2Pane, registry, loaded.workspace, existing?.manager2);
        return {
          type: det.type,
          name: "manager-2",
          resumeId: det.resumeId,
          resumeCmd: det.resumeCmd,
        };
      })()
    : undefined;

  const secretary = secPane
    ? (() => {
        let preserved: PreservedSlot | undefined = existing?.secretary;
        const preservedSid = normalizeOpenCodeSessionId(preserved?.resumeId);
        if (!preservedSid) {
          const guess = guessSecretaryOpenCodeSession(loaded.workspace);
          preserved = {
            ...preserved,
            type: "opencode",
            resumeId: guess ?? null,
          };
        } else {
          preserved = { ...preserved, type: "opencode", resumeId: preservedSid };
        }
        const det = detectPane(secPane, registry, loaded.workspace, preserved);
        return {
          type: det.type === "empty" ? "opencode" : det.type,
          wanted: true,
          resumeId: det.resumeId,
          resumeCmd: det.resumeCmd,
          ports: "secretary",
          paneIndex: 1,
        };
      })()
    : undefined;

  return MeshAgentsSchema.parse({
    schemaVersion: 1,
    session,
    workdir: loaded.workspace,
    manager,
    manager2,
    secretary,
    workers,
    minis,
    layout: {
      nvim: {
        enabled: listWindowPaneIds(session, layout.nvim.window).length > 0,
      },
      workers: {
        enabled: workerMeta.length > 0,
        grid: "3x2",
        slots: loaded.profile.session.workerCount,
      },
      minis: {
        enabled: miniMeta.length > 0,
        grid: minisLayout.grid,
        max: minisLayout.max,
        leads: minisLayout.leads,
      },
    },
    conventions: existing?.conventions ?? {
      secretaryDefaultCli: "opencode",
      miniDefaultCli: "opencode",
      launchSkipsEmpty: true,
    },
    updatedAt: new Date().toISOString(),
  });
}

export function saveMeshAgentsFile(workspace: string, relPath: string, data: MeshAgents): string {
  const file = path.join(workspace, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return file;
}

/** Scrape live mesh session -> mesh-agents.json (layout + slot CLI state). */
export function saveMeshSession(loaded: LoadedProfile, registry: ProviderRegistry): string {
  const file = buildResolvedPaths(loaded).meshAgentsJson;
  const data = scrapeMeshAgents(loaded, registry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return file;
}
