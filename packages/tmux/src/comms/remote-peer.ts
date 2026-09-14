import { spawnSync } from "node:child_process";
import {
  loadProfile,
  peerTargetForComms,
  resolveAgentId,
  resolveDaemonPort,
  type LoadedProfile,
} from "@seat-mesh/core";
import { paneMetaForPane } from "../lib/pane-meta.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { runWhoami } from "../agents/whoami.js";

export interface RemotePeerTarget {
  alias: string;
  seat: string;
}

/** Parse `@zsign:manager` or `@zsign:slot-1` remote peer target. */
export function parseRemotePeerTarget(raw: string): RemotePeerTarget | null {
  const m = raw.match(/^@([a-z][a-z0-9-]{0,31}):([a-z][a-z0-9-]{0,31})$/i);
  if (!m) return null;
  return { alias: m[1]!.toLowerCase(), seat: m[2]!.toLowerCase() };
}

function inboxBase(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function curlPost(port: number, path: string, body: unknown): Record<string, unknown> | null {
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-m",
      "8",
      "-X",
      "POST",
      `${inboxBase(port)}${path}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(body),
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "{}") as Record<string, unknown>;
  } catch {
    return { raw: r.stdout };
  }
}

function localAgentId(who: {
  role: string;
  slot: number | null;
  mini?: string | null;
}): string {
  return resolveAgentId({
    role: who.role || "plain",
    slot: who.slot,
    mini: who.mini ?? null,
  });
}

/** Machine id for PEER row — profile:agent (no role+slotLabel duplication). */
export function buildRemoteFromAgent(
  profileName: string,
  who: { role: string; slot: number | null; slotLabel?: string | null; mini?: string | null },
): string {
  return `${profileName}:${localAgentId(who)}`;
}

/** Same [from:x to:y] convention as local peer/prompt inject. */
export function buildRemoteFromToHeader(
  fromProfile: string,
  who: { role: string; slot: number | null; mini?: string | null },
  toAlias: string,
  toTarget: string,
): string {
  return `[from:${fromProfile}:${localAgentId(who)} to:${toAlias}:${toTarget}] `;
}

function peerTargetFromRow(row: {
  role: string;
  slot: string;
  mini: string;
}): string {
  const slotNum = row.slot ? Number.parseInt(row.slot, 10) : null;
  return peerTargetForComms({
    role: row.role,
    slot: Number.isFinite(slotNum) ? slotNum : null,
    mini: row.mini || null,
  });
}

/** Enqueue peer on another mesh session's inbox (same host, portScope:workspace). */
export function runRemotePeer(
  local: LoadedProfile,
  alias: string,
  seat: string,
  msg: string,
): void {
  const remotes = local.profile.remotes;
  if (!remotes?.[alias]) {
    throw new Error(
      `refused: unknown remote @${alias} — add mesh.config.yaml remotes.${alias}.profile`,
    );
  }
  const remoteProfilePath = remotes[alias]!.profile;
  const remote = loadProfile(remoteProfilePath);
  const resolved = resolvePaneTarget(seat, remote);
  if ("error" in resolved) {
    throw new Error(`remote @${alias}:${seat}: ${resolved.error}`);
  }
  const port = resolveDaemonPort(remote.profile, remote.workspace);
  const who = runWhoami(local, "here");
  const meta = who.paneId ? paneMetaForPane(who.paneId) : null;
  const whoCtx = {
    role: who.role,
    slot: who.slot,
    mini: meta?.mini ?? null,
  };
  const fromAgent = buildRemoteFromAgent(local.profile.name, {
    ...whoCtx,
    slotLabel: who.slotLabel,
  });
  const stamp = buildRemoteFromToHeader(
    local.profile.name,
    whoCtx,
    alias,
    peerTargetFromRow(resolved.row),
  );
  const body = {
    kind: "prompt",
    targetPane: resolved.paneId,
    targetLabel: seat,
    fromSlot: fromAgent,
    fromPorts: null,
    fromAgent,
    msg: `${stamp}${msg.trim()}`,
  };
  const resp = curlPost(port, "/to-peer", body);
  if (!resp?.ok) {
    throw new Error(
      `FAIL: remote peer @${alias}:${seat} inbox :${port} — ${String(resp?.error ?? "down")}`,
    );
  }
  console.log(
    `QUEUED: remote peer @${alias}:${seat} pane=${resolved.paneId} port=${port} (foreign inbox)`,
  );
}
