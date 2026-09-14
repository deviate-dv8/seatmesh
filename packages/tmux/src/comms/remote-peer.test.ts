import { describe, expect, it, vi } from "vitest";
import { resolveAgentId } from "@seat-mesh/core";

vi.mock("../agents/whoami.js", () => ({ runWhoami: vi.fn() }));
vi.mock("../lib/pane-meta.js", () => ({ paneMetaForPane: vi.fn() }));
vi.mock("../lib/resolve-pane.js", () => ({ resolvePaneTarget: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: vi.fn(() => ({ status: 0, stdout: '{"ok":true}' })) }));

import {
  parseRemotePeerTarget,
  buildRemoteFromAgent,
  buildRemoteFromToHeader,
} from "./remote-peer.js";

describe("parseRemotePeerTarget", () => {
  it("parses @alias:seat", () => {
    expect(parseRemotePeerTarget("@zsign:manager")).toEqual({
      alias: "zsign",
      seat: "manager",
    });
    expect(parseRemotePeerTarget("@dev:slot-1")).toEqual({
      alias: "dev",
      seat: "slot-1",
    });
  });

  it("returns null for local targets", () => {
    expect(parseRemotePeerTarget("manager")).toBeNull();
    expect(parseRemotePeerTarget("slot-1")).toBeNull();
  });
});

describe("buildRemoteFromAgent", () => {
  it("does not duplicate manager when slotLabel is also manager", () => {
    expect(
      buildRemoteFromAgent("zsign", {
        role: "manager",
        slot: null,
        slotLabel: "manager",
        mini: null,
      }),
    ).toBe("zsign:manager");
    expect(resolveAgentId({ role: "manager", slot: null })).toBe("manager");
  });
});

describe("buildRemoteFromToHeader", () => {
  it("matches local peer from/to convention", () => {
    expect(
      buildRemoteFromToHeader(
        "zsign",
        { role: "manager", slot: null, mini: null },
        "seatmesh",
        "manager",
      ),
    ).toBe("[from:zsign:manager to:seatmesh:manager] ");
    expect(
      buildRemoteFromToHeader(
        "zsign",
        { role: "worker", slot: 2, mini: null },
        "seatmesh",
        "slot-2",
      ),
    ).toBe("[from:zsign:worker-2 to:seatmesh:slot-2] ");
  });
});
