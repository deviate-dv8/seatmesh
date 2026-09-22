import { describe, expect, it, vi } from "vitest";
import { createStepErrorLog } from "./step-isolation.js";

describe("createStepErrorLog", () => {
  describe("runStep (sync)", () => {
    it("returns fn's result on success, never logs", () => {
      const { runStep } = createStepErrorLog();
      const log = vi.fn();
      const result = runStep("ok-step", "fallback", () => "real-value", log);
      expect(result).toBe("real-value");
      expect(log).not.toHaveBeenCalled();
    });

    it("returns the fallback and logs once when fn throws", () => {
      const { runStep } = createStepErrorLog();
      const log = vi.fn();
      const result = runStep(
        "bad-step",
        "fallback",
        () => {
          throw new Error("boom");
        },
        log,
      );
      expect(result).toBe("fallback");
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]![0]).toContain('drain-tick step "bad-step" threw: boom');
    });

    it("a throwing step never prevents a later, unrelated step from running", () => {
      const { runStep } = createStepErrorLog();
      const log = vi.fn();
      const order: string[] = [];
      runStep(
        "step-a",
        undefined,
        () => {
          order.push("a-ran");
          throw new Error("a failed");
        },
        log,
      );
      runStep(
        "step-b",
        undefined,
        () => {
          order.push("b-ran");
        },
        log,
      );
      expect(order).toEqual(["a-ran", "b-ran"]);
    });

    it("throttles repeated logging for the same step label within the window", () => {
      const { runStep } = createStepErrorLog();
      const log = vi.fn();
      const fail = () => {
        throw new Error("persistent");
      };
      const realNow = Date.now;
      let now = 1_000_000;
      Date.now = () => now;
      try {
        runStep("persistent-step", undefined, fail, log);
        now += 5_000; // well within the 60s throttle window
        runStep("persistent-step", undefined, fail, log);
        now += 5_000;
        runStep("persistent-step", undefined, fail, log);
      } finally {
        Date.now = realNow;
      }
      expect(log).toHaveBeenCalledTimes(1);
    });

    it("logs again once the throttle window has passed", () => {
      const { runStep } = createStepErrorLog();
      const log = vi.fn();
      const fail = () => {
        throw new Error("persistent");
      };
      const realNow = Date.now;
      let now = 1_000_000;
      Date.now = () => now;
      try {
        runStep("persistent-step-2", undefined, fail, log);
        now += 61_000; // past the 60s throttle window
        runStep("persistent-step-2", undefined, fail, log);
      } finally {
        Date.now = realNow;
      }
      expect(log).toHaveBeenCalledTimes(2);
    });

    it("keeps independent throttle state per step label", () => {
      const { runStep } = createStepErrorLog();
      const log = vi.fn();
      const fail = () => {
        throw new Error("x");
      };
      runStep("label-a", undefined, fail, log);
      runStep("label-b", undefined, fail, log);
      expect(log).toHaveBeenCalledTimes(2);
    });
  });

  describe("runStepAsync", () => {
    it("returns fn's resolved value on success, never logs", async () => {
      const { runStepAsync } = createStepErrorLog();
      const log = vi.fn();
      const result = await runStepAsync("ok-async", "fallback", async () => "real-value", log);
      expect(result).toBe("real-value");
      expect(log).not.toHaveBeenCalled();
    });

    it("returns the fallback and logs once when fn rejects", async () => {
      const { runStepAsync } = createStepErrorLog();
      const log = vi.fn();
      const result = await runStepAsync(
        "bad-async",
        "fallback",
        async () => {
          throw new Error("async boom");
        },
        log,
      );
      expect(result).toBe("fallback");
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]![0]).toContain('drain-tick step "bad-async" threw: async boom');
    });

    it("a rejecting async step never prevents a later step from running", async () => {
      const { runStepAsync } = createStepErrorLog();
      const log = vi.fn();
      const order: string[] = [];
      await runStepAsync(
        "async-a",
        undefined,
        async () => {
          order.push("a-ran");
          throw new Error("a failed");
        },
        log,
      );
      await runStepAsync(
        "async-b",
        undefined,
        async () => {
          order.push("b-ran");
        },
        log,
      );
      expect(order).toEqual(["a-ran", "b-ran"]);
    });

    it("accepts a sync fn too (border-paint's real steps are a mix)", async () => {
      const { runStepAsync } = createStepErrorLog();
      const log = vi.fn();
      const result = await runStepAsync("sync-in-async", "fallback", () => "sync-value", log);
      expect(result).toBe("sync-value");
    });
  });

  it("sync and async step logs share the same throttle map per instance", () => {
    const { runStep, runStepAsync } = createStepErrorLog();
    const log = vi.fn();
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      runStep(
        "shared-label",
        undefined,
        () => {
          throw new Error("sync fail");
        },
        log,
      );
      void runStepAsync(
        "shared-label",
        undefined,
        () => {
          throw new Error("async fail");
        },
        log,
      );
    } finally {
      Date.now = realNow;
    }
    expect(log).toHaveBeenCalledTimes(1);
  });
});
