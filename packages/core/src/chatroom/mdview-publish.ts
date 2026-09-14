import fs from "node:fs";
import path from "node:path";

const MDVIEW_PUBLISH = "https://mdview.io/api/public/publish";

export interface MdviewPublishOk {
  ok: true;
  title: string;
  viewerUrl: string;
  shareUrl: string;
  markdownUrl: string;
  shortId: string;
  expiresAt?: string;
}

export interface MdviewPublishFail {
  ok: false;
  error: string;
}

export type MdviewPublishResult = MdviewPublishOk | MdviewPublishFail;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/** Max bytes per embedded image (data URI). */
export const MDVIEW_IMAGE_MAX_BYTES = 1_500_000;

export function mimeForImagePath(filePath: string): string | null {
  return MIME[path.extname(filePath).toLowerCase()] ?? null;
}

/**
 * Embed local images as markdown data-URI figures (mdview renders them).
 * Skips missing / oversized / unknown types with a note line.
 */
export function appendImagesToMarkdown(
  markdown: string,
  imagePaths: string[],
  opts: { workspace?: string; maxBytes?: number } = {},
): { content: string; embedded: string[]; skipped: { path: string; reason: string }[] } {
  const max = opts.maxBytes ?? MDVIEW_IMAGE_MAX_BYTES;
  const ws = opts.workspace ?? process.cwd();
  const embedded: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const blocks: string[] = [];

  for (const raw of imagePaths) {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(ws, raw);
    const mime = mimeForImagePath(abs);
    if (!mime) {
      skipped.push({ path: raw, reason: "unsupported image type" });
      continue;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      skipped.push({ path: raw, reason: "file not found" });
      continue;
    }
    const buf = fs.readFileSync(abs);
    if (buf.length > max) {
      skipped.push({ path: raw, reason: `too large (>${max} bytes)` });
      continue;
    }
    const b64 = buf.toString("base64");
    const alt = path.basename(abs);
    blocks.push(`![${alt}](data:${mime};base64,${b64})`);
    embedded.push(abs);
  }

  let content = markdown.trimEnd();
  if (blocks.length) {
    content += `\n\n## Images\n\n${blocks.join("\n\n")}\n`;
  }
  if (skipped.length) {
    content += `\n\n<!-- skipped images: ${skipped.map((s) => `${s.path} (${s.reason})`).join("; ")} -->\n`;
  }
  return { content, embedded, skipped };
}

/** Anonymous mdview publish — no token, 1–30 day expiry. */
export async function publishMdviewPublic(input: {
  title: string;
  content: string;
  expiresInDays?: number;
}): Promise<MdviewPublishResult> {
  const title = input.title.trim() || "seatmesh";
  const content = input.content;
  if (!content.trim()) return { ok: false, error: "empty markdown" };
  const days = Math.min(30, Math.max(1, Number(input.expiresInDays ?? 7) || 7));

  try {
    const res = await fetch(MDVIEW_PUBLISH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, expiresInDays: days }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { ok: false, error: `mdview bad JSON (${res.status})` };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: String(json.error ?? json.message ?? `mdview HTTP ${res.status}`),
      };
    }
    const viewerUrl = String(json.viewerUrl ?? json.shareUrl ?? "").trim();
    if (!viewerUrl) return { ok: false, error: "mdview response missing viewerUrl" };
    return {
      ok: true,
      title,
      viewerUrl,
      shareUrl: String(json.shareUrl ?? viewerUrl),
      markdownUrl: String(json.markdownUrl ?? `${viewerUrl}.md`),
      shortId: String(json.shortId ?? ""),
      expiresAt: json.expiresAt != null ? String(json.expiresAt) : undefined,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "mdview publish failed" };
  }
}

export function readMarkdownFile(workspace: string, file: string): string {
  const abs = path.isAbsolute(file) ? file : path.resolve(workspace, file);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`markdown file not found: ${file}`);
  }
  return fs.readFileSync(abs, "utf8");
}
