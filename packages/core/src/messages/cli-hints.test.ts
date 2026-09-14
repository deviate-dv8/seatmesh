import { describe, expect, it } from "vitest";
import {
  normalizeSmProfileDir,
  seatmeshCmd,
  seatmeshCmdTop,
  seatmeshProfileCmd,
  SEATMESH_DEFAULT,
} from "./cli-hints.js";

describe("cli-hints default profile omit", () => {
  it("agent cmds omit --profile .sm", () => {
    expect(SEATMESH_DEFAULT).toBe("seatmesh");
    expect(seatmeshCmd("whoami")).toBe("seatmesh agent whoami");
    expect(seatmeshCmd("")).toBe("seatmesh agent");
    expect(seatmeshCmdTop("inbox restart")).toBe("seatmesh inbox restart");
  });

  it("normalizeSmProfileDir accepts sm- / .sm- / bare", () => {
    expect(normalizeSmProfileDir("cpe")).toBe(".sm-cpe");
    expect(normalizeSmProfileDir("sm-cpe")).toBe(".sm-cpe");
    expect(normalizeSmProfileDir(".sm-cpe")).toBe(".sm-cpe");
    expect(normalizeSmProfileDir(".sm")).toBe(".sm");
  });

  it("seatmeshProfileCmd for multi-config", () => {
    expect(seatmeshProfileCmd("cpe", "agent whoami")).toBe(
      "seatmesh --profile .sm-cpe agent whoami",
    );
  });
});
