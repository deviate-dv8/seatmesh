import fs from "node:fs";
import path from "node:path";
import {
  MeshAgentsSchema,
  type CliType,
  type LoadedProfile,
  type ManagerSlot,
  type MeshAgents,
  type MiniSlot,
  type SavedLayout,
  type SecretarySlot,
  type WorkerSlot,
  buildResolvedPaths,
  baseColumnIds,
  mergeMeshAgentsIntoProfile,
  primaryManagerColumn,
  primarySecretaryColumn,
  normalizeMinisLeads,
  portsForSlot,
} from "@seat-mesh/core";
import type { ProviderRegistry } from "@seat-mesh/core";
import {
  extractOpenCodeSession,
  normalizeOpenCodeSessionId,
} from "@seat-mesh/providers";
import { buildAgentLaunchCmd } from "../agents/agent-builder.js";
import {
  loadMeshAgentsAt,
  loadMeshAgentsForProfile,
  meshAgentsJsonPath,
} from "../agents/agents-state.js";
import { seatmeshCmd } from "@seat-mesh/core";
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
import { runWhoami } from "../agents/whoami.js";

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
  const mesh = loadMeshAgentsForProfile(loaded);
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
  const meshFile = meshAgentsJsonPath(loaded);
  const existing = loadMeshAgentsAt(meshFile);
  const base = existing ?? {
    schemaVersion: 1 as const,
    session: loaded.sessionName,
    workdir: loaded.workspace,
    workers: [],
    minis: [],
    layout: undefined,
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
  saveMeshAgentsFile(meshFile, next);
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
    throw new Error(`session '${session}' does not exist — ${seatmeshCmd("session up")}`);
  }

  const minisCfg = layout.minis;
  const minisLayout = {
    grid: minisCfg.grid,
    max: minisCfg.max,
    leads: normalizeMinisLeads(minisCfg.leads),
  };

  const miniState = loadMinisState(loaded);
  const existing = loadMeshAgentsForProfile(loaded);
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

  const extraColIds = baseColumnIds(layout).filter(
    (id) =>
      id !== primaryManagerColumn(layout) && id !== primarySecretaryColumn(layout),
  );
  const coords: Record<string, ManagerSlot> = { ...(existing?.coords ?? {}) };
  for (const id of extraColIds) {
    const pane = coordPaneForRole(session, layout.base.window, id);
    if (!pane) {
      delete coords[id];
      continue;
    }
    const det = detectPane(pane, registry, loaded.workspace, existing?.coords?.[id]);
    coords[id] = {
      type: det.type,
      name: id,
      resumeId: det.resumeId,
      resumeCmd: det.resumeCmd,
    };
  }

  let secretary: SecretarySlot | undefined;
  if (secPane) {
    const paneSid = normalizeOpenCodeSessionId(
      tmux(["display-message", "-t", secPane, "-p", "#{@mesh_oc_session}"]).out,
    );
    let preserved: PreservedSlot | undefined = existing?.secretary;
    if (!paneSid) {
      preserved = { ...preserved, type: "opencode", resumeId: null, resumeCmd: null };
    } else {
      preserved = { ...preserved, type: "opencode", resumeId: paneSid };
    }
    const det = detectPane(secPane, registry, loaded.workspace, preserved);
    secretary = {
      type: det.type === "empty" ? "opencode" : det.type,
      wanted: true,
      resumeId: det.resumeId,
      resumeCmd: det.resumeCmd,
      ports: "secretary",
      paneIndex: 1,
    };
  } else if (existing?.secretary) {
    secretary = {
      ...existing.secretary,
      wanted: existing.secretary.wanted ?? true,
      type: existing.secretary.type ?? "opencode",
      ports: existing.secretary.ports ?? "secretary",
    };
  }

  return MeshAgentsSchema.parse({
    schemaVersion: 1,
    session,
    workdir: loaded.workspace,
    manager,
    coords: Object.keys(coords).length ? coords : undefined,
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

/** Write mesh-agents.json at an absolute path (atomic rename). */
export function saveMeshAgentsFile(file: string, data: MeshAgents): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = JSON.stringify(data, null, 2) + "\n";
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, file);
  return file;
}

/** Refuse save/auto from a mini pane (harness parity). */
export function assertSaveAllowed(loaded: LoadedProfile): void {
  if (!process.env.TMUX_PANE) return;
  let w;
  try {
    w = runWhoami(loaded);
  } catch {
    return;
  }
  const minisWin = loaded.profile.layout?.minis.window;
  if (
    w.role === "manager-mini" ||
    (minisWin && w.window === minisWin) ||
    w.role === "mini"
  ) {
    throw new Error(
      "refused: mini pane cannot run save/auto (use manager, worker, secretary, or a shell outside tmux)",
    );
  }
}

/** Human-readable post-save summary (harness print_auto_summary parity). */
export function formatSaveSummary(data: MeshAgents, file: string): string {
  const lines: string[] = ["--- summary ---"];
  lines.push(`session: ${data.session}`);
  if (data.updatedAt) lines.push(`updated: ${data.updatedAt}`);
  if (data.manager) {
    const m = data.manager;
    lines.push(`manager: ${m.type}${m.resumeId ? " resume" : ""}`);
  }
  for (const [id, slot] of Object.entries(data.coords ?? {})) {
    lines.push(`${id}: ${slot.type}${slot.resumeId ? " resume" : ""}`);
  }
  if (data.secretary) {
    const s = data.secretary;
    lines.push(
      `secretary: wanted=${s.wanted} type=${s.type}${s.resumeId ? " resume" : ""}`,
    );
  }
  for (const w of [...data.workers].sort((a, b) => a.slot - b.slot)) {
    lines.push(`slot ${w.slot}: ${w.type}${w.resumeId ? " resume" : ""}`);
  }
  for (const m of [...data.minis].sort((a, b) => a.mini - b.mini)) {
    const roleNote = m.role ? ` role=${m.role}` : "";
    lines.push(`mini ${m.mini}: ${m.type}${roleNote}${m.resumeId ? " resume" : ""}`);
  }
  const minisLay = data.layout?.minis;
  if (minisLay) {
    const leads = Array.isArray(minisLay.leads) ? minisLay.leads.join(",") : "?";
    lines.push(`layout.minis: ${minisLay.grid} max=${minisLay.max} leads=[${leads}]`);
  }
  lines.push(`full JSON: ${file}`);
  return lines.join("\n");
}

export interface SaveMeshSessionResult {
  file: string;
  data: MeshAgents;
}

/** Scrape live mesh session -> mesh-agents.json (layout + slot CLI state). */
export function saveMeshSessionDetailed(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
): SaveMeshSessionResult {
  const data = scrapeMeshAgents(loaded, registry);
  const file = saveMeshAgentsFile(meshAgentsJsonPath(loaded), data);
  return { file, data };
}

/** Scrape live mesh session -> mesh-agents.json (layout + slot CLI state). */
export function saveMeshSession(loaded: LoadedProfile, registry: ProviderRegistry): string {
  return saveMeshSessionDetailed(loaded, registry).file;
}
