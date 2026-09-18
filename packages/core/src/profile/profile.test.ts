import { describe, expect, it } from "vitest";
import path from "node:path";
import { defaultProfilePath, loadProfile, portsForSlot } from "../index.js";

describe("loadProfile", () => {
  it("loads default profile without --profile", () => {
    const loaded = loadProfile();
    // cwd may resolve the repo's own dogfooded `.sm/mesh.config.yaml` (name: seatmesh)
    // instead of falling back to the bundled minimal profile — both are valid "no flags" loads.
    expect(["consumer", "minimal", "seatmesh"]).toContain(loaded.profile.name);
    expect(loaded.workspace).toBeTruthy();
  });

  it("default profile resolves bundled minimal mesh.config.yaml", () => {
    const cfg = defaultProfilePath();
    expect(cfg).toContain("profiles");
    expect(cfg.endsWith("mesh.config.yaml")).toBe(true);
  });

  it("loads bundled minimal profile", () => {
    const minimalDir = path.resolve(
      import.meta.dirname,
      "../../../../profiles/minimal",
    );
    const loaded = loadProfile(minimalDir);
    expect(loaded.profile.name).toBe("minimal");
    expect(loaded.workspace).toBeTruthy();
  });

  it("formats worker ports from formula", () => {
    expect(portsForSlot("30{n}0/30{n}1", 3)).toBe("3030/3031");
  });
});
