import { describe, expect, it } from "vitest";
import { extractMermaidBlocks, validateMermaidInMarkdown } from "./mermaid-validate.js";

describe("extractMermaidBlocks", () => {
  it("finds fences with line numbers", () => {
    const md = ["# Hi", "", "```mermaid", "flowchart TB", "  A-->B", "```", ""].join("\n");
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.startLine).toBe(3);
    expect(blocks[0]!.text).toContain("flowchart TB");
  });
});

describe("validateMermaidInMarkdown", () => {
  it("accepts valid diagrams", async () => {
    const md = "```mermaid\nflowchart LR\n  A-->B\n```";
    const r = await validateMermaidInMarkdown(md);
    expect(r.ok).toBe(true);
    expect(r.blocks).toBe(1);
  });

  it("rejects broken diagrams with fix hint", async () => {
    const md = ["Intro", "", "```mermaid", "flowchart TB", "  A--", "```"].join("\n");
    const r = await validateMermaidInMarkdown(md);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/mermaid broken/i);
    expect(r.message).toMatch(/near line 3/);
    expect(r.message).toMatch(/A--/);
  });

  it("skips when no mermaid fences", async () => {
    const r = await validateMermaidInMarkdown("## just text");
    expect(r.ok).toBe(true);
    expect(r.blocks).toBe(0);
  });
});
