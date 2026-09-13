import { describe, expect, it } from "vitest";
import {
  parseAgentApplyArgs,
  preflightAgentBundle,
  serializeAgentApplyBundleYaml,
} from "./agent-apply.js";

describe("parseAgentApplyArgs", () => {
  it("parses balance + supervise + instruction", () => {
    const { bundle, opts } = parseAgentApplyArgs([
      "interval",
      "10m",
      "balance",
      "manager-2",
      "slot-5",
      "slot-6",
      "supervise",
      "manager-2",
      "slot-5",
      "slot-6",
      "instruction[0]",
      "big project hub",
    ]);
    expect(opts.assign).toBeFalsy();
    expect(bundle.balance[0]?.balanceLead).toBe("manager-2");
    expect(bundle.balance[0]?.balancees).toEqual(["slot-5", "slot-6"]);
    expect(bundle.balance[0]?.interval).toBe("10m");
    expect(bundle.supervise[0]?.supervisor).toBe("manager-2");
    expect(bundle.instructions[0]?.text).toBe("big project hub");
  });

  it("parses bracket member list", () => {
    const { bundle } = parseAgentApplyArgs(["supervise", "agent1", "[agent2,agent3]"]);
    expect(bundle.supervise[0]?.members).toEqual(["agent2", "agent3"]);
  });

  it("parses lead-first balance + supervise (operator sketch)", () => {
    const { bundle, opts } = parseAgentApplyArgs([
      "--main",
      "manager",
      "agent1",
      "balance",
      "slot-5",
      "slot-6",
      "interval",
      "10m",
      "agent1",
      "supervise",
      "slot-5",
      "slot-6",
      "no-inbound",
      "secretary",
      "from",
      "slot-5",
      "slot-6",
      "instruction[0]",
      "Project",
      "X",
      "hub",
      "instruction[1]",
      "slot-5",
      "slice",
    ]);
    expect(opts.dryRun).toBeFalsy();
    expect(bundle.mainLead).toBe("manager");
    expect(bundle.balance[0]?.balanceLead).toBe("agent1");
    expect(bundle.balance[0]?.balancees).toEqual(["slot-5", "slot-6"]);
    expect(bundle.supervise[0]?.supervisor).toBe("agent1");
    expect(bundle.traffic[0]?.denyInboundTo).toBe("secretary");
    expect(bundle.instructions).toHaveLength(2);
    expect(bundle.instructions[0]?.text).toBe("Project X hub");
    expect(bundle.instructions[1]?.text).toBe("slot-5 slice");
  });
});

describe("serializeAgentApplyBundleYaml", () => {
  it("emits snake_case active contract yaml", () => {
    const yaml = serializeAgentApplyBundleYaml(
      {
        mainLead: "manager",
        supervise: [{ supervisor: "agent1", members: ["slot-5"], interval: "10m" }],
        balance: [],
        traffic: [],
        instructions: [{ index: 0, text: "brief" }],
      },
      "apply-testid",
    );
    expect(yaml).toContain("id: apply-testid");
    expect(yaml).toContain("main_lead: manager");
    expect(yaml).toContain("supervisor: agent1");
    expect(yaml).toContain("interval: 10m");
  });
});

describe("preflightAgentBundle", () => {
  it("flags HIGH when many bindings", () => {
    const map = new Map([["manager-2", ["supervise", "balance"]]]);
    const rows = preflightAgentBundle(
      {
        mainLead: "manager",
        supervise: [{ supervisor: "manager-2", members: ["slot-5"] }],
        balance: [
          {
            balanceLead: "manager-2",
            balancees: ["slot-5"],
            mainLead: "manager",
          },
        ],
        traffic: [],
        instructions: [],
      },
      map,
    );
    const m2 = rows.find((r) => r.agentId === "manager-2");
    expect(m2?.load).toBe("HIGH");
  });
});
