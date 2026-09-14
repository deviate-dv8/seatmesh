import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendImagesToMarkdown, mimeForImagePath } from "./mdview-publish.js";

describe("mimeForImagePath", () => {
  it("maps common image extensions", () => {
    expect(mimeForImagePath("a.PNG")).toBe("image/png");
    expect(mimeForImagePath("x.jpg")).toBe("image/jpeg");
    expect(mimeForImagePath("nope.txt")).toBeNull();
  });
});

describe("appendImagesToMarkdown", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-mdview-"));
  afterEach(() => {
    for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
  });

  it("embeds small png as data URI", () => {
    // 1x1 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const img = path.join(tmp, "dot.png");
    fs.writeFileSync(img, png);
    const { content, embedded, skipped } = appendImagesToMarkdown("# Hi", [img], {
      workspace: tmp,
    });
    expect(embedded).toHaveLength(1);
    expect(skipped).toHaveLength(0);
    expect(content).toContain("data:image/png;base64,");
    expect(content).toContain("## Images");
  });

  it("skips missing files", () => {
    const { skipped } = appendImagesToMarkdown("# Hi", ["missing.png"], { workspace: tmp });
    expect(skipped[0]?.reason).toMatch(/not found/);
  });
});
