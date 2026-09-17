/**
 * Agent MD galleries — three scopes for `sm agent mds …`:
 *   hosted      → `.sm/mds/` (hub /mds)
 *   agent-self  → this seat's FOCUS/TASKS/REMINDER (+ optional _shared)
 *   agent <kind>→ `.sm/roles/_vendor/docs/<kind>.md` (locked POV)
 */
import fs from "node:fs";
import path from "node:path";
import type { LoadedProfile } from "../profile/profile.js";
import { profilePaths } from "../profile/profile.js";
import {
  defaultHubOrigin,
  hostedMdHubUrl,
  hostMarkdownIntoSm,
  listHostedMds,
  readHostedMd,
  type HostedMdItem,
} from "./hosted-mds.js";

export type AgentMdKind = "common" | "manager" | "secretary" | "worker" | "mini";

export const AGENT_MD_KINDS: readonly AgentMdKind[] = [
  "common",
  "manager",
  "secretary",
  "worker",
  "mini",
] as const;

export interface AgentMdRef {
  scope: "hosted" | "agent-self" | "agent-kind";
  /** Display id: slug, FOCUS.md, or kind name */
  id: string;
  title: string;
  absPath: string;
  when?: string;
  /** Hub URL when hosted; otherwise file:// or roles path hint */
  url?: string;
  note?: string;
}

function titleFromBody(abs: string, body?: string): string {
  if (body) {
    const m = body.match(/^#\s+(.+)$/m);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return path.basename(abs, path.extname(abs));
}

function seatsRoot(loaded: LoadedProfile): string {
  return profilePaths(loaded).seatsRoot;
}

/** Canonical seat MDs for one column (manager / secretary / slot-N / mini-N). */
export function listAgentSelfMds(
  loaded: LoadedProfile,
  seatColumn: string,
  opts?: { includeShared?: boolean },
): AgentMdRef[] {
  const col = seatColumn.trim() || "manager";
  const seatDir = path.join(seatsRoot(loaded), col);
  const names = ["FOCUS.md", "TASKS.md", "REMINDER.md"];
  const out: AgentMdRef[] = [];
  for (const name of names) {
    const abs = path.join(seatDir, name);
    if (!fs.existsSync(abs)) continue;
    let body = "";
    try {
      body = fs.readFileSync(abs, "utf8").slice(0, 2000);
    } catch {
      continue;
    }
    const st = fs.statSync(abs);
    out.push({
      scope: "agent-self",
      id: name,
      title: titleFromBody(abs, body),
      absPath: abs,
      when: st.mtime.toISOString(),
      note: `seat=${col}`,
    });
  }
  if (opts?.includeShared !== false) {
    const shared = path.join(seatsRoot(loaded), "_shared");
    let ents: string[] = [];
    try {
      ents = fs.readdirSync(shared).filter((n) => /\.md$/i.test(n) && !n.startsWith("."));
    } catch {
      ents = [];
    }
    for (const name of ents.sort()) {
      const abs = path.join(shared, name);
      if (!fs.statSync(abs).isFile()) continue;
      let body = "";
      try {
        body = fs.readFileSync(abs, "utf8").slice(0, 2000);
      } catch {
        continue;
      }
      const st = fs.statSync(abs);
      out.push({
        scope: "agent-self",
        id: `_shared/${name}`,
        title: titleFromBody(abs, body),
        absPath: abs,
        when: st.mtime.toISOString(),
        note: "shared",
      });
    }
  }
  return out;
}

export function readAgentSelfMd(
  loaded: LoadedProfile,
  seatColumn: string,
  id: string,
): { absPath: string; body: string; title: string } | null {
  const cleaned = id.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..")) return null;
  const col = seatColumn.trim() || "manager";
  const abs = cleaned.startsWith("_shared/")
    ? path.join(seatsRoot(loaded), cleaned)
    : path.join(seatsRoot(loaded), col, cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`);
  const root = path.resolve(seatsRoot(loaded));
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  const body = fs.readFileSync(resolved, "utf8");
  return { absPath: resolved, body, title: titleFromBody(resolved, body) };
}

export function roleDocsDir(loaded: LoadedProfile): string {
  return path.join(loaded.profileDir, "roles", "_vendor", "docs");
}

export function parseAgentMdKind(raw: string | undefined): AgentMdKind | null {
  const k = (raw ?? "").trim().toLowerCase();
  if ((AGENT_MD_KINDS as readonly string[]).includes(k)) return k as AgentMdKind;
  return null;
}

export function listAgentKindMds(loaded: LoadedProfile): AgentMdRef[] {
  const dir = roleDocsDir(loaded);
  const out: AgentMdRef[] = [];
  for (const kind of AGENT_MD_KINDS) {
    const abs = path.join(dir, `${kind}.md`);
    if (!fs.existsSync(abs)) continue;
    let body = "";
    try {
      body = fs.readFileSync(abs, "utf8").slice(0, 2000);
    } catch {
      continue;
    }
    const st = fs.statSync(abs);
    out.push({
      scope: "agent-kind",
      id: kind,
      title: titleFromBody(abs, body),
      absPath: abs,
      when: st.mtime.toISOString(),
      note: "roles/_vendor/docs (locked)",
    });
  }
  return out;
}

export function readAgentKindMd(
  loaded: LoadedProfile,
  kind: AgentMdKind,
): { absPath: string; body: string; title: string } | null {
  const abs = path.join(roleDocsDir(loaded), `${kind}.md`);
  if (!fs.existsSync(abs)) return null;
  const body = fs.readFileSync(abs, "utf8");
  return { absPath: abs, body, title: titleFromBody(abs, body) };
}

export function hostedToRefs(items: HostedMdItem[], loaded: LoadedProfile): AgentMdRef[] {
  return items.map((it) => ({
    scope: "hosted" as const,
    id: it.slug,
    title: it.title,
    absPath: it.absPath,
    when: it.when,
    url: hostedMdHubUrl(loaded, it.slug),
    note: "hosted .sm/mds",
  }));
}

export {
  listHostedMds,
  readHostedMd,
  hostMarkdownIntoSm,
  hostedMdHubUrl,
  defaultHubOrigin,
  type HostedMdItem,
};
