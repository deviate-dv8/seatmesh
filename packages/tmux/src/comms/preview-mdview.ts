import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LoadedProfile } from "@seat-mesh/core";
import { runMeshNotify } from "./notify-operator.js";

export function parsePreviewDays(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 30) return null;
  return n;
}

export interface PreviewMdviewInput {
  files: string[];
  days: number;
  notify?: boolean;
}

export interface PreviewMdviewFileResult {
  file: string;
  ok: boolean;
  url?: string;
  error?: string;
}

export interface PreviewMdviewResult {
  results: PreviewMdviewFileResult[];
  exitCode: number;
}

function resolveMarkdownFile(workspace: string, file: string): string {
  const abs = path.isAbsolute(file) ? file : path.resolve(workspace, file);
  return abs;
}

export function publishOneMdview(
  workspace: string,
  file: string,
  days: number,
): PreviewMdviewFileResult {
  const abs = resolveMarkdownFile(workspace, file);
  if (!fs.existsSync(abs)) {
    return { file, ok: false, error: "file not found" };
  }
  if (!fs.statSync(abs).isFile()) {
    return { file, ok: false, error: "not a file" };
  }

  const script = path.join(workspace, "scripts/publish-mdview.sh");
  if (!fs.existsSync(script)) {
    return { file, ok: false, error: "scripts/publish-mdview.sh missing in workspace" };
  }

  const title = path.basename(abs, path.extname(abs));
  const r = spawnSync("bash", [script, abs, title, String(days)], {
    encoding: "utf8",
    cwd: workspace,
    timeout: 120_000,
  });

  const url = (r.stdout ?? "").trim().split("\n").find((line) => line.startsWith("http")) ?? "";
  if (r.status !== 0 || !url) {
    const detail = (r.stderr ?? "").trim() || (r.stdout ?? "").trim();
    return {
      file,
      ok: false,
      error: detail ? detail.split("\n")[0] : "mdview publish failed",
    };
  }

  return { file, ok: true, url };
}

export async function runMeshPreview(
  loaded: LoadedProfile,
  input: PreviewMdviewInput,
): Promise<PreviewMdviewResult> {
  const results: PreviewMdviewFileResult[] = [];

  if (!input.files.length) {
    return {
      results: [{ file: "-", ok: false, error: "need at least one file.md" }],
      exitCode: 2,
    };
  }

  const days = input.days;
  if (parsePreviewDays(String(days)) == null) {
    return {
      results: [{ file: "-", ok: false, error: "expiresInDays must be 1-30" }],
      exitCode: 2,
    };
  }

  for (const file of input.files) {
    const row = publishOneMdview(loaded.workspace, file, days);
    results.push(row);

    if (row.ok && row.url && input.notify) {
      const session = path.basename(file, path.extname(file));
      const notify = await runMeshNotify(loaded, {
        session: `mdview: ${session}`,
        check: "Open mdview preview link",
        url: row.url,
      });
      if (!notify.ok) {
        row.error = `published but notify failed: ${notify.error}`;
      }
    }
  }

  const anyOk = results.some((r) => r.ok);
  const anyFail = results.some((r) => !r.ok);
  const exitCode = anyFail && !anyOk ? 1 : anyFail ? 1 : 0;
  return { results, exitCode };
}
