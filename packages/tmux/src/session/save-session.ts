import fs from "node:fs";
import path from "node:path";
import {
  MeshAgentsSchema,
  buildKindLaunchCmd,
  entryWantsProxyRecovery,
  isOpenCodeKind,
  lookupResolvedKind,
  normalizeAgentKind,
  runnersFromProfile,
  type AgentRunnerEntry,
  type CliType,
  type LoadedProfile,
  type ManagerSlot,
  type MeshAgents,
  type MiniSlot,
  type ResolvedAgentKind,
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
  gridPaneCapacity,
} from "@seat-mesh/core";
import type { ProviderRegistry } from "@seat-mesh/core";
import { kindsForLoaded } from "../agents/agent-launch.js";
import {
  cmdlines,
  extractOpenCodeSession,
  matchAny,
  normalizeOpenCodeSessionId,
} from "@seat-mesh/providers";
import { cliForBaseColumn } from "./base-layout.js";
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
import { resolveLiveTmuxSession } from "../lib/live-session.js";
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

export function isOpenCodeCpeResumeCmd(cmd: string | null | undefined): boolean {
  return Boolean(cmd && /opencode-cpe\.sh/i.test(cmd));
}

/** Refresh `--session` on a CPE wrapper without dropping the script path. */
export function injectOpenCodeSessionIntoCmd(
  cmd: string,
  resumeId: string | null | undefined,
): string {
  const sid = normalizeOpenCodeSessionId(resumeId ?? undefined);
  let out = cmd.replace(/\s--session\s+\S+/g, "").trimEnd();
  if (sid) out = `${out} --session ${sid}`;
  return out;
}

function isOpenCodeFamily(type: CliType | undefined): boolean {
  return Boolean(type && isOpenCodeKind(type));
}

function isOpenCodeCpeKind(
  type: CliType | undefined,
  preserved?: PreservedSlot,
  kinds?: Record<string, ResolvedAgentKind>,
): boolean {
  if (kinds) {
    if (
      entryWantsProxyRecovery(
        { type: type ?? null, resumeCmd: preserved?.resumeCmd ?? null },
        kinds,
      )
    ) {
      return true;
    }
    if (
      preserved &&
      entryWantsProxyRecovery(
        { type: preserved.type ?? null, resumeCmd: preserved.resumeCmd ?? null },
        kinds,
      )
    ) {
      return true;
    }
  }
  if (type === "opencode-cpe") return true;
  if (preserved?.type === "opencode-cpe") return true;
  if (preserved?.resumeCmd && isOpenCodeCpeResumeCmd(preserved.resumeCmd)) return true;
  return false;
}

function buildSavedResumeCmd(
  type: CliType,
  workspace: string,
  resumeId: string | null,
  runners: Record<string, AgentRunnerEntry>,
  preserved?: PreservedSlot,
  kinds?: Record<string, ResolvedAgentKind>,
): string | null {
  if (type === "empty") return null;
  if (preserved?.resumeCmd && isOpenCodeCpeResumeCmd(preserved.resumeCmd)) {
    return injectOpenCodeSessionIntoCmd(preserved.resumeCmd, resumeId);
  }
  const custom = buildKindLaunchCmd(type, workspace, resumeId, runners, kinds);
  if (custom != null) return custom;
  return buildAgentLaunchCmd(type, workspace, resumeId);
}

