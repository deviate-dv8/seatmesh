import { describe, expect, it } from "vitest";
import {
  BANNER_SINGLE_MIN_WIDTH,
  bannerNameFromMeta,
  bannerShouldUseTwoRow,
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
    expect(MESH_PANE_BORDER_FORMAT_ONE).toContain("#{@mesh_inbox}  |  #{@mesh_status}");
    expect(MESH_PANE_BORDER_FORMAT_TWO).toBe(MESH_PANE_BORDER_FORMAT_ONE);
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
