import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetCliTypesCacheForTests,
  completeArgv,
  listTopLevelCompletionWords,
  normalizeCompletionWords,
} from "./completion.js";
import { runInit } from "../setup/init.js";

describe("completion", () => {
  it("lists top-level verbs including aliases and completion", () => {
    const w = listTopLevelCompletionWords();
    expect(w).toContain("peer");
    expect(w).toContain("whoami");
    expect(w).toContain("get"); // alias of hub
    expect(w).toContain("completion");
    expect(w).toContain("--profile");
  });

  it("strips npx seatmesh wrappers", () => {
    expect(normalizeCompletionWords(["npx", "seatmesh", "peer"])).toEqual(["peer"]);
    expect(normalizeCompletionWords(["npx", "--yes", "seatmesh", "agent"])).toEqual(["agent"]);
    expect(normalizeCompletionWords(["seatmesh", "--profile", ".sm", "help"])).toEqual(["help"]);
  });

  it("completes top-level prefix", () => {
    const hits = completeArgv(["seatmesh", "pee"], 1);
    expect(hits).toContain("peer");
    expect(hits.every((h) => h.startsWith("pee"))).toBe(true);
  });

  it("completes agent subverbs", () => {
    const hits = completeArgv(["seatmesh", "agent", "who"], 2);
    expect(hits).toContain("whoami");
  });

  it("completes switch cli types after target", () => {
    const hits = completeArgv(["seatmesh", "switch", "slot-1", "op"], 3);
    expect(hits).toContain("opencode");
  });

  it("completes hub entities", () => {
    const hits = completeArgv(["seatmesh", "hub", "to"], 2);
    expect(hits).toContain("todos");
  });

  it("completes after npx seatmesh", () => {
    const hits = completeArgv(["npx", "seatmesh", "ses"], 2);
    expect(hits).toContain("session");
    expect(hits).toContain("sessions");
  });

  describe("profile-aware cli types (TODO 6.3)", () => {
    let tmp = "";
    const originalCwd = process.cwd();

    afterEach(() => {
      process.chdir(originalCwd);
      __resetCliTypesCacheForTests();
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      tmp = "";
    });

    it("switch <target> <TAB> includes a custom agents.kinds overlay id", () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-completion-"));
      const { configPath } = runInit({ workspace: tmp, name: "completion-test" });
      const doc = YAML.parse(fs.readFileSync(configPath, "utf8"));
      doc.agents = { ...doc.agents, kinds: { "my-oc": { extends: "opencode" } } };
      fs.writeFileSync(configPath, YAML.stringify(doc));

      process.chdir(tmp);
      __resetCliTypesCacheForTests();
      const hits = completeArgv(["seatmesh", "switch", "slot-1", "my"], 3);
      expect(hits).toContain("my-oc");
    });

    it("falls back to the builtin list outside any .sm/ workspace", () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-completion-none-"));
      process.chdir(tmp);
      __resetCliTypesCacheForTests();
      const hits = completeArgv(["seatmesh", "switch", "slot-1", "op"], 3);
      expect(hits).toContain("opencode");
      expect(hits).not.toContain("my-oc");
    });
  });
});
