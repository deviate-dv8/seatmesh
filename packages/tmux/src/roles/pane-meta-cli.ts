import type { LoadedProfile } from "@seat-mesh/core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import {
  listMeshMinis,
  listMeshWorkers,
  meshManagerPane,
  meshSecretaryPane,
  paneMetaForPane,
  type MeshPaneMeta,
} from "../lib/pane-meta.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { liveMeshSession } from "../session/labels.js";

const META_FIELDS = new Set([
  "paneId",
  "role",
  "slot",
  "mini",
  "ports",
  "window",
  "cwd",
  "cmd",
]);

function metaField(meta: MeshPaneMeta, field: string): string | undefined {
  switch (field) {
    case "paneId":
      return meta.paneId;
    case "role":
      return meta.role;
    case "slot":
      return meta.slot;
    case "mini":
      return meta.mini;
    case "ports":
      return meta.ports;
    default:
      return undefined;
  }
}

function printMetaLine(meta: MeshPaneMeta, window?: string): void {
  const parts = [
    meta.paneId,
    meta.role || "-",
    meta.slot || "-",
    meta.mini || "-",
    meta.ports || "-",
  ];
  if (window) parts.push(window);
  console.log(parts.join("\t"));
}

function listWindowPanes(loaded: LoadedProfile, windowArg: string): void {
  const session = liveMeshSession(loaded);
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  const windowMap: Record<string, string> = {
    workers: layout.workers.window,
    minis: layout.minis?.window ?? "",
    base: layout.base.window,
    nvim: layout.nvim?.window ?? "",
  };

  const win = windowMap[windowArg] ?? windowArg;
  if (!win) throw new Error(`unknown window '${windowArg}'`);

  if (win === layout.workers.window) {
    for (const m of listMeshWorkers(session, win)) printMetaLine(m, win);
    return;
  }
  if (layout.minis && win === layout.minis.window) {
    for (const m of listMeshMinis(session, win)) printMetaLine(m, win);
    return;
  }
  if (win === layout.base.window) {
    for (const id of [meshManagerPane(session, win), meshSecretaryPane(session, win)]) {
      if (!id) continue;
      const meta = paneMetaForPane(id);
      if (meta) printMetaLine(meta, win);
    }
    return;
  }

  throw new Error(`pane-meta panes: use workers|minis|base or a window name from profile`);
}

/** P4-2: expose lib/pane-meta.ts (+ snapshot fields) as a CLI verb. */
export function runPaneMeta(loaded: LoadedProfile, argv: string[]): void {
  const json = argv.includes("--json");
  const args = argv.filter((a) => a !== "--json");

  if (args[0] === "panes") {
    const windowArg = args[1] ?? "workers";
    if (json) {
      const session = liveMeshSession(loaded);
      const layout = loaded.profile.layout;
      if (!layout) throw new Error("profile missing layout");
      const win =
        windowArg === "workers"
          ? layout.workers.window
          : windowArg === "minis" && layout.minis
            ? layout.minis.window
            : windowArg === "base"
              ? layout.base.window
              : windowArg;
      let rows: MeshPaneMeta[] = [];
      if (win === layout.workers.window) {
        rows = listMeshWorkers(session, win);
      } else if (layout.minis && win === layout.minis.window) {
        rows = listMeshMinis(session, win);
      }
      console.log(JSON.stringify({ window: win, panes: rows }, null, 0));
      return;
    }
    listWindowPanes(loaded, args[1] ?? "workers");
    return;
  }

  const target = args[0] ?? "here";
  const field = args[1];

  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const meta = paneMetaForPane(resolved.paneId);
  if (!meta) throw new Error(`pane-meta: could not read ${resolved.paneId}`);

  if (field) {
    const direct = metaField(meta, field);
    if (direct !== undefined) {
      console.log(direct);
      return;
    }
    if (META_FIELDS.has(field) || field.startsWith("mesh_")) {
      const snap = capturePaneSnapshot(resolved.paneId);
      if (!snap) throw new Error(`pane-meta: snapshot failed for ${resolved.paneId}`);
      if (field === "window") {
        console.log(snap.windowName);
        return;
      }
      if (field === "cwd") {
        console.log(snap.cwd);
        return;
      }
      if (field === "cmd") {
        console.log(snap.currentCommand);
        return;
      }
      const optKey = field.startsWith("mesh_") ? field : `mesh_${field}`;
      const v = snap.options[optKey] ?? snap.options[field];
      if (v !== undefined) {
        console.log(v);
        return;
      }
    }
    throw new Error(
      `unknown field '${field}' — try role|slot|mini|ports|paneId|window|cwd|cmd|mesh_*`,
    );
  }

  if (json) {
    const snap = capturePaneSnapshot(resolved.paneId);
    console.log(
      JSON.stringify(
        {
          meta,
          row: resolved.row,
          snapshot: snap
            ? {
                windowName: snap.windowName,
                cwd: snap.cwd,
                currentCommand: snap.currentCommand,
                options: snap.options,
              }
            : null,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    [
      `pane=${meta.paneId}`,
      `role=${meta.role || "?"}`,
      `slot=${meta.slot || "-"}`,
      `mini=${meta.mini || "-"}`,
      `ports=${meta.ports || "-"}`,
      `target=${target}`,
    ].join(" "),
  );
}
