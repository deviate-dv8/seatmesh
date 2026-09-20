import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "@seat-mesh/core";
import {
  dropInKindsCachePath,
  isValidDropInProvider,
  loadDropInProviders,
  readDropInKindsCache,
  wrapDropInProvider,
  writeDropInKindsCache,
} from "./dropin.js";

function stubProvider(overrides: Partial<AgentProvider> = {}): AgentProvider {
  return {
    id: "stub",
    detect: () => ({ providerId: "stub" }),
    composerState: () => ({ phase: "empty" }),
    composerReady: () => true,
    injectPlan: () => ({ prefix: "", useBracketedPaste: true, enterDelayMs: 0, flushEscFirst: false }),
    sessionId: () => "ses_1",
    modelId: () => "stub-model",
    scrapePromptTurn: () => null,
    ...overrides,
  };
}

describe("isValidDropInProvider", () => {
  it("accepts a full AgentProvider shape", () => {
    expect(isValidDropInProvider(stubProvider())).toBe(true);
  });

  it("rejects a missing required method", () => {
    const bad = stubProvider();
    // @ts-expect-error deliberately breaking the shape
    delete bad.injectPlan;
    expect(isValidDropInProvider(bad)).toBe(false);
  });

  it("rejects a missing/blank id", () => {
    expect(isValidDropInProvider({ ...stubProvider(), id: "" })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isValidDropInProvider(null)).toBe(false);
    expect(isValidDropInProvider(undefined)).toBe(false);
    expect(isValidDropInProvider("stub")).toBe(false);
    expect(isValidDropInProvider(42)).toBe(false);
  });
});

describe("wrapDropInProvider", () => {
  it("passes through a working provider unchanged in behavior", () => {
    const wrapped = wrapDropInProvider(stubProvider(), () => {});
    expect(wrapped.detect({} as never)).toEqual({ providerId: "stub" });
    expect(wrapped.composerReady({} as never)).toBe(true);
  });

  it("a throwing method returns the safe fallback instead of propagating", () => {
    const logs: string[] = [];
    const provider = stubProvider({
      detect: () => {
        throw new Error("boom");
      },
    });
    const wrapped = wrapDropInProvider(provider, (l) => logs.push(l));
    expect(wrapped.detect({} as never)).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("stub.detect threw: boom");
  });

  it("other methods keep working when one method throws", () => {
    const provider = stubProvider({
      composerState: () => {
        throw new Error("composer boom");
      },
    });
    const wrapped = wrapDropInProvider(provider, () => {});
    expect(wrapped.composerState({} as never)).toEqual({ phase: "plain_shell" });
    expect(wrapped.composerReady({} as never)).toBe(true); // untouched method still fine
  });

  it("throttles repeat warnings for the same provider+method within the window", () => {
    const logs: string[] = [];
    const provider = stubProvider({
      detect: () => {
        throw new Error("boom");
      },
    });
    const wrapped = wrapDropInProvider(provider, (l) => logs.push(l));
    wrapped.detect({} as never);
    wrapped.detect({} as never);
    wrapped.detect({} as never);
    expect(logs).toHaveLength(1); // only the first call logged
  });

  it("omits humanDraft when the source provider didn't implement it", () => {
    const wrapped = wrapDropInProvider(stubProvider(), () => {});
    expect(wrapped.humanDraft).toBeUndefined();
  });

  it("wraps humanDraft too when the source provider implements it", () => {
    const provider = stubProvider({
      humanDraft: () => {
        throw new Error("draft boom");
      },
    });
    const wrapped = wrapDropInProvider(provider, () => {});
    expect(wrapped.humanDraft?.({} as never)).toBe("");
  });
});

