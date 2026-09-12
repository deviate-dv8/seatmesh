import fs from "node:fs";
import path from "node:path";
import { loadProfile, profilePaths } from "@seat-mesh/core";

export interface MigrateRuntimeOptions {
  workspace?: string;
  profileArg?: string;
  /** Copy tasks/agent-seats -> .sm/seats (default true). */
  seats?: boolean;
  dryRun?: boolean;
}

export interface MigrateRuntimeResult {
  copied: string[];
  skipped: string[];
  notes: string[];
}

function copyTree(src: string, dest: string, copied: string[], skipped: string[], dryRun: boolean): void {
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isFile()) {
    if (fs.existsSync(dest)) {
      skipped.push(dest);
      return;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    copied.push(`${src} -> ${dest}`);
    return;
  }
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    copyTree(path.join(src, ent.name), path.join(dest, ent.name), copied, skipped, dryRun);
  }
}

/** One-time move legacy harness paths into `.sm/` (dotdir-only runtime). */
export function runMigrateRuntime(opts: MigrateRuntimeOptions = {}): MigrateRuntimeResult {
  const loaded = loadProfile(opts.profileArg ?? opts.workspace);
  const paths = profilePaths(loaded);
  const ws = loaded.workspace;
  const copied: string[] = [];
  const skipped: string[] = [];
  const notes: string[] = [];

  const pairs: [string, string][] = [
    [path.join(ws, "tasks/seatmesh/daemon"), paths.daemonDir],
    [path.join(ws, "tasks/seatmesh/minis.json"), path.join(paths.dataRoot, "minis.json")],
    [path.join(ws, "tasks/seatmesh/mini-manifest.json"), path.join(paths.dataRoot, "mini-manifest.json")],
    [path.join(ws, "tasks/seatmesh/MINI-DONE.md"), path.join(paths.dataRoot, "MINI-DONE.md")],
    [path.join(ws, "tasks/seatmesh/GATE-QUEUE.md"), path.join(paths.dataRoot, "GATE-QUEUE.md")],
    [path.join(ws, "tasks/chat-rooms"), paths.chatRoomsRoot],
    [path.join(ws, "tasks/chat-files"), paths.chatFilesRoot],
    [path.join(ws, "mesh-agents.json"), paths.meshAgentsJson],
  ];

  if (opts.seats !== false) {
    pairs.push([path.join(ws, "tasks/agent-seats"), paths.seatsRoot]);
  }

  for (const [src, dest] of pairs) {
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(dest)) {
      skipped.push(dest);
      notes.push(`exists (not overwritten): ${dest}`);
      continue;
    }
    copyTree(src, dest, copied, skipped, Boolean(opts.dryRun));
  }

  if (!opts.dryRun) {
    fs.mkdirSync(paths.daemonDir, { recursive: true });
    const stub = (p: string, msg: string) => {
      if (fs.existsSync(p) && !fs.existsSync(path.join(p, "README.migrated"))) {
        fs.writeFileSync(
          path.join(p, "README.migrated"),
          `${msg}\nMigrated to dotdir — see services/seatmesh/docs/DOTDIR.md\n`,
        );
      }
    };
    stub(path.join(ws, "tasks/seatmesh"), "Harness runtime moved to .sm/runtime/");
    stub(path.join(ws, "tasks/chat-rooms"), "Chat rooms moved to .sm/chat-rooms/");
  }

  return { copied, skipped, notes };
}
