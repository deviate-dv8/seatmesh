import { portsForSlot, type LoadedProfile } from "seat-mesh-core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { runWhoami } from "../agents/whoami.js";
import { enqueuePeer } from "../comms/inbox-bridge.js";

export interface RemindResult {
  target: string;
  paneId: string;
  status: "queued" | "skipped";
  reason?: string;
}

export interface RemindOptions {
  note?: string;
}

/** Manager-only gate: run from the manager pane in the mesh session. */
export function requireMeshManager(loaded: LoadedProfile): void {
  const w = runWhoami(loaded);
  if (w.role !== "manager") {
    throw new Error(
      `refused: remind is manager-only - run ./sm.sh remind from the manager pane (you_are=${w.role})`,
    );
  }
}

function buildRemindMessage(
  prefix: string,
  slot: number,
  ports: string,
  note?: string,
): string {
  let msg =
    `${prefix} slot-${slot} ports ${ports || "?"} - ` +
    "REMIND (from operator via manager): Update your seat context now.\n" +
    "1) ./sm.sh whoami\n" +
    "2) Edit seat files: FOCUS.md (NOW only + Mark), TASKS.md (todos), REMINDER.md (self-queue).\n" +
    "   Report whether your session TASKS are done (open checkboxes count).\n" +
    "   Mark OPEN only if all session TASKS are done/cleared; else Mark BUSY or BLOCKED (operator preference).\n" +
    "3) Stamp **Tmux seat:** on your ACTIVE-FOCUS block if you own one.\n" +
    "4) Re-read .agent/agent-seats.md Worker POV - to signal the master you MUST shell:\n" +
    "   ./sm.sh room say <msg> (chat-only reply is not a master signal).\n" +
    "   Operator-first: for eyeball/approve/prove, notify script FIRST then room say (never ask master to toast operator).\n" +
    "   Peer seats: ./sm.sh room say (live CLI only; no merge authority).\n" +
    `   Slot ${slot}, ports ${ports} (paired only).`;
  if (note) msg += `\nOperator note: ${note}`;
  return msg;
}

export function runRemind(
  loaded: LoadedProfile,
  target: string,
  opts: RemindOptions = {},
): RemindResult[] {
  requireMeshManager(loaded);

  const session = loaded.sessionName;
  const workerCount = loaded.profile.session.workerCount;
  const prefix = loaded.profile.daemon.managerPromptPrefix;
  const note = opts.note;

  let slots: number[];
  if (target === "all") {
    slots = Array.from({ length: workerCount }, (_, i) => i + 1);
  } else {
    const m = target.match(/^(?:slot-)?(\d+)$/);
    if (!m) throw new Error(`bad remind target: ${target} (want 1-${workerCount}, slot-N, or all)`);
    const n = Number(m[1]);
    if (n < 1 || n > workerCount) {
      throw new Error(`remind target must be worker slot 1-${workerCount} or all`);
    }
    slots = [n];
  }

  const results: RemindResult[] = [];
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
    const msg = buildRemindMessage(prefix, slot, ports, note);
    const resp = enqueuePeer(loaded, {
      kind: "remind",
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

export function printRemindResults(results: RemindResult[]): void {
  let sent = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status === "queued") {
      sent++;
      console.log(`queued -> ${r.target} ${r.paneId} (daemon inject when idle)`);
    } else {
      skipped++;
      console.log(`skip ${r.target}: ${r.reason ?? "skipped"}`);
    }
  }
  console.log(`remind done: queued=${sent} skipped=${skipped}`);
}
