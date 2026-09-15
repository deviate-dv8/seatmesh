import { describe, expect, it } from "vitest";
import {
  parseSwapTarget,
  patchMeshAgentsIdentity,
} from "./seat-swap.js";
import type { MeshAgents } from "@seat-mesh/core";

describe("parseSwapTarget", () => {
  it("accepts slot / worker / bare number", () => {
    expect(parseSwapTarget("slot-2")).toEqual({ kind: "worker", n: 2, label: "slot-2" });
    expect(parseSwapTarget("worker-3")).toEqual({ kind: "worker", n: 3, label: "slot-3" });
    expect(parseSwapTarget("1")).toEqual({ kind: "worker", n: 1, label: "slot-1" });
  });

  it("accepts mini forms", () => {
    expect(parseSwapTarget("mini-1")).toEqual({ kind: "mini", n: 1, label: "mini-1" });
    expect(parseSwapTarget("manager-mini-2")).toEqual({ kind: "mini", n: 2, label: "mini-2" });
  });

  it("rejects garbage", () => {
    expect(() => parseSwapTarget("manager")).toThrow(/want slot/);
  });
});

describe("patchMeshAgentsIdentity", () => {
  const base = (): MeshAgents =>
    ({
      schemaVersion: 1,
      session: "mesh-test",
      workdir: "/tmp",
      workers: [
        {
          slot: 1,
          type: "claude",
          name: "worker-1",
          resumeId: "aaa",
          resumeCmd: null,
          ports: "3010/3011",
        },
        {
          slot: 2,
          type: "opencode",
          name: "worker-2",
          resumeId: "bbb",
          resumeCmd: null,
          ports: "3020/3021",
        },
      ],
      minis: [
        {
          mini: 1,
          type: "opencode",
          name: "mini-1",
          role: "tester",
          task: "t1",
          resumeId: "m1",
          resumeCmd: null,
        },
        {
          mini: 2,
          type: "claude",
          name: "mini-2",
          role: "helper",
          task: "t2",
          resumeId: "m2",
          resumeCmd: null,
        },
      ],
      conventions: {
        secretaryDefaultCli: "opencode",
        miniDefaultCli: "opencode",
        launchSkipsEmpty: true,
      },
    }) as MeshAgents;

  it("swaps worker resume/type, keeps ports with slot number", () => {
    const next = patchMeshAgentsIdentity(base(), "worker", 1, 2);
    const w1 = next.workers.find((w) => w.slot === 1)!;
    const w2 = next.workers.find((w) => w.slot === 2)!;
    expect(w1.type).toBe("opencode");
    expect(w1.resumeId).toBe("bbb");
    expect(w1.ports).toBe("3010/3011");
    expect(w2.type).toBe("claude");
    expect(w2.resumeId).toBe("aaa");
    expect(w2.ports).toBe("3020/3021");
  });

  it("swaps mini role/task/resume", () => {
    const next = patchMeshAgentsIdentity(base(), "mini", 1, 2);
    const m1 = next.minis.find((m) => m.mini === 1)!;
    const m2 = next.minis.find((m) => m.mini === 2)!;
    expect(m1.role).toBe("helper");
    expect(m1.task).toBe("t2");
    expect(m1.resumeId).toBe("m2");
    expect(m2.role).toBe("tester");
    expect(m2.resumeId).toBe("m1");
  });
});
