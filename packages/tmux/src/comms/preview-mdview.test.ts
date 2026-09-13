import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePreviewDays, publishOneMdview, runMeshPreview } from "./preview-mdview.js";
import type { LoadedProfile } from "@seat-mesh/core";

describe("parsePreviewDays", () => {
  it("accepts 1-30", () => {
    expect(parsePreviewDays("1")).toBe(1);
    expect(parsePreviewDays("7")).toBe(7);
    expect(parsePreviewDays("30")).toBe(30);
  });

  it("rejects out of range", () => {
    expect(parsePreviewDays("0")).toBeNull();
    expect(parsePreviewDays("31")).toBeNull();
    expect(parsePreviewDays("x")).toBeNull();
  });
});

describe("publishOneMdview", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-preview-"));
  afterEach(() => {
    for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
  });

  it("fails when file missing", () => {
    const r = publishOneMdview(tmp, "nope.md", 1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });

  it("fails when publish script missing", () => {
    const md = path.join(tmp, "a.md");
    fs.writeFileSync(md, "# hi\n");
    const r = publishOneMdview(tmp, md, 1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/publish-mdview/);
  });
});

describe("runMeshPreview", () => {
  const loaded = {
    workspace: os.tmpdir(),
    profile: { name: "test" },
  } as LoadedProfile;

  it("requires files", async () => {
    const r = await runMeshPreview(loaded, { files: [], days: 1 });
    expect(r.exitCode).toBe(2);
  });
});
