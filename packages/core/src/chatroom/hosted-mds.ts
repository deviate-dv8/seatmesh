/**
 * Local Hosted MDs — agents drop `.md` under `.sm/mds/`; hub `/mds` lists + renders.
 * No mdview.io republish — files are live as soon as they exist on disk.
 */
import fs from "node:fs";
import path from "node:path";
import type { LoadedProfile } from "../profile/profile.js";
import { defaultHubOrigin } from "../runtime/hub-url.js";

export { defaultHubOrigin, resolveHubBaseUrl } from "../runtime/hub-url.js";
export { hubActCardUrl } from "../runtime/hub-url.js";

export const HOSTED_MDS_DIRNAME = "mds";

export interface HostedMdItem {
  /** Path relative to `.sm/mds/` using `/` (no leading slash). */
  slug: string;
  title: string;
  /** Absolute path on disk. */
  absPath: string;
  mtimeMs: number;
  when: string;
  mesh: string;
  workspace: string;
  profileDir: string;
  /** Hub path: /mds/:sessionId/:slug */
  hubPath: string;
}

export function hostedMdsDir(loaded: LoadedProfile): string {
  return path.join(loaded.profileDir, HOSTED_MDS_DIRNAME);
}

export function ensureHostedMdsDir(loaded: LoadedProfile): string {
  const dir = hostedMdsDir(loaded);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function titleFromFile(abs: string, body?: string): string {
  if (body) {
    const m = body.match(/^#\s+(.+)$/m);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return path.basename(abs, path.extname(abs));
}

function walkMdFiles(root: string, relBase = ""): Array<{ abs: string; slug: string }> {
  const out: Array<{ abs: string; slug: string }> = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const abs = path.join(root, ent.name);
    const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      out.push(...walkMdFiles(abs, rel));
      continue;
    }
    if (!ent.isFile()) continue;
    if (!/\.md$/i.test(ent.name)) continue;
    if (/^README\.md$/i.test(ent.name) && !relBase) continue; // skip root README noise
    const slug = rel.replace(/\.md$/i, "").split(path.sep).join("/");
    out.push({ abs, slug });
  }
  return out;
}

/** Safe resolve under `.sm/mds` — rejects `..` escapes. */
export function resolveHostedMdPath(loaded: LoadedProfile, slug: string): string | null {
  const root = path.resolve(hostedMdsDir(loaded));
  const cleaned = slug.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "");
  if (!cleaned || cleaned.includes("..")) return null;
  const abs = path.resolve(root, cleaned + ".md");
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

export function listHostedMds(
  loaded: LoadedProfile,
  opts: { sessionId?: string } = {},
): HostedMdItem[] {
  const dir = hostedMdsDir(loaded);
  const sessionId = opts.sessionId || loaded.sessionName || loaded.workspaceId || "local";
  const files = walkMdFiles(dir);
  const items: HostedMdItem[] = [];
  for (const f of files) {
    let body = "";
    try {
      body = fs.readFileSync(f.abs, "utf8").slice(0, 4000);
    } catch {
      continue;
    }
    const st = fs.statSync(f.abs);
    items.push({
      slug: f.slug,
      title: titleFromFile(f.abs, body),
      absPath: f.abs,
      mtimeMs: st.mtimeMs,
      when: st.mtime.toISOString(),
      mesh: loaded.profile.name,
      workspace: loaded.workspace,
      profileDir: loaded.profileDir,
      hubPath: `/mds/${encodeURIComponent(sessionId)}/${f.slug.split("/").map(encodeURIComponent).join("/")}`,
    });
  }
  return items.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function readHostedMd(
  loaded: LoadedProfile,
  slug: string,
): { absPath: string; body: string; title: string } | null {
  const abs = resolveHostedMdPath(loaded, slug);
  if (!abs) return null;
  const body = fs.readFileSync(abs, "utf8");
  return { absPath: abs, body, title: titleFromFile(abs, body) };
}

/**
 * Host a markdown file into `.sm/mds/<destName>.md` (copy).
 * Returns relative slug. Idempotent overwrite.
 */
export function hostMarkdownIntoSm(
  loaded: LoadedProfile,
  sourceAbsOrRel: string,
  destSlug?: string,
): { slug: string; absPath: string } {
  const dir = ensureHostedMdsDir(loaded);
  const src = path.isAbsolute(sourceAbsOrRel)
    ? sourceAbsOrRel
    : path.resolve(loaded.workspace, sourceAbsOrRel);
  if (!fs.existsSync(src)) {
    throw new Error(`markdown not found: ${sourceAbsOrRel}`);
  }
  const base = destSlug?.replace(/\.md$/i, "") || path.basename(src, path.extname(src));
  const safe = base.replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "") || "note";
  if (safe.includes("..")) throw new Error("invalid dest slug");
  const absPath = path.join(dir, safe + ".md");
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.copyFileSync(src, absPath);
  return { slug: safe.split(path.sep).join("/"), absPath };
}

export function hostedMdHubUrl(loaded: LoadedProfile, slug: string, sessionId?: string): string {
  const sid = sessionId || loaded.sessionName || loaded.workspaceId || "local";
  const pathPart = slug
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  return `${defaultHubOrigin()}/mds/${encodeURIComponent(sid)}/${pathPart}`;
}
