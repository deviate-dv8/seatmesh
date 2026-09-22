import { describe, expect, it } from "vitest";
import {
  BANNER_SINGLE_MIN_WIDTH,
  bannerNameFromMeta,
  bannerShouldUseTwoRow,
  compactBannerInbox,
  compactBannerTasks,
  fitBannerLine,
  formatBannerCheckbacks,
  formatBannerInbox,
  formatBannerTasks,
  meshBorderFormat,
  MESH_PANE_BORDER_FORMAT_ONE,
  MESH_PANE_BORDER_FORMAT_TWO,
} from "./borders.js";

describe("mesh banner format", () => {
  it("stays one row with a pipe before status (tmux drops format newlines)", () => {
    expect(bannerShouldUseTwoRow(47)).toBe(false);
    expect(bannerShouldUseTwoRow(BANNER_SINGLE_MIN_WIDTH - 1)).toBe(false);
    expect(meshBorderFormat(true)).toBe(MESH_PANE_BORDER_FORMAT_ONE);
    expect(meshBorderFormat(false)).toBe(MESH_PANE_BORDER_FORMAT_ONE);
    expect(MESH_PANE_BORDER_FORMAT_ONE).not.toContain("\n");
    expect(MESH_PANE_BORDER_FORMAT_ONE).toContain("#{@mesh_banner}");
    expect(MESH_PANE_BORDER_FORMAT_TWO).toBe(MESH_PANE_BORDER_FORMAT_ONE);
  });

  it("fits banner to pane width (compact then drop segments)", () => {
    const wide = {
      name: "manager",
      tasks: "tasks 3",
      inbox: "inbox 2 cb 1 wait",
      status: "BUSY",
    };
    expect(fitBannerLine(120, wide)).toBe(
      "manager  |  tasks 3  |  inbox 2 cb 1 wait  |  BUSY",
    );
    const mid = fitBannerLine(48, wide);
    expect(mid).toContain("t3");
    expect(mid).toContain("i2·1w");
    expect(mid.length).toBeLessThanOrEqual(48);
    const narrow = fitBannerLine(28, wide);
    expect(narrow.length).toBeLessThanOrEqual(28);
    expect(narrow).toContain("BUSY");
    expect(compactBannerTasks("tasks 3")).toBe("t3");
    expect(compactBannerInbox("inbox 2 cb 1 wait")).toBe("i2·1w");
  });

  it("includes kind when there's room", () => {
    const wide = {
      name: "manager",
      tasks: "tasks 3",
      inbox: "inbox 2 cb 1",
      kind: "opencode",
      status: "idle",
    };
    expect(fitBannerLine(120, wide)).toBe(
      "manager  |  opencode  |  tasks 3  |  inbox 2 cb 1  |  idle",
    );
  });

  it("omits kind cleanly when not provided (backward compatible)", () => {
    const wide = { name: "manager", tasks: "tasks 0", inbox: "inbox 0 cb 0", status: "idle" };
    expect(fitBannerLine(120, wide)).toBe("manager  |  tasks 0  |  inbox 0 cb 0  |  idle");
  });

  it("drops kind before tasks/inbox when the pane is too narrow for everything", () => {
    const wide = {
      name: "slot-3",
      tasks: "tasks 2",
      inbox: "inbox 1 cb 0",
      kind: "opencode-cpe",
      status: "BUSY",
    };
    // Wide enough for name+tasks+inbox+status but not the long kind id too.
    const line = fitBannerLine(30, wide);
    expect(line).not.toContain("opencode-cpe");
    expect(line).toContain("BUSY");
    expect(line.length).toBeLessThanOrEqual(30);
  });

  it("formats field labels", () => {
    expect(formatBannerTasks(3)).toBe("tasks 3");
    expect(formatBannerInbox(2)).toBe("inbox 2 cb 0");
    expect(formatBannerInbox(5, undefined, 0)).toBe("inbox 5 cb 0");
    expect(formatBannerInbox(2, "wait", 3)).toBe("inbox 2 cb 3 wait");
    expect(formatBannerCheckbacks(1)).toBe("cb 1");
    expect(bannerNameFromMeta({ role: "manager" })).toBe("manager");
    expect(bannerNameFromMeta({ role: "worker", slot: "3" })).toBe("slot-3");
    expect(bannerNameFromMeta({ role: "manager-mini", mini: "2" })).toBe("mini-2");
  });
});
