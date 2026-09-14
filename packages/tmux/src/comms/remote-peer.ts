import { spawnSync } from "node:child_process";
import {
  loadProfile,
  resolveDaemonPort,
  type LoadedProfile,
} from "@seat-mesh/core";
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
  const fromAgent = `${local.workspaceId}:${who.role}${who.slot != null ? `-slot-${who.slot}` : who.slotLabel ? `-${who.slotLabel}` : ""}`;
  const body = {
    kind: "prompt",
    targetPane: resolved.paneId,
    targetLabel: seat,
    fromSlot: fromAgent,
    fromPorts: null,
    fromAgent,
    msg: `[remote ${fromAgent}] ${msg.trim()}`,
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
