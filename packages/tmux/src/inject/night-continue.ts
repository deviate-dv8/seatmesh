import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildResolvedPaths, portsForSlot, type LoadedProfile } from "@seat-mesh/core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { ensureMeshInbox, meshInboxPort } from "../comms/inbox-bridge.js";
import { enqueuePeer } from "../comms/inbox-bridge.js";
import { requireMeshManager } from "./remind.js";

function nightFlagPath(loaded: LoadedProfile): string {
  return path.join(buildResolvedPaths(loaded).seatsRoot, "manager", "night.on");
}

export function nightEnabled(loaded: LoadedProfile): boolean {
  return fs.existsSync(nightFlagPath(loaded));
}

function requireNight(loaded: LoadedProfile): void {
  if (nightEnabled(loaded)) return;
  throw new Error("refused: night mode is off (./sm.sh night on)");
}

function inboxPost(port: number, pathname: string, body: Record<string, unknown>): boolean {
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-m",
      "5",
      "-X",
      "POST",
      `http://127.0.0.1:${port}${pathname}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(body),
    ],
    { encoding: "utf8" },
  );
  return r.status === 0;
}

function armNightPatience(loaded: LoadedProfile): void {
  if (!ensureMeshInbox(loaded, { quiet: true })) {
    console.error("WARN: inbox down — night flag set but checkback not armed");
    return;
  }
  const mgr = resolvePaneTarget("manager", loaded);
  if ("error" in mgr) {
    console.error(`WARN: night checkback: ${mgr.error}`);
    return;
  }
  const port = meshInboxPort(loaded);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const ocExpires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const pane = mgr.paneId;

  inboxPost(port, "/patience", {
    id: "night-mode-self",
    kind: "night",
    renewSec: 1800,
    expect: "night ON: mesh alive + inbox recovery + continue workers until night off",
    ownerPane: pane,
    senderPane: pane,
    senderLabel: "manager",
    recipientLabel: "manager",
    expiresAt,
  });
  inboxPost(port, "/patience", {
    id: "master-oc-fix-loop",
    kind: "oc-fix",
    renewSec: 300,
    expect: "OC resume loop: CPE/proxy recovery without operator confirm",
    ownerPane: pane,
    senderPane: pane,
    senderLabel: "manager",
    recipientLabel: "manager",
    expiresAt: ocExpires,
  });
}

function cancelNightPatience(loaded: LoadedProfile): void {
  if (!ensureMeshInbox(loaded, { quiet: true })) return;
  const port = meshInboxPort(loaded);
  inboxPost(port, "/patience/night-mode-self/cancel", {});
  inboxPost(port, "/patience/master-oc-fix-loop/cancel", {});
}

export function runNight(loaded: LoadedProfile, mode: string): void {
  requireMeshManager(loaded);
  const flag = nightFlagPath(loaded);

  switch (mode || "status") {
    case "on": {
      fs.mkdirSync(path.dirname(flag), { recursive: true });
      if (!fs.existsSync(flag)) {
        fs.writeFileSync(flag, `since=${new Date().toISOString()}\n`, "utf8");
      }
      armNightPatience(loaded);
      console.log(`night: on (${flag}) + checkback armed on manager pane`);
      return;
    }
    case "off": {
      try {
        fs.unlinkSync(flag);
      } catch {
        /* ignore */
      }
      cancelNightPatience(loaded);
      console.log("night: off (night checkbacks cancelled)");
      return;
    }
    case "status":
    case "": {
      if (nightEnabled(loaded)) {
        console.log("night: on");
        console.log(fs.readFileSync(flag, "utf8").trim());
      } else {
        console.log("night: off");
      }
      return;
    }
    default:
      throw new Error("usage: night on|off|status");
  }
}

export interface ContinueResult {
  target: string;
  paneId: string;
  status: "queued" | "skipped";
  reason?: string;
}

export function runContinue(
  loaded: LoadedProfile,
  target: string,
  note?: string,
): ContinueResult[] {
  requireMeshManager(loaded);
  requireNight(loaded);

  const prefix = loaded.profile.daemon.managerPromptPrefix;
  const workerCount = loaded.profile.session.workerCount;

  let slots: number[];
  if (target === "all") {
    slots = Array.from({ length: workerCount }, (_, i) => i + 1);
  } else {
    const m = target.match(/^(?:slot-)?(\d+)$/);
    if (!m) throw new Error(`bad continue target: ${target} (want 1-${workerCount}, slot-N, or all)`);
    const n = Number(m[1]);
    if (n < 1 || n > workerCount) {
      throw new Error(`continue target must be worker slot 1-${workerCount} or all`);
    }
    slots = [n];
  }

  const results: ContinueResult[] = [];
  for (const slot of slots) {
    const targetLabel = `slot-${slot}`;
    const resolved = resolvePaneTarget(String(slot), loaded);
    if ("error" in resolved) {
      results.push({ target: targetLabel, paneId: "-", status: "skipped", reason: resolved.error });
      continue;
    }
    const paneId = resolved.paneId;
    const ports =
      resolved.row.ports || portsForSlot(loaded.profile.ports.worker, slot);
    let msg =
      `${prefix} slot-${slot} ports ${ports} - CONTINUE (night): Resume the already-authorized next step.` +
      " Do not stop for empty yes/continue confirms." +
      " Still refuse merge, QA columns, staging account create, and new scope without operator." +
      ` Slot ${slot}, ports ${ports} (paired). Update FOCUS if needed.`;
    if (note) msg += ` Note: ${note}`;

    const resp = enqueuePeer(loaded, {
      kind: "prompt",
      msg,
      targetPane: paneId,
      targetLabel,
      fromSlot: "manager",
    });
    if (!resp?.ok) {
      results.push({
        target: targetLabel,
        paneId,
        status: "skipped",
        reason: "enqueue failed (inbox down?)",
      });
      continue;
    }
    results.push({ target: targetLabel, paneId, status: "queued" });
  }
  return results;
}

export function printContinueResults(results: ContinueResult[]): void {
  let sent = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status === "queued") {
      sent++;
      console.log(`continue -> ${r.target} ${r.paneId} (daemon inject when idle)`);
    } else {
      skipped++;
      console.log(`skip ${r.target}: ${r.reason ?? "skipped"}`);
    }
  }
  console.log(`continue done: queued=${sent} skipped=${skipped}`);
}
