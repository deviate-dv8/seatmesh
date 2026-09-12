import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRoleIndex, validateRoleIndex } from "./role-index.js";

describe("role-index", () => {
  it("merges common + role and validates paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sm-role-"));
    const rolesDir = path.join(root, "roles");
    fs.mkdirSync(rolesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rolesDir, "common.yaml"),
      `banner:\n  - "test=common"\nread_first:\n  - path: docs/a.md\n    note: shared\n`,
    );
    fs.writeFileSync(
      path.join(rolesDir, "worker.yaml"),
      `kind: worker\nfiles:\n  - docs/b.md\npolicies:\n  - id: p1\n    path: docs/c.md\n`,
    );
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    for (const f of ["a.md", "b.md", "c.md"]) {
      fs.writeFileSync(path.join(root, "docs", f), "# ok\n");
    }

    const index = loadRoleIndex(rolesDir, "worker");
    expect(index.banner).toContain("test=common");
    expect(index.read_first?.map((x) => x.path)).toContain("docs/a.md");
    expect(index.files).toContain("docs/b.md");

    const ok = validateRoleIndex(index, root);
    expect(ok.ok).toBe(true);
    expect(ok.missing).toEqual([]);
  });

  it("reports missing role-index paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sm-role-"));
    const rolesDir = path.join(root, "roles");
    fs.mkdirSync(rolesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rolesDir, "manager.yaml"),
      `kind: manager\nread_first:\n  - path: missing/playbook.md\n`,
    );

    const index = loadRoleIndex(rolesDir, "manager");
    const result = validateRoleIndex(index, root);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["missing/playbook.md"]);
  });

  it("normalizes master alias to manager", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sm-role-"));
    const rolesDir = path.join(root, "roles");
    fs.mkdirSync(rolesDir, { recursive: true });
    fs.writeFileSync(path.join(rolesDir, "manager.yaml"), `kind: manager\n`);

    const index = loadRoleIndex(rolesDir, "master");
    expect(index.kind).toBe("manager");
  });
});
