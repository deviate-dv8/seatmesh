import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { consumeTerminalBannerSlot } from "./banner.js";

describe("consumeTerminalBannerSlot", () => {
  let tmp = "";
  const prevCache = process.env.SEATMESH_BANNER_CACHE_DIR;
  const prevBanner = process.env.SEATMESH_BANNER;
  const prevPane = process.env.TMUX_PANE;

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (prevCache === undefined) delete process.env.SEATMESH_BANNER_CACHE_DIR;
    else process.env.SEATMESH_BANNER_CACHE_DIR = prevCache;
    if (prevBanner === undefined) delete process.env.SEATMESH_BANNER;
    else process.env.SEATMESH_BANNER = prevBanner;
    if (prevPane === undefined) delete process.env.TMUX_PANE;
    else process.env.TMUX_PANE = prevPane;
  });

  it("shows once per terminal then skips", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-banner-"));
    process.env.SEATMESH_BANNER_CACHE_DIR = tmp;
    delete process.env.SEATMESH_BANNER;
    process.env.TMUX_PANE = "%test-banner-once";

    expect(consumeTerminalBannerSlot()).toBe(true);
    expect(consumeTerminalBannerSlot()).toBe(false);
    expect(consumeTerminalBannerSlot()).toBe(false);
  });

  it("SEATMESH_BANNER=1 always shows; =0 never", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-banner-"));
    process.env.SEATMESH_BANNER_CACHE_DIR = tmp;
    process.env.TMUX_PANE = "%test-banner-force";

    process.env.SEATMESH_BANNER = "0";
    expect(consumeTerminalBannerSlot()).toBe(false);

    process.env.SEATMESH_BANNER = "1";
    expect(consumeTerminalBannerSlot()).toBe(true);
    expect(consumeTerminalBannerSlot()).toBe(true);
  });
});
