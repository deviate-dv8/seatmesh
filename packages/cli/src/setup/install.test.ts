import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultInstallBinDir, resolveRepoBinShim, runInstall } from "./install.js";

describe("runInstall", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("resolveRepoBinShim finds monorepo bin/seatmesh", () => {
    const shim = resolveRepoBinShim();
    expect(fs.existsSync(shim)).toBe(true);
    expect(path.basename(shim)).toBe("seatmesh");
  });

  it("creates symlink idempotently", () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-install-"));
    tmpDirs.push(binDir);
    const first = runInstall({ binDir });
    expect(first.created).toBe(true);
    expect(fs.realpathSync(first.link)).toBe(first.target);

    const second = runInstall({ binDir });
    expect(second.created).toBe(false);
  });

  it("defaultInstallBinDir ends with .local/bin when XDG unset", () => {
    const d = defaultInstallBinDir();
    expect(d).toMatch(/\.local\/bin$/);
  });
});
