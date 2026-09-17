import { describe, expect, it } from "vitest";
import { hubActCardUrl, resolveHubBaseUrl } from "./hub-url.js";

describe("hub-url", () => {
  it("defaults to :3190", () => {
    const prevW = process.env.SEATMESH_WEB_URL;
    const prevH = process.env.SEATMESH_HUB_URL;
    delete process.env.SEATMESH_WEB_URL;
    delete process.env.SEATMESH_HUB_URL;
    expect(resolveHubBaseUrl()).toBe("http://127.0.0.1:3190");
    expect(hubActCardUrl("abc-123", 31737)).toBe(
      "http://127.0.0.1:3190/act/card/abc-123?port=31737",
    );
    if (prevW !== undefined) process.env.SEATMESH_WEB_URL = prevW;
    if (prevH !== undefined) process.env.SEATMESH_HUB_URL = prevH;
  });

  it("prefers SEATMESH_WEB_URL", () => {
    const prevW = process.env.SEATMESH_WEB_URL;
    const prevH = process.env.SEATMESH_HUB_URL;
    process.env.SEATMESH_WEB_URL = "http://127.0.0.1:3191/";
    process.env.SEATMESH_HUB_URL = "http://127.0.0.1:3190";
    expect(resolveHubBaseUrl()).toBe("http://127.0.0.1:3191");
    if (prevW !== undefined) process.env.SEATMESH_WEB_URL = prevW;
    else delete process.env.SEATMESH_WEB_URL;
    if (prevH !== undefined) process.env.SEATMESH_HUB_URL = prevH;
    else delete process.env.SEATMESH_HUB_URL;
  });
});
