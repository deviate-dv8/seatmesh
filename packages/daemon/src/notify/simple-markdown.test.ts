import { describe, expect, it } from "vitest";
import { renderSimpleMarkdown } from "./simple-markdown.js";

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
});
