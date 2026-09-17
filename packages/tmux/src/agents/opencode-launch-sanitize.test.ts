import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/snapshot.js", () => ({
  capturePaneSnapshot: vi.fn(() => null),
}));

vi.mock("../lib/tmux-run.js", () => ({
  tmux: vi.fn(() => ({ out: "", status: 0 })),
}));

vi.mock("./agent-builder.js", () => ({
  buildAgentLaunchCmd: vi.fn(() => "opencode --auto"),
}));

import { sanitizeOpenCodeLaunchCmd } from "./opencode-launch-sanitize.js";

describe("sanitizeOpenCodeLaunchCmd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps cmd when no session id", () => {
    expect(
      sanitizeOpenCodeLaunchCmd("/ws", "mesh", "%1", "opencode --auto", "opencode"),
    ).toBe("opencode --auto");
  });

  it("returns null passthrough for empty cmd", () => {
    expect(sanitizeOpenCodeLaunchCmd("/ws", "mesh", "%1", null, "opencode")).toBeNull();
  });
});
