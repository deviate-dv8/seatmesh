import { describe, expect, it } from "vitest";
import { seatAgentEntry, seatIdFromPaneRow } from "./agents-state.js";
import type { PaneRow } from "../lib/resolve-pane.js";

describe("seatAgentEntry", () => {
  const loaded = {
    workspace: "/tmp/ws",
    workspaceId: "ws",
    sessionName: "mesh-test",
    profileDir: "/tmp/ws/.sm",
    profile: {
      layout: { base: { columns: ["manager", "secretary"], kinds: {} } },
    },
  } as never;

  it("maps pane row to seat id", () => {
    expect(seatIdFromPaneRow({ role: "secretary" } as PaneRow)).toBe("secretary");
    expect(seatIdFromPaneRow({ role: "manager-2", mini: "", slot: "" } as PaneRow)).toBe(
      "manager-2",
    );
    expect(seatIdFromPaneRow({ role: "manager-mini", mini: "3", slot: "" } as PaneRow)).toBe(
      "mini-3",
    );
    expect(seatIdFromPaneRow({ role: "worker", slot: "2", mini: "" } as PaneRow)).toBe("slot-2");
  });

  it("reads secretary mesh entry generically", () => {
    const state = {
      panes: [],
      secretary: {
        type: "oc-proxy",
        resume_id: "ses_abc",
        resume_cmd: "cd /ws && scripts/opencode-cpe.sh --session ses_abc",
      },
    };
    const entry = seatAgentEntry(loaded, "secretary", state, null);
    expect(entry?.type).toBe("oc-proxy");
    expect(entry?.resume_cmd).toContain("opencode-cpe");
  });

  it("reads coord column from coords map", () => {
    const state = {
      panes: [],
      coords: {
        "manager-2": {
          type: "claude",
          resume_id: "rid",
          resume_cmd: "claude --resume rid",
        },
      },
    };
    const entry = seatAgentEntry(loaded, "manager-2", state, null);
    expect(entry?.type).toBe("claude");
    expect(entry?.role).toBe("manager-2");
  });
});
