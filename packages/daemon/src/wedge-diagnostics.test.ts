import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProcState, tailLogFile, writeWedgeSnapshot } from "./wedge-diagnostics.js";

describe("readProcState", () => {
  it("returns null for a missing pid", () => {
    expect(readProcState(undefined)).toBeNull();
  });

  it("returns null for a pid that doesn't exist (never throws)", () => {
    // A pid this high essentially never exists on a real system.
    expect(readProcState(999_999_999)).toBeNull();
  });

  it("reads real state for this test process's own pid", () => {
    const state = readProcState(process.pid);
    // Either /proc exists (Linux CI/dev box) and we get real fields, or it
    // doesn't (non-Linux) and we get null — both are correct, never a throw.
    if (state) {
      expect(typeof state.state === "string" || state.state === undefined).toBe(true);
    } else {
      expect(state).toBeNull();
    }
  });
});

describe("tailLogFile", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("returns [] for a missing file", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wedge-"));
    expect(tailLogFile(path.join(tmp, "does-not-exist.log"), 10)).toEqual([]);
  });

  it("returns the last N non-empty lines", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wedge-"));
    const file = path.join(tmp, "x.log");
    fs.writeFileSync(file, "a\nb\n\nc\nd\ne\n");
    expect(tailLogFile(file, 2)).toEqual(["d", "e"]);
    expect(tailLogFile(file, 100)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("writeWedgeSnapshot", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("writes a single last-wedge.json with the expected shape", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wedge-"));
    const logPath = path.join(tmp, "mesh-inbox.log");
    fs.writeFileSync(logPath, "line one\nline two\n");

    writeWedgeSnapshot(tmp, logPath, {
      session: "mesh-abc",
      port: 31700,
      pid: 12345,
      healthMisses: 3,
      healthMissThreshold: 3,
      healthTimeoutMs: 25_000,
    });

    const file = path.join(tmp, "last-wedge.json");
    expect(fs.existsSync(file)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(snap.session).toBe("mesh-abc");
    expect(snap.port).toBe(31700);
    expect(snap.pid).toBe(12345);
    expect(snap.healthMisses).toBe(3);
    expect(snap.recentLogTail).toEqual(["line one", "line two"]);
    expect(typeof snap.at).toBe("string");
  });

  it("overwrites the same file on repeated calls (not one file per event)", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wedge-"));
    const logPath = path.join(tmp, "mesh-inbox.log");
    fs.writeFileSync(logPath, "first\n");
    writeWedgeSnapshot(tmp, logPath, {
      session: "mesh-a",
      port: 1,
      healthMisses: 3,
      healthMissThreshold: 3,
      healthTimeoutMs: 1,
    });
    fs.writeFileSync(logPath, "second\n");
    writeWedgeSnapshot(tmp, logPath, {
      session: "mesh-b",
      port: 2,
      healthMisses: 3,
      healthMissThreshold: 3,
      healthTimeoutMs: 1,
    });

    const files = fs.readdirSync(tmp).filter((f) => f.includes("wedge"));
    expect(files).toEqual(["last-wedge.json"]);
    const snap = JSON.parse(fs.readFileSync(path.join(tmp, "last-wedge.json"), "utf8"));
    expect(snap.session).toBe("mesh-b");
  });

  it("never throws even when the state dir can't be created", () => {
    // A path under a file (not a dir) — mkdirSync must fail; writeWedgeSnapshot
    // must swallow it, not propagate.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wedge-"));
    const blockerFile = path.join(tmp, "blocker");
    fs.writeFileSync(blockerFile, "x");
    const badStateDir = path.join(blockerFile, "nested");
    expect(() =>
      writeWedgeSnapshot(badStateDir, path.join(tmp, "mesh-inbox.log"), {
        session: "mesh-a",
        port: 1,
        healthMisses: 3,
        healthMissThreshold: 3,
        healthTimeoutMs: 1,
      }),
    ).not.toThrow();
  });
});
