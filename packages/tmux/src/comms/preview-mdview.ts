import fs from "node:fs";
import path from "node:path";
import { publishMdviewPublic, readMarkdownFile } from "@seat-mesh/core";
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

export async function publishOneMdview(
  workspace: string,
  file: string,
  days: number,
): Promise<PreviewMdviewFileResult> {
  try {
    const content = readMarkdownFile(workspace, file);
    const title = path.basename(file, path.extname(file));
    const published = await publishMdviewPublic({ title, content, expiresInDays: days });
    if (!published.ok) {
      return { file, ok: false, error: published.error };
    }
    return { file, ok: true, url: published.viewerUrl };
  } catch (e) {
    return { file, ok: false, error: (e as Error).message };
  }
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
    const row = await publishOneMdview(loaded.workspace, file, days);
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
