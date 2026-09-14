import { describe, expect, it } from "vitest";
import {
  decideAgentDispatch,
  stripAgentFromArgv,
  type AgentDispatchDecision,
} from "./agent-dispatch.js";
import type { WhoamiResult } from "./whoami.js";

function w(role: string): WhoamiResult {
  return {
    inTmux: true,
    paneId: "%1",
    session: "mesh",
    window: "base",
    role,
    slot: role === "worker" ? 1 : null,
    slotLabel: role === "worker" ? "slot-1" : role || null,
    ports: null,
    profile: "minimal",
    workspace: "/tmp",
  };
}

function kind(d: AgentDispatchDecision): string {
  return d.kind;
}

describe("decideAgentDispatch", () => {
  it("allows shared whoami for every role", () => {
    for (const role of ["manager", "secretary", "worker", "mini", "plain"]) {
      expect(kind(decideAgentDispatch(w(role), "whoami", []))).toBe("allow");
    }
  });

  it("allows kind/what/typeof for every role", () => {
    for (const role of ["manager", "secretary", "worker", "mini"]) {
      for (const verb of ["kind", "what", "typeof"]) {
        expect(kind(decideAgentDispatch(w(role), verb, ["slot-1"]))).toBe("allow");
      }
    }
  });

  it("denies mini spawn for worker", () => {
    const d = decideAgentDispatch(w("worker"), "mini", ["spawn", "x"]);
    expect(d).toMatchObject({ kind: "deny", verb: "mini", guardRole: "worker" });
  });

  it("unknown verb is unknown (UNAUTHORIZED path)", () => {
    const d = decideAgentDispatch(w("secretary"), "illegal-command", []);
    expect(d).toMatchObject({ kind: "unknown", verb: "illegal-command" });
  });

  it("operator verbs stay outside agent", () => {
    expect(decideAgentDispatch(w("manager"), "session", ["up"])).toMatchObject({
      kind: "operator",
      verb: "session",
    });
  });

  it("bare role name with no args is card-target", () => {
    expect(decideAgentDispatch(w("manager"), "secretary", [])).toMatchObject({
      kind: "card-target",
      target: "secretary",
    });
  });

  it("secretary status dispatches", () => {
    expect(kind(decideAgentDispatch(w("secretary"), "secretary", ["status"]))).toBe("allow");
  });

  it("worker peer allowed", () => {
    expect(kind(decideAgentDispatch(w("worker"), "peer", ["manager", "hi"]))).toBe("allow");
  });
});

describe("stripAgentFromArgv", () => {
  it("removes agent after --profile", () => {
    const out = stripAgentFromArgv([
      "node",
      "seatmesh",
      "--profile",
      ".sm",
      "agent",
      "peer",
      "secretary",
      "hi",
    ]);
    expect(out.slice(2)).toEqual(["--profile", ".sm", "peer", "secretary", "hi"]);
  });
});
