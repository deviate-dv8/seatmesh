import fs from "node:fs";
import path from "node:path";
import { MESH_INBOX_TAG } from "./mesh-copy.js";

/** Machine tag on daemon injects so coord panes can filter (no faux conversation turn). */
export const MESH_INBOX_INTENTS = [
  "supervise-tick",
  "checkback-verify",
  "background",
  "assign",
  "continue",
  "limit-retry",
  "status",
] as const;

export type MeshInboxIntent = (typeof MESH_INBOX_INTENTS)[number];

export function isMeshInboxIntent(s: string): s is MeshInboxIntent {
  return (MESH_INBOX_INTENTS as readonly string[]).includes(s);
}

/** Prefix `[mesh-inbox] intent=<kind>` when not already stamped. */
export function formatMeshInboxStamp(body: string, intent?: MeshInboxIntent): string {
  const raw = body.trimStart();
  if (!intent) return body;
  if (/\bintent=[a-z-]+\b/.test(raw)) return body;
  if (raw.startsWith(MESH_INBOX_TAG)) {
    const rest = raw.slice(MESH_INBOX_TAG.length).trimStart();
    return `${MESH_INBOX_TAG} intent=${intent} ${rest}`;
  }
  return `${MESH_INBOX_TAG} intent=${intent} ${raw}`;
}

export function parseMeshInboxIntent(message: string): MeshInboxIntent | null {
  const m = message.match(/\[mesh-inbox\]\s+intent=([a-z-]+)/);
  if (!m) return null;
  const id = m[1] ?? "";
  return isMeshInboxIntent(id) ? id : null;
}

/** Non-assign intents must not end with Reply: peer boilerplate. */
export function stripReplyPeerFooter(message: string): string {
  return message
    .replace(/\nSHELL \(required[^\n]*$/gm, "")
    .replace(/\nReply: peer[^\n]*$/gm, "")
    .replace(/\nReply: \.\/sm\.sh peer[^\n]*$/gm, "")
    .replace(/\nReply: seatmesh[^\n]*$/gm, "")
    .trimEnd();
}

/** When hub is closed, skip coord ACK/status spam (operator or lead sets lock). */
export function hubLockActive(workspace: string): boolean {
  const candidates = [
    path.join(workspace, ".sm", "HUB.lock"),
    path.join(workspace, "tasks", "seat-mesh", "HUB.lock"),
  ];
  return candidates.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}
