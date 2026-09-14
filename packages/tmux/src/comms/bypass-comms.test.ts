import { describe, expect, it, vi, afterEach } from "vitest";
import type { LoadedProfile } from "@seat-mesh/core";
import { isInboxUp, warnBypassComms } from "./bypass-comms.js";

vi.mock("./inbox-bridge.js", () => ({
  meshInboxPort: () => 9901,
  probeInbox: vi.fn(),
}));

import { probeInbox } from "./inbox-bridge.js";

const loaded = {} as LoadedProfile;

describe("warnBypassComms", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs WARN to stderr with target and history note", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    warnBypassComms("slot-2", "from worker-1");
    expect(err).toHaveBeenCalledWith(
      "WARN: bypass comms -> slot-2 (from worker-1) — inbox unavailable; direct inject only, NOT saved to peer history",
    );
  });
});

describe("isInboxUp", () => {
  afterEach(() => {
    vi.mocked(probeInbox).mockReset();
  });

  it("returns true when probe is healthy", () => {
    vi.mocked(probeInbox).mockReturnValue("healthy");
    expect(isInboxUp(loaded)).toBe(true);
  });

  it("returns false when probe is down or wedged", () => {
    vi.mocked(probeInbox).mockReturnValue("down");
    expect(isInboxUp(loaded)).toBe(false);
    vi.mocked(probeInbox).mockReturnValue("wedged");
    expect(isInboxUp(loaded)).toBe(false);
  });
});
