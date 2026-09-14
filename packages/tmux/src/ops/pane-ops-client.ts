import { spawnSync } from "node:child_process";
import type { LoadedProfile, PaneOpKind, PaneOpRow } from "@seat-mesh/core";
import { ensureMeshInbox, meshInboxPort } from "../comms/inbox-bridge.js";
import { runWhoami } from "../agents/whoami.js";

function inboxBase(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function paneOpWho(loaded: LoadedProfile): string {
  if (!process.env.TMUX_PANE) return "shell";
  try {
    const w = runWhoami(loaded, "here");
    if (w.role === "manager") return "manager";
    if (w.role === "secretary") return "secretary";
    if (w.role === "manager-mini") {
      const m = w.slotLabel?.match(/mini-?(\d+)/i);
      return m ? `mini-${m[1]}` : "mini";
    }
    if (w.role === "worker" && w.slot != null) return `slot-${w.slot}`;
    return w.role;
  } catch {
    return "unknown";
  }
}

function postPaneOp(
  port: number,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-m",
      "8",
      "-X",
      "POST",
      `${inboxBase(port)}/pane-ops`,
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

export function listPaneOps(loaded: LoadedProfile): PaneOpRow[] {
  const port = meshInboxPort(loaded);
  const r = spawnSync("curl", ["-sS", "-m", "3", `${inboxBase(port)}/pane-ops`], {
    encoding: "utf8",
  });
  if (r.status !== 0) return [];
  try {
    const parsed = JSON.parse(r.stdout || "{}") as { rows?: PaneOpRow[] };
    return parsed.rows ?? [];
  } catch {
    return [];
  }
}

export function printPaneOpsList(loaded: LoadedProfile): void {
  const rows = listPaneOps(loaded);
  const open = rows.filter((r) => r.status === "pending" || r.status === "running");
  if (!open.length) {
    console.log("pane-ops: queue empty");
    return;
  }
  for (const r of open) {
    console.log(
      `${r.id.slice(0, 8)} ${r.status} ${r.kind} who=${r.who} — ${r.summary}`,
    );
  }
  console.log(`pane-ops: ${open.length} open`);
}

export function clearPaneOpsQueue(loaded: LoadedProfile): number {
  ensureMeshInbox(loaded, { quiet: true });
  const port = meshInboxPort(loaded);
  const r = spawnSync(
    "curl",
    ["-sS", "-m", "8", "-X", "POST", `${inboxBase(port)}/pane-ops/clear`],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return -1;
  try {
    const parsed = JSON.parse(r.stdout || "{}") as { cleared?: number };
    return parsed.cleared ?? 0;
  } catch {
    return -1;
  }
}

/**
 * Queue a mutating pane op (launch/restart/relayout/switch). Daemon runs one at a time.
 * Falls back to immediate local run when inbox is down (dev escape hatch).
 */
export function submitPaneOp(
  loaded: LoadedProfile,
  kind: PaneOpKind,
  payload: Record<string, unknown>,
  summary: string,
  localRun: () => void,
): void {
  ensureMeshInbox(loaded, { quiet: true });
  const port = meshInboxPort(loaded);
  const who = paneOpWho(loaded);
  const resp = postPaneOp(port, { kind, who, summary, payload });
  if (!resp?.ok) {
    console.warn("WARN: pane-ops queue unavailable — running immediately (race risk)");
    localRun();
    return;
  }
  const entry = resp.entry as PaneOpRow | undefined;
  const id = entry?.id?.slice(0, 8) ?? "?";
  const status = entry?.status ?? "pending";
  if (status === "failed") {
    const err = entry?.error ?? "unknown";
    console.error(`FAIL: pane-op ${id} ${kind} — ${err}`);
    process.exit(1);
  }
  if (status === "running") {
    console.log(`OK: pane-op ${id} ${kind} running now — ${summary}`);
  } else if (status === "done") {
    console.log(`OK: pane-op ${id} ${kind} done — ${summary}`);
  } else {
    const ahead = Number(resp.queueAhead ?? 0);
    const note = ahead > 0 ? ` (${ahead} ahead)` : "";
    console.log(`QUEUED pane-op ${id} ${kind}${note} — ${summary}`);
    console.log("  daemon serializes launch/restart; check: seatmesh --profile .sm ops list");
  }
}
