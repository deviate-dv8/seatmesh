import { describe, expect, it } from "vitest";
import { markdownNeedsMermaid, renderSimpleMarkdown } from "./simple-markdown.js";

describe("renderSimpleMarkdown", () => {
  it("renders headings lists and bold", () => {
    const html = renderSimpleMarkdown("## Hi\n\n- one\n- two\n\n**bold** ok");
    expect(html).toContain("<h2>Hi</h2>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders data-uri images", () => {
    const html = renderSimpleMarkdown("![x](data:image/png;base64,aaa)");
    expect(html).toContain('<img src="data:image/png;base64,aaa"');
  });

  it("renders [label](url) as clickable anchors", () => {
    const html = renderSimpleMarkdown(
      "## Handout\n\n[Click here](https://mdview.io/s/pa62ed135)",
    );
    expect(html).toContain('<a href="https://mdview.io/s/pa62ed135"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain(">Click here</a>");
    expect(html).not.toContain("[Click here]");
  });

  it("renders fenced mermaid as pre.mermaid (not smashed into a paragraph)", () => {
    const md = ["# Arch", "", "```mermaid", "flowchart TB", "  A-->B", "```", ""].join("\n");
    const html = renderSimpleMarkdown(md);
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain("flowchart TB");
    expect(html).toContain("A--&gt;B");
    expect(html).not.toMatch(/<p>```mermaid/);
  });

  it("renders GFM tables", () => {
    const html = renderSimpleMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("does not double-wrap markdown links", () => {
    const html = renderSimpleMarkdown("[x](https://example.com/a)");
    expect(html.match(/<a /g)?.length).toBe(1);
  });
});

describe("markdownNeedsMermaid", () => {
  it("detects mermaid fences", () => {
    expect(markdownNeedsMermaid("```mermaid\nA-->B\n```")).toBe(true);
    expect(markdownNeedsMermaid("```js\n1\n```")).toBe(false);
  });
});