describe("loadDropInProviders", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("returns empty when the directory doesn't exist", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-"));
    const missing = path.join(tmp, "does-not-exist");
    const result = await loadDropInProviders(missing);
    expect(result.providers).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("loads a valid provider and wraps it", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-"));
    fs.writeFileSync(
      path.join(tmp, "good.mjs"),
      `export default {
        id: "good-provider",
        detect: () => ({ providerId: "good-provider" }),
        composerState: () => ({ phase: "empty" }),
        composerReady: () => true,
        injectPlan: () => ({ prefix: "", useBracketedPaste: true, enterDelayMs: 0, flushEscFirst: false }),
        sessionId: () => undefined,
        modelId: () => undefined,
        scrapePromptTurn: () => null,
      };`,
    );
    const logs: string[] = [];
    const result = await loadDropInProviders(tmp, (l) => logs.push(l));
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.id).toBe("good-provider");
    expect(result.skipped).toEqual([]);
    expect(logs.some((l) => l.includes("loaded id=good-provider"))).toBe(true);
  });

  it("skips a file with an invalid shape, logs why, does not throw", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-"));
    fs.writeFileSync(path.join(tmp, "bad-shape.mjs"), `export default { id: "incomplete" };`);
    const result = await loadDropInProviders(tmp);
    expect(result.providers).toEqual([]);
    expect(result.skipped).toEqual([{ file: "bad-shape.mjs", reason: "default export does not match AgentProvider" }]);
  });

  it("skips a file with a syntax error, logs why, does not throw", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-"));
    fs.writeFileSync(path.join(tmp, "broken.mjs"), `export default { this is not valid js`);
    const result = await loadDropInProviders(tmp);
    expect(result.providers).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.file).toBe("broken.mjs");
  });

  it("skips a file that throws at module load time, does not throw", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-"));
    fs.writeFileSync(path.join(tmp, "throws-on-import.mjs"), `throw new Error("import-time boom");`);
    const result = await loadDropInProviders(tmp);
    expect(result.providers).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("import-time boom");
  });

  it("ignores non-.mjs files in the directory", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-"));
    fs.writeFileSync(path.join(tmp, "README.md"), "not a provider");
    fs.writeFileSync(path.join(tmp, "notes.txt"), "not a provider either");
    const result = await loadDropInProviders(tmp);
    expect(result.providers).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("loads multiple valid providers from the same directory", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-"));
    for (const id of ["alpha", "beta"]) {
      fs.writeFileSync(
        path.join(tmp, `${id}.mjs`),
        `export default {
          id: "${id}",
          detect: () => null,
          composerState: () => ({ phase: "empty" }),
          composerReady: () => false,
          injectPlan: () => ({ prefix: "", useBracketedPaste: false, enterDelayMs: 0, flushEscFirst: false }),
          sessionId: () => undefined,
          modelId: () => undefined,
          scrapePromptTurn: () => null,
        };`,
      );
    }
    const result = await loadDropInProviders(tmp);
    expect(result.providers.map((p) => p.id).sort()).toEqual(["alpha", "beta"]);
  });
});

describe("drop-in kinds cache (TODO 6.1c)", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("returns {} when no cache file exists", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-kinds-"));
    expect(readDropInKindsCache(tmp)).toEqual({});
  });

  it("round-trips a write then read", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-kinds-"));
    writeDropInKindsCache(tmp, { kimi: { provider: "kimi", launch: null } });
    expect(fs.existsSync(dropInKindsCachePath(tmp))).toBe(true);
    expect(readDropInKindsCache(tmp)).toEqual({ kimi: { provider: "kimi", launch: null } });
  });

  it("removes a stale cache file when writing an empty kinds map", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-kinds-"));
    writeDropInKindsCache(tmp, { kimi: { provider: "kimi" } });
    expect(fs.existsSync(dropInKindsCachePath(tmp))).toBe(true);
    writeDropInKindsCache(tmp, {});
    expect(fs.existsSync(dropInKindsCachePath(tmp))).toBe(false);
  });

  it("returns {} for a corrupt cache file instead of throwing", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-kinds-"));
    const file = dropInKindsCachePath(tmp);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not valid json");
    expect(readDropInKindsCache(tmp)).toEqual({});
  });

  it("never throws even when the runtime dir can't be created", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dropin-kinds-"));
    const blocker = path.join(tmp, "runtime");
    fs.writeFileSync(blocker, "x"); // a file where writeDropInKindsCache wants a dir
    expect(() => writeDropInKindsCache(tmp, { kimi: { provider: "kimi" } })).not.toThrow();
  });
});
