import {
  chatRoomConfigForLoaded,
  contractsDirFor,
  hubLockActive,
  loadBalanceVendorContract,
  sayInRoomSync,
  type LoadedProfile,
} from "@seat-mesh/core";
import { runAssign } from "../seats/seat-assign.js";
import { readSeatSnapshot } from "../seats/seat-update.js";
import type { BalanceTickResult } from "./balance-tick.js";

export interface BalanceAutoResult {
  roomStatusPosted: boolean;
  autoPullAssigned: boolean;
  balanceeAssigned: string[];
}

function openTaskLines(tasksText: string, max = 8): string[] {
  const out: string[] = [];
  for (const line of tasksText.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*\[\s*\]\s*(.+)$/);
    if (m) {
      out.push(m[1].trim().slice(0, 240));
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Daemon METHOD — room STATUS + automatic assign (no manual manager peer for pull). */
export function runBalanceAutoActions(
  loaded: LoadedProfile,
  tick: BalanceTickResult,
  opts?: { dryRun?: boolean },
): BalanceAutoResult {
  const result: BalanceAutoResult = {
    roomStatusPosted: false,
    autoPullAssigned: false,
    balanceeAssigned: [],
  };
  if (opts?.dryRun) return result;

  const doc = loadBalanceVendorContract(contractsDirFor(loaded));
  const autoAssign = doc.auto_assign !== false;

  if (!hubLockActive(loaded.workspace)) {
    try {
      const cfg = chatRoomConfigForLoaded(loaded);
      const body = `BALANCE-STATUS: ${tick.statusLine}`;
      sayInRoomSync(loaded.workspace, cfg, doc.room_slug, "balance", body, {
        kind: "status",
        expectReply: false,
      });
      sayInRoomSync(loaded.workspace, cfg, "managers", "balance", body, {
        kind: "status",
        expectReply: false,
      });
      result.roomStatusPosted = true;
    } catch {
      result.roomStatusPosted = false;
    }
  }

  if (!autoAssign || !tick.pullSuggested || tick.mainOpen <= 0) {
    return result;
  }

  const mainSnap = readSeatSnapshot(loaded, { role: "manager" });
  const tasks = mainSnap ? openTaskLines(mainSnap.tasks.text) : [];
  const hint = tasks[0] ?? `${tick.mainOpen} open TASK on main lead`;

  try {
    runAssign(
      loaded,
      doc.balance_lead,
      `BALANCE AUTO: pull + route workload — ${hint} (daemon tick; read BALANCE-LAST.md)`,
    );
    result.autoPullAssigned = true;
  } catch {
    /* assign queue may still fail if pane missing */
  }

  let taskIdx = 1;
  for (const b of tick.balancees) {
    if (b.open > 1) continue;
    const spare = b.mark === "OPEN" || (b.mark === "BUSY" && b.open <= 1);
    if (!spare) continue;
    const taskLine = tasks[taskIdx++];
    if (!taskLine) break;
    try {
      runAssign(loaded, b.id, `BALANCE AUTO delegate: ${taskLine}`);
      result.balanceeAssigned.push(b.id);
    } catch {
      /* skip balancee */
    }
  }

  return result;
}
