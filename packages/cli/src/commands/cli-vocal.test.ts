import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printAgentForum } from "./agent-forum.js";
import { printCmdHelp, resolveHelpVerb, listHelpVerbs } from "./help-text.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const bin = path.join(repoRoot, "bin/seatmesh");

describe("cli vocal + shorthand coverage", () => {
  it("help covers spawn, rebuild, forum", () => {
    const verbs = new Set(listHelpVerbs());
    expect(verbs.has("spawn")).toBe(true);
    expect(verbs.has("rebuild") || resolveHelpVerb("rebuild") === "reload").toBe(true);
    expect(printCmdHelp("spawn")).toBe(true);
    expect(printCmdHelp("forum")).toBe(true);
    expect(printCmdHelp("reload")).toBe(true);
  });

  it("spawn help mentions fast + ranges", () => {
    const r = spawnSync(bin, ["help", "spawn"], { encoding: "utf8", cwd: repoRoot });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/--fast/);
    expect(r.stdout).toMatch(/1\.\.4|ranges/i);
  });

  it("rebuild aliases to reload help", () => {
    expect(resolveHelpVerb("rebuild")).toBe("reload");
    const r = spawnSync(bin, ["help", "rebuild"], { encoding: "utf8", cwd: repoRoot });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/npm build|labels/i);
  });

  it("forum table prints Ruby ranges + no bash", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    };
    try {
      printAgentForum();
    } finally {
      console.log = orig;
    }
    const body = lines.join("\n");
    expect(body).toMatch(/1\.\.4/);
    expect(body).toMatch(/peer 1\.\.4/);
    expect(body).toMatch(/spawn/);
    expect(body).toMatch(/NOT synonym soup|Ruby ranges/i);
  });

  it("agent forum exits 0", () => {
    const r = spawnSync(bin, ["agent", "forum"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: { ...process.env, TMUX: "", TMUX_PANE: "" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/1\.\.4/);
  });
});
