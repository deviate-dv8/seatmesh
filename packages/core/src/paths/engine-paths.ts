import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

function hasMinimalProfile(root: string): boolean {
  return fs.existsSync(path.join(root, "profiles/minimal/mesh.config.yaml"));
}

/** Repo root (dev) or published seatmesh / @seat-mesh/core package root. */
export function seatMeshPackageRoot(): string {
  // paths/engine-paths.ts -> packages/core/src/paths -> seat-mesh root is ../../../../
  const mono = path.resolve(import.meta.dirname, "../../../..");
  if (hasMinimalProfile(mono)) return mono;

  for (const pkg of ["seatmesh", "@seat-mesh/cli"]) {
    try {
      const root = path.dirname(require.resolve(`${pkg}/package.json`));
      if (hasMinimalProfile(root)) return root;
    } catch {
      /* not installed */
    }
  }

  try {
    const coreRoot = path.dirname(require.resolve("@seat-mesh/core/package.json"));
    if (hasMinimalProfile(coreRoot)) return coreRoot;
  } catch {
    /* not installed */
  }

  return mono;
}

export function resolveDaemonScript(
  name: "mesh-inbox-server.js" | "mesh-inbox-supervisor.js" | "mesh-inbox-host-supervisor.js",
): string {
  const mono = path.join(seatMeshPackageRoot(), "packages/daemon/dist", name);
  if (fs.existsSync(mono)) return mono;
  try {
    return require.resolve(`@seat-mesh/daemon/dist/${name}`);
  } catch {
    throw new Error(`daemon script not found: ${name} (reinstall seatmesh)`);
  }
}
