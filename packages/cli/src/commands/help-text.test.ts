import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  listHelpEntries,
  listHelpVerbs,
  printCmdHelp,
  renderCliVerbMarkdown,
  renderCommandsMarkdown,
  resolveHelpVerb,
  wantsCmdHelp,
} from "./help-text.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("help-text", () => {
  it("resolves aliases", () => {
    expect(resolveHelpVerb("get")).toBe("hub");
    expect(resolveHelpVerb("checkback")).toBe("cb");
    expect(resolveHelpVerb("handoff")).toBe("switch");
  });

  it("detects --help / help subcommand", () => {
    expect(wantsCmdHelp(["whoami", "--help"])).toBe(true);
    expect(wantsCmdHelp(["peer", "help"])).toBe(true);
    expect(wantsCmdHelp(["launch", "-h"])).toBe(true);
    expect(wantsCmdHelp(["peer", "manager", "hi"])).toBe(false);
  });

  it("prints known verbs without throwing", () => {
    const verbs = ["whoami", "peer", "hub", "ack", "cb", "update", "swap"];
    for (const v of verbs) {
      expect(printCmdHelp(v)).toBe(true);
    }
    expect(printCmdHelp("not-a-real-cmd-xyz")).toBe(false);
  });

  it("covers core agent surface", () => {
    const set = new Set(listHelpVerbs());
    for (const v of [
      "whoami",
      "hub",
      "ack",
      "cb",
      "peer",
      "room",
      "chat",
      "seat",
      "notify",
      "contexts",
      "help",
      "agent",
    ]) {
      expect(set.has(v)).toBe(true);
    }
  });

  it("docs/COMMANDS.md and docs/cli/*.md stay in sync with help-text", () => {
    const catalog = path.join(repoRoot, "docs/COMMANDS.md");
    const cliDir = path.join(repoRoot, "docs/cli");
    expect(fs.existsSync(catalog), "run: npm run gen:commands").toBe(true);
    expect(fs.readFileSync(catalog, "utf8")).toBe(renderCommandsMarkdown());

    for (const { verb } of listHelpEntries()) {
      const p = path.join(cliDir, `${verb}.md`);
      expect(fs.existsSync(p), `missing docs/cli/${verb}.md — run npm run gen:commands`).toBe(
        true,
      );
      expect(fs.readFileSync(p, "utf8")).toBe(renderCliVerbMarkdown(verb));
    }

    // Every ## verb header is greppable
    const headings = [...fs.readFileSync(catalog, "utf8").matchAll(/^## (\S+)$/gm)].map(
      (m) => m[1],
    );
    for (const { verb } of listHelpEntries()) {
      expect(headings).toContain(verb);
    }
  });
});
