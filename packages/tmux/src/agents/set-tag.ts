import type { CliType, LoadedProfile, MeshAgents, ProviderRegistry } from "@seat-mesh/core";
import { MeshAgentsSchema, isManagerKind, portsForSlot } from "@seat-mesh/core";
import { buildAgentLaunchCmd } from "./agent-builder.js";
import { loadMeshAgentsForProfile, meshAgentsJsonPath } from "./agents-state.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { resolvePaneTarget, type PaneRow } from "../lib/resolve-pane.js";
import { saveMeshAgentsFile } from "../session/save-session.js";
import { extractResumeIdAuto } from "./resume-extract.js";

const CLI_TYPES = new Set(["agent", "kiro", "claude", "opencode", "empty"]);

function normalizeType(t: string): CliType {
  const x = t.trim().toLowerCase();
  if (x === "cursor-agent") return "agent";
  if (!CLI_TYPES.has(x)) {
    throw new Error(`bad type: ${t} (want agent|kiro|claude|opencode|empty)`);
  }
  return x as CliType;
}

function providerIdToType(id: string): CliType {
  if (id === "cursor-agent") return "agent";
  if (CLI_TYPES.has(id)) return id as CliType;
  return "empty";
}

function detectLiveType(
  paneId: string,
  registry: ProviderRegistry,
): CliType {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return "empty";
  const prov = registry.detect(snap);
  if (!prov) return "empty";
  return providerIdToType(prov.id);
}

export function ensureMeshAgentsRecord(loaded: LoadedProfile): MeshAgents {
  const existing = loadMeshAgentsForProfile(loaded);
  if (existing) return existing;
  return MeshAgentsSchema.parse({
    schemaVersion: 1,
    session: loaded.sessionName,
    workdir: loaded.workspace,
    workers: [],
    minis: [],
    conventions: {
      secretaryDefaultCli: "opencode",
      miniDefaultCli: "opencode",
      launchSkipsEmpty: true,
    },
  });
}

function finalizeSlot(
  workspace: string,
  type: CliType,
  resumeId: string | null,
): { type: CliType; resumeId: string | null; resumeCmd: string | null } {
  const rid = type === "empty" ? null : resumeId;
  const resumeCmd =
    type === "empty" ? null : buildAgentLaunchCmd(type, workspace, rid);
  return { type, resumeId: rid, resumeCmd };
}

function upsertWorker(
  mesh: MeshAgents,
  slot: number,
  patch: { type: CliType; resumeId: string | null; resumeCmd: string | null },
  portsFormula: string,
): MeshAgents {
  const workers = [...mesh.workers];
  const idx = workers.findIndex((w) => w.slot === slot);
  const row = {
    type: patch.type,
    slot,
    name: `worker-${slot}`,
    ports: portsForSlot(portsFormula, slot),
    resumeId: patch.resumeId,
    resumeCmd: patch.resumeCmd,
    paneIndex: slot - 1,
  };
  if (idx >= 0) workers[idx] = { ...workers[idx], ...row };
  else workers.push(row);
  workers.sort((a, b) => a.slot - b.slot);
  return { ...mesh, workers };
}

function upsertMini(
  mesh: MeshAgents,
  mini: number,
  patch: { type: CliType; resumeId: string | null; resumeCmd: string | null },
): MeshAgents {
  const minis = [...mesh.minis];
  const idx = minis.findIndex((m) => m.mini === mini);
  const row = {
    type: patch.type,
    mini,
    name: `mini-${mini}`,
    resumeId: patch.resumeId,
    resumeCmd: patch.resumeCmd,
    paneIndex: mini - 1,
    ...(idx >= 0 ? { role: minis[idx]?.role, task: minis[idx]?.task } : {}),
  };
  if (idx >= 0) minis[idx] = { ...minis[idx], ...row };
  else minis.push(row);
  minis.sort((a, b) => a.mini - b.mini);
  return { ...mesh, minis };
}

export function patchMeshAgentsForPane(
  mesh: MeshAgents,
  row: PaneRow,
  loaded: LoadedProfile,
  patch: { type: CliType; resumeId: string | null },
): MeshAgents {
  const finalized = finalizeSlot(loaded.workspace, patch.type, patch.resumeId);
  const next = {
    ...mesh,
    session: loaded.sessionName,
    workdir: loaded.workspace,
    updatedAt: new Date().toISOString(),
  };

  if (row.role === "manager") {
    return MeshAgentsSchema.parse({
      ...next,
      manager: {
        type: finalized.type,
        name: "manager",
        resumeId: finalized.resumeId,
        resumeCmd: finalized.resumeCmd,
      },
    });
  }

  if (isManagerKind(row.role) && row.role !== "manager") {
    const slot = {
      type: finalized.type,
      name: row.role,
      resumeId: finalized.resumeId,
      resumeCmd: finalized.resumeCmd,
    };
    return MeshAgentsSchema.parse({
      ...next,
      coords: { ...(next.coords ?? {}), [row.role]: slot },
    });
  }

  if (row.role === "secretary") {
    return MeshAgentsSchema.parse({
      ...next,
      secretary: {
        type: finalized.type === "empty" ? "opencode" : finalized.type,
        wanted: true,
        resumeId: finalized.resumeId,
        resumeCmd: finalized.resumeCmd,
        ports: "secretary",
        paneIndex: 1,
      },
    });
  }

  if (row.role === "manager-mini" || row.mini) {
    const n = Number(row.mini);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(`mini pane missing @mesh_mini (${row.paneId})`);
    }
    return MeshAgentsSchema.parse(
      upsertMini(next, n, finalized),
    );
  }

  if (row.role === "worker" && row.slot && /^\d+$/.test(row.slot)) {
    const slot = Number(row.slot);
    return MeshAgentsSchema.parse(
      upsertWorker(
        next,
        slot,
        finalized,
        loaded.profile.ports.worker,
      ),
    );
  }

  throw new Error(
    `cannot map pane ${row.paneId} (role=${row.role || "?"}) to mesh-agents slot`,
  );
}

