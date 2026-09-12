import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dotSmConfigIn, findDotSmConfig } from "./dotdir.js";

describe("dotdir", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("finds .sm/mesh.config.yaml walking up from subdir", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-dot-"));
    const sm = path.join(tmp, ".sm");
    fs.mkdirSync(sm, { recursive: true });
    fs.writeFileSync(path.join(sm, "mesh.config.yaml"), "name: t\n");
    const nested = path.join(tmp, "apps", "api");
    fs.mkdirSync(nested, { recursive: true });
    expect(findDotSmConfig(nested)).toBe(path.join(sm, "mesh.config.yaml"));
  });

  it("dotSmConfigIn returns null when missing", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-dot-"));
    expect(dotSmConfigIn(tmp)).toBeNull();
  });
});
