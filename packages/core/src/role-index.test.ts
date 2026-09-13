import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRoleIndex, roleAllows, validateRoleIndex } from "./role-index.js";

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

  it("merges funcs/guards — common deny accumulates, role's own allow wins", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sm-role-"));
    const rolesDir = path.join(root, "roles");
    fs.mkdirSync(rolesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rolesDir, "common.yaml"),
      `guards:\n  deny: [merge, board.mutate]\nfuncs:\n  allow: [dc-sh, notify]\n`,
    );
    fs.writeFileSync(
      path.join(rolesDir, "worker.yaml"),
      `kind: worker\nfuncs:\n  allow: [dc-sh]\n  deny: [docker-exec]\n`,
    );

    const index = loadRoleIndex(rolesDir, "worker");
    // common's deny accumulates even though worker's own funcs has no deny for it
    expect(index.guards?.deny).toEqual(["merge", "board.mutate"]);
    // worker's own allow list wins over common's broader one
    expect(index.funcs?.allow).toEqual(["dc-sh"]);
    expect(index.funcs?.deny).toEqual(["docker-exec"]);

    expect(roleAllows(index.funcs, "dc-sh")).toBe(true);
    expect(roleAllows(index.funcs, "notify")).toBe(false); // not in worker's own allow list
    expect(roleAllows(index.funcs, "docker-exec")).toBe(false); // denied
  });

  it("roleAllows defaults to true with no rule and true with an empty rule", () => {
    expect(roleAllows(undefined, "anything")).toBe(true);
    expect(roleAllows({}, "anything")).toBe(true);
  });

  it("inherits manager via columns/manager-2.yaml extends (ignores roles/manager-2.yaml)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sm-role-"));
    const rolesDir = path.join(root, "roles");
    fs.mkdirSync(path.join(rolesDir, "columns"), { recursive: true });
    fs.writeFileSync(
      path.join(rolesDir, "common.yaml"),
      `banner:\n  - "from=common"\n`,
    );
    fs.writeFileSync(
      path.join(rolesDir, "manager.yaml"),
      `kind: manager\nextends: common\nbanner:\n  - "from=manager"\n`,
    );
    fs.writeFileSync(
      path.join(rolesDir, "manager-2.yaml"),
      `kind: manager-2\nbanner:\n  - "from=legacy-kind-file"\n`,
    );
    fs.writeFileSync(
      path.join(rolesDir, "columns", "manager-2.yaml"),
      `extends: manager\nbanner:\n  - "from=column-overlay"\n`,
    );

    const index = loadRoleIndex(rolesDir, "manager-2");
    expect(index.banner).toEqual(["from=common", "from=manager", "from=column-overlay"]);
    expect(index.banner).not.toContain("from=legacy-kind-file");
  });

  it("extends chain merges policies by id (child wins)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sm-role-"));
    const rolesDir = path.join(root, "roles");
    fs.mkdirSync(rolesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rolesDir, "worker.yaml"),
      `kind: worker\npolicies:\n  - id: p1\n    text: base\n`,
    );
    fs.writeFileSync(
      path.join(rolesDir, "mini.yaml"),
      `kind: mini\nextends: worker\npolicies:\n  - id: p1\n    text: mini override\n`,
    );

    const index = loadRoleIndex(rolesDir, "mini-3");
    expect(index.policies?.find((p) => p.id === "p1")?.text).toBe("mini override");
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