function currentTypeFromMesh(mesh: MeshAgents, row: PaneRow): CliType | null {
  if (row.role === "manager") return mesh.manager?.type ?? null;
  if (isManagerKind(row.role) && row.role !== "manager") {
    return mesh.coords?.[row.role]?.type ?? null;
  }
  if (row.role === "secretary") return mesh.secretary?.type ?? null;
  if (row.mini) {
    return mesh.minis.find((m) => m.mini === Number(row.mini))?.type ?? null;
  }
  if (row.slot && /^\d+$/.test(row.slot)) {
    return mesh.workers.find((w) => w.slot === Number(row.slot))?.type ?? null;
  }
  return null;
}

function persistPatched(
  loaded: LoadedProfile,
  mesh: MeshAgents,
): string {
  const file = meshAgentsJsonPath(loaded);
  saveMeshAgentsFile(file, mesh);
  return file;
}

function printSlot(mesh: MeshAgents, row: PaneRow): void {
  if (row.role === "manager") {
    console.log(JSON.stringify(mesh.manager ?? null, null, 2));
    return;
  }
  if (isManagerKind(row.role) && row.role !== "manager") {
    console.log(JSON.stringify(mesh.coords?.[row.role] ?? null, null, 2));
    return;
  }
  if (row.role === "secretary") {
    console.log(JSON.stringify(mesh.secretary ?? null, null, 2));
    return;
  }
  if (row.mini) {
    const hit = mesh.minis.find((m) => m.mini === Number(row.mini));
    console.log(JSON.stringify(hit ?? null, null, 2));
    return;
  }
  if (row.slot && /^\d+$/.test(row.slot)) {
    const hit = mesh.workers.find((w) => w.slot === Number(row.slot));
    console.log(JSON.stringify(hit ?? null, null, 2));
    return;
  }
  console.log(JSON.stringify(mesh, null, 2));
}

/** Persist CLI type for a pane (clears resume id). Harness parity: set without relaunch. */
export function runSet(
  loaded: LoadedProfile,
  _registry: ProviderRegistry,
  target: string,
  typeRaw: string,
): void {
  const newType = normalizeType(typeRaw);
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  if (resolved.row.role === "manager" && newType === "empty") {
    throw new Error("refused: do not set manager to empty");
  }

  const mesh = ensureMeshAgentsRecord(loaded);
  const next = patchMeshAgentsForPane(mesh, resolved.row, loaded, {
    type: newType,
    resumeId: null,
  });
  const file = persistPatched(loaded, next);
  console.log(`OK: set ${target} -> ${newType} (${file})`);
  printSlot(next, resolved.row);
}

function normalizeTagTarget(target: string): string {
  const t = target.trim();
  if (t === "self") return "here";
  return t;
}

function targetLabel(row: PaneRow): string {
  if (isManagerKind(row.role) || row.role === "secretary" || row.role.startsWith("secretary-")) {
    return row.role;
  }
  if (row.mini) return `mini-${row.mini}`;
  if (row.slot && /^\d+$/.test(row.slot)) return `slot-${row.slot}`;
  return row.paneId;
}

export interface RunTagOptions {
  auto?: boolean;
}

/** Persist resume id for a pane (keeps current type). Harness parity: tag without relaunch. */
export function runTag(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  resumeIdRaw: string,
  opts: RunTagOptions = {},
): void {
  const resolved = resolvePaneTarget(normalizeTagTarget(target), loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  let resumeId = resumeIdRaw.trim();
  if (opts.auto || resumeId === "--auto") {
    const extracted = extractResumeIdAuto(resolved.paneId, registry);
    if (!extracted) {
      throw new Error(
        `tag ${targetLabel(resolved.row)}: --auto found no resume_id on live CLI (empty/opencode or plain shell?)`,
      );
    }
    resumeId = extracted;
  }
  if (!resumeId) {
    throw new Error("usage: tag <target|self> <resume_id|--auto>");
  }

  const mesh = ensureMeshAgentsRecord(loaded);
  const type =
    currentTypeFromMesh(mesh, resolved.row) ??
    detectLiveType(resolved.paneId, registry);
  if (type === "empty") {
    throw new Error(
      `tag ${targetLabel(resolved.row)}: pane type is empty — run set <target> <type> first`,
    );
  }

  const next = patchMeshAgentsForPane(mesh, resolved.row, loaded, {
    type,
    resumeId,
  });
  const file = persistPatched(loaded, next);
  const label = targetLabel(resolved.row);
  const short = resumeId.length > 8 ? `${resumeId.slice(0, 8)}...` : resumeId;
  console.log(`OK: tagged ${label} resume=${short} type=${type} (${file})`);
  printSlot(next, resolved.row);
}
