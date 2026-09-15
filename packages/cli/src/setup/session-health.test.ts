import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProfile, meshRuntimePaths } from "@seat-mesh/core";
import { runInit } from "./init.js";
import { runSessionCheck, runSessionRepair } from "./session-health.js";

describe("session-health", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("check passes on fresh init + repair; detects deleted daemon ledger", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-health-"));
    runInit({ workspace: tmp, name: "health" });
    const loaded = loadProfile(path.join(tmp, ".sm"));

    // Seats + version not always present right after init — repair first.
    const repaired = runSessionRepair(loaded, { sync: false, skipInbox: true });
    expect(repaired.check.ok).toBe(true);

    const peer = meshRuntimePaths(loaded).peerJsonl;
    expect(fs.existsSync(peer)).toBe(true);
    fs.unlinkSync(peer);

    const afterDelete = runSessionCheck(loaded);
    expect(afterDelete.ok).toBe(true); // ledger missing = warn, not fail
    expect(afterDelete.findings.some((f) => f.id === "ledger-peer" && f.severity === "warn")).toBe(
      true,
    );

    const again = runSessionRepair(loaded, { sync: false, skipInbox: true });
    expect(fs.existsSync(peer)).toBe(true);
    expect(again.check.findings.some((f) => f.id === "ledger-peer" && f.severity === "warn")).toBe(
      false,
    );
  });

  it("check fails when GATE-QUEUE deleted; repair restores", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-health-gq-"));
    runInit({ workspace: tmp, name: "gq" });
    const loaded = loadProfile(path.join(tmp, ".sm"));
    runSessionRepair(loaded, { sync: false, skipInbox: true });

    const gq = meshRuntimePaths(loaded).gateQueue;
    fs.unlinkSync(gq);
    const bad = runSessionCheck(loaded);
    expect(bad.ok).toBe(false);
    expect(bad.findings.some((f) => f.id === "gate-queue" && f.severity === "fail")).toBe(true);

    const fixed = runSessionRepair(loaded, { sync: false, skipInbox: true });
    expect(fs.existsSync(gq)).toBe(true);
    expect(fixed.check.ok).toBe(true);
  });
});