function finalizePaneState(
  workspace: string,
  live: { type: CliType; resumeId: string | null },
  preserved: PreservedSlot | undefined,
  runners: Record<string, AgentRunnerEntry>,
  kinds?: Record<string, ResolvedAgentKind>,
): { type: CliType; resumeId: string | null; resumeCmd: string | null } {
  let type = live.type;
  let resumeId = live.resumeId;

  let preservedId =
    preserved?.resumeId ??
    (preserved?.resumeCmd ? extractOpenCodeSession(preserved.resumeCmd) : undefined);
  if (isOpenCodeFamily(type) || isOpenCodeFamily(preserved?.type)) {
    preservedId = normalizeOpenCodeSessionId(preservedId);
    if (resumeId) resumeId = normalizeOpenCodeSessionId(resumeId) ?? null;
  }

  if (preservedId) {
    if (type === "empty" && preserved?.type && preserved.type !== "empty") {
      type = preserved.type;
    }
    // Prefer preserved session when scrape misses (CPE child looks like bare OC)
    if (isOpenCodeFamily(type) && !resumeId) {
      resumeId = preservedId;
    }
  }

  if (isOpenCodeCpeKind(type, preserved, kinds)) {
    const byType = type ? lookupResolvedKind(kinds ?? {}, type) : undefined;
    if (byType?.prove || byType?.recovery?.onProxyUp) {
      type = byType.id;
    } else {
      type = lookupResolvedKind(kinds ?? {}, "opencode-cpe")?.id ?? "opencode-cpe";
    }
  }

  const resumeCmd = buildSavedResumeCmd(type, workspace, resumeId, runners, preserved, kinds);
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

function detectPaneType(
  snap: NonNullable<ReturnType<typeof capturePaneSnapshot>>,
  provType: CliType,
  preserved?: PreservedSlot,
  kinds?: Record<string, ResolvedAgentKind>,
): CliType {
  const lines = cmdlines(snap);
  if (kinds) {
    for (const kind of Object.values(kinds)) {
      if (!kind.prove?.cmdline?.length) continue;
      const regs = kind.prove.cmdline.flatMap((p) => {
        try {
          return [new RegExp(p, "i")];
        } catch {
          return [];
        }
      });
      if (regs.length && matchAny(lines, regs)) return kind.id;
    }
    if (
      preserved &&
      entryWantsProxyRecovery(
        { type: preserved.type ?? null, resumeCmd: preserved.resumeCmd ?? null },
        kinds,
      )
    ) {
      return preserved.type && lookupResolvedKind(kinds, preserved.type)
        ? preserved.type
        : "opencode-cpe";
    }
  }
  if (matchAny(lines, [/opencode-cpe\.sh/i])) return "opencode-cpe";
  if (preserved?.type === "opencode-cpe" || isOpenCodeCpeResumeCmd(preserved?.resumeCmd)) {
    return "opencode-cpe";
  }
  if (matchAny(lines, [/opencode/i])) return "opencode";
  return provType;
}

function detectPane(
  paneId: string,
  registry: ProviderRegistry,
  workspace: string,
  runners: Record<string, AgentRunnerEntry>,
  preserved?: PreservedSlot,
  kinds?: Record<string, ResolvedAgentKind>,
): { type: CliType; resumeId: string | null; resumeCmd: string | null } {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) {
    const out = finalizePaneState(
      workspace,
      { type: "empty", resumeId: null },
      preserved,
      runners,
      kinds,
    );
    if (out.resumeId) stampOpenCodeSessionOnPane(paneId, out.resumeId);
    return out;
  }
  const prov = registry.detect(snap);
  if (!prov) {
    const out = finalizePaneState(
      workspace,
      { type: "empty", resumeId: null },
      preserved,
      runners,
      kinds,
    );
    if (out.resumeId) stampOpenCodeSessionOnPane(paneId, out.resumeId);
    return out;
  }
  const det = prov.detect(snap);
  const baseType = cliTypeFromProvider(prov.id);
  const type = detectPaneType(snap, baseType, preserved, kinds);
  const resumeId = det?.resumeId ?? null;
  const out = finalizePaneState(workspace, { type, resumeId }, preserved, runners, kinds);
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
function meshConventionsFromProfile(loaded: LoadedProfile): MeshAgents["conventions"] {
  const layout = loaded.profile.layout;
  const secCol = layout ? primarySecretaryColumn(layout) : "secretary";
  const secCli = (cliForBaseColumn(loaded, secCol) || "opencode") as CliType;
  return {
    secretaryDefaultCli: secCli,
    miniDefaultCli: "opencode",
    launchSkipsEmpty: true,
  };
}

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
    conventions: meshConventionsFromProfile(loaded),
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
  const session = resolveLiveTmuxSession(loaded);
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
  const runners = runnersFromProfile(loaded.profile);
  const kinds = kindsForLoaded(loaded);
  const workerMeta = listMeshWorkers(session, layout.workers.window);
  const miniMeta = listMeshMinis(session, layout.minis.window);

  const workers: WorkerSlot[] = [];
  for (let slot = 1; slot <= loaded.profile.session.workerCount; slot++) {
    const paneId = workerMeta.find((w) => Number(w.slot) === slot)?.paneId;
    if (!paneId) continue;
    const prev = existing?.workers.find((w) => w.slot === slot);
    const det = detectPane(paneId, registry, loaded.workspace, runners, prev, kinds);
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
    const det = detectPane(paneId, registry, loaded.workspace, runners, prev, kinds);
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
        const liveCmd = tmux([
          "display-message",
          "-t",
          mgrPane,
          "-p",
          "#{pane_current_command}",
        ]).out.trim();
        // Operator terminal: never persist OC/agent from scrollback / preserved when shell is live.
        // (auto-revive + post-launch brief were spamming zsign manager)
        if (/^(zsh|bash|sh|fish|dash)$/i.test(liveCmd) || !liveCmd) {
          return {
            type: "empty" as CliType,
            name: "manager",
            resumeId: null,
            resumeCmd: null,
          };
        }
        const det = detectPane(mgrPane, registry, loaded.workspace, runners, existing?.manager, kinds);
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
    const det = detectPane(pane, registry, loaded.workspace, runners, existing?.coords?.[id], kinds);
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
    const profileSecCli =
      loaded.profile.layout?.base.cli?.secretary?.trim().toLowerCase() ?? "opencode";
    const secDefaultType: CliType =
      normalizeAgentKind(profileSecCli) === "opencode-cpe" ? "opencode-cpe" : "opencode";
    if (!paneSid && !isOpenCodeCpeResumeCmd(preserved?.resumeCmd)) {
      preserved = { ...preserved, type: secDefaultType, resumeId: null, resumeCmd: null };
    } else if (paneSid) {
      preserved = {
        ...preserved,
        type: isOpenCodeCpeResumeCmd(preserved?.resumeCmd) ? "opencode-cpe" : secDefaultType,
        resumeId: paneSid,
      };
    }
    const det = detectPane(secPane, registry, loaded.workspace, runners, preserved, kinds);
    secretary = {
      type: det.type === "empty" ? secDefaultType : det.type,
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
    layout: (() => {
      const liveWorkerSlots = workerMeta.length;
      const profileGrid = layout.workers.grid ?? "3x2";
      const profileSlots = layout.workers.slots ?? loaded.profile.session.workerCount;
      const prevGrid = existing?.layout?.workers?.grid;
      const prevSlots = existing?.layout?.workers?.slots;
      let workersGrid = profileGrid;
      let workersSlots = profileSlots;
      if (liveWorkerSlots > 0) {
        workersSlots = liveWorkerSlots;
        // Prefer a grid whose capacity matches live panes (heal poisoned 3x2+slots=1).
        if (prevGrid && gridPaneCapacity(prevGrid) === liveWorkerSlots) {
          workersGrid = prevGrid;
        } else if (gridPaneCapacity(profileGrid) === liveWorkerSlots) {
          workersGrid = profileGrid;
        } else {
          workersGrid = profileGrid;
        }
      } else if (prevGrid && typeof prevSlots === "number") {
        workersGrid = prevGrid;
        workersSlots = prevSlots;
      }
      return {
        ...(existing?.layout?.base ? { base: existing.layout.base } : {}),
        nvim: {
          enabled: listWindowPaneIds(session, layout.nvim.window).length > 0,
        },
        workers: {
          enabled: liveWorkerSlots > 0 || Boolean(layout.workers.enabled),
          grid: workersGrid,
          slots: workersSlots,
        },
        minis: {
          enabled: miniMeta.length > 0 || Boolean(layout.minis.enabled),
          grid: existing?.layout?.minis?.grid ?? minisLayout.grid,
          max: existing?.layout?.minis?.max ?? minisLayout.max,
          leads: existing?.layout?.minis?.leads ?? minisLayout.leads,
        },
        ...(existing?.layout?.logs ? { logs: existing.layout.logs } : {}),
      };
    })(),
    conventions: existing?.conventions ?? meshConventionsFromProfile(loaded),
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
