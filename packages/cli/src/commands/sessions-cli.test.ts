import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { displayDir, listSessionRows } from "./sessions-cli.js";

describe("displayDir", () => {
  it("shortens home to ~", () => {
    const home = os.homedir();
    expect(displayDir(home)).toBe("~");
    expect(displayDir(path.join(home, "Desktop/Projects/seatmesh"))).toBe(
      "~/Desktop/Projects/seatmesh",
    );
  });

  it("leaves absolute non-home paths intact", () => {
    expect(displayDir("/tmp/mesh-ws")).toBe("/tmp/mesh-ws");
  });
});

describe("listSessionRows", () => {
  it("returns an array (registry and/or discovered)", () => {
    const rows = listSessionRows();
    expect(Array.isArray(rows)).toBe(true);
  });
});
