import { describe, expect, it } from "vitest";
import { diffRegistrySessions } from "./registry-diff.js";

describe("diffRegistrySessions", () => {
  it("starts newly registered, stops de-registered, leaves the rest alone", () => {
    const active = ["/a/.sm/mesh.config.yaml", "/b/.sm/mesh.config.yaml"];
    const registered = ["/b/.sm/mesh.config.yaml", "/c/.sm/mesh.config.yaml"];
    const diff = diffRegistrySessions(active, registered);
    expect(diff.toStart).toEqual(["/c/.sm/mesh.config.yaml"]);
    expect(diff.toStop).toEqual(["/a/.sm/mesh.config.yaml"]);
  });

  it("empty registry stops everything active", () => {
    const diff = diffRegistrySessions(["/a/.sm/mesh.config.yaml"], []);
    expect(diff.toStart).toEqual([]);
    expect(diff.toStop).toEqual(["/a/.sm/mesh.config.yaml"]);
  });

  it("no active watchers starts every registered session", () => {
    const diff = diffRegistrySessions([], ["/a/.sm/mesh.config.yaml", "/b/.sm/mesh.config.yaml"]);
    expect(diff.toStart.sort()).toEqual(["/a/.sm/mesh.config.yaml", "/b/.sm/mesh.config.yaml"]);
    expect(diff.toStop).toEqual([]);
  });

  it("identical sets produce no churn", () => {
    const paths = ["/a/.sm/mesh.config.yaml", "/b/.sm/mesh.config.yaml"];
    const diff = diffRegistrySessions(paths, paths);
    expect(diff.toStart).toEqual([]);
    expect(diff.toStop).toEqual([]);
  });
});
