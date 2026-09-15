import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRoleIndex, mergeExtendRespectingLocked, type RoleIndex } from "./role-index.js";
import { runRolePackMigrate } from "./role-migrate.js";

describe("mergeExtendRespectingLocked", () => {
  const vendor: RoleIndex = {
    kind: "manager",
    banner: ["engine=banner"],
    policies: [
      { id: "peer", cmd: "vendor-peer" },
      { id: "minis", cmd: "vendor-minis" },
    ],
    read_first: [{ path: ".sm/AGENTS.md" }],
  };

  it("keeps vendor policy ids when policies locked; allows new ids", () => {
    const merged = mergeExtendRespectingLocked(
      vendor,
      {
        policies: [
          { id: "peer", cmd: "user-override-peer" },
          { id: "my_playbook", path: ".agent/X.md" },
        ],
        banner: ["project=hub"],
      },
      ["banner", "read_first", "policies"],
    );
    expect(merged.policies?.find((p) => p.id === "peer")?.cmd).toBe("vendor-peer");
    expect(merged.policies?.find((p) => p.id === "my_playbook")?.path).toBe(".agent/X.md");
    expect(merged.banner).toEqual(["engine=banner", "project=hub"]);
  });

  it("allows policy override when policies unlocked", () => {
    const merged = mergeExtendRespectingLocked(
      vendor,
      { policies: [{ id: "peer", cmd: "user-peer" }] },
      ["banner"],
    );
    expect(merged.policies?.find((p) => p.id === "peer")?.cmd).toBe("user-peer");
  });
});

describe("loadRoleIndex vendor+extend", () => {
  it("loads _vendor + extend and ignores legacy flat when vendor present", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sm-role-v-"));
    const rolesDir = path.join(root, "roles");
    const vendor = path.join(rolesDir, "_vendor");
    fs.mkdirSync(vendor, { recursive: true });
    fs.writeFileSync(
      path.join(vendor, "common.yaml"),
      `locked: [banner, policies]\nbanner:\n  - "common=v"\n`,
    );
    fs.writeFileSync(
      path.join(vendor, "worker.yaml"),
      `kind: worker\nextends: common\nlocked: [banner, policies]\npolicies:\n  - id: peer\n    cmd: vendor\n`,
    );
    fs.writeFileSync(
      path.join(rolesDir, "worker.extend.yaml"),
      `policies:\n  - id: peer\n    cmd: hacked\n  - id: extra\n    text: ok\nbanner:\n  - "ext=1"\n`,
    );
    fs.writeFileSync(
      path.join(rolesDir, "worker.yaml"),
      `kind: worker\nbanner:\n  - "legacy=no"\n`,
    );

    const index = loadRoleIndex(rolesDir, "worker");
    expect(index.banner).toContain("common=v");
    expect(index.banner).toContain("ext=1");
    expect(index.banner).not.toContain("legacy=no");
    expect(index.policies?.find((p) => p.id === "peer")?.cmd).toBe("vendor");
    expect(index.policies?.find((p) => p.id === "extra")?.text).toBe("ok");
    expect(index.locked).toContain("policies");
  });
});

describe("role-pack migrate up/down", () => {
  it("1.0 flat → 1.1 vendor+extend → down flattens", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sm-role-m-"));
    const rolesDir = path.join(root, "roles");
    fs.mkdirSync(rolesDir, { recursive: true });
    fs.writeFileSync(path.join(rolesDir, "common.yaml"), `banner:\n  - "user=common"\n`);
    fs.writeFileSync(
      path.join(rolesDir, "worker.yaml"),
      `kind: worker\nextends: common\npolicies:\n  - id: my_custom\n    text: keep-me\n`,
    );

    const tpl = path.resolve(process.cwd(), "packages/cli/templates/init/roles");
    expect(fs.existsSync(path.join(tpl, "ROLE_PACK.json"))).toBe(true);

    const up = runRolePackMigrate({
      rolesDir,
      templateRolesDir: tpl,
      to: "1.1.0",
      log: () => {},
    });
    expect(up.direction).toBe("up");
    expect(fs.existsSync(path.join(rolesDir, "_vendor", "ROLE_PACK.json"))).toBe(true);
    expect(fs.existsSync(path.join(rolesDir, "worker.extend.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(rolesDir, "_legacy_flat", "worker.yaml"))).toBe(true);

    const index = loadRoleIndex(rolesDir, "worker");
    expect(index.policies?.some((p) => p.id === "my_custom")).toBe(true);

    const down = runRolePackMigrate({
      rolesDir,
      templateRolesDir: tpl,
      to: "1.0.0",
      log: () => {},
    });
    expect(down.direction).toBe("down");
    expect(fs.existsSync(path.join(rolesDir, "worker.yaml"))).toBe(true);
  });
});
