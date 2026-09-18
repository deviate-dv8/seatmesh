import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  armContractLock,
  balanceLeadBrief,
  BALANCE_CHECKBACK,
  balanceLockPath,
  contractsDirFor,
  disarmContractLock,
  isBalanceContractOn,
  loadBalanceVendorContract,
  type LoadedProfile,
  type ProviderRegistry,
} from "@seat-mesh/core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { enqueuePrompt } from "../inject/prompt.js";
import { ensureMeshInbox, meshInboxPort } from "../comms/inbox-bridge.js";
import { runBalanceAutoActions } from "./balance-actions.js";
import { runBalanceTick } from "./balance-tick.js";

const BALANCE_LEAD_TICK_ID = "mesh-balance-lead-tick";

function parseDurationSeconds(raw: string): number {
  const m = raw.match(/^(\d+)(s|m|h)?$/i);
  if (!m) return 600;
  const n = Number(m[1]);
  const u = (m[2] || "s").toLowerCase();
  if (u === "m") return n * 60;
  if (u === "h") return n * 3600;
  return n;
}

function balanceMarkerPath(loaded: LoadedProfile): string {
  try {
    return balanceLockPath(loaded);
  } catch {
    return path.join(loaded.workspace, ".sm/contracts/locks/balance/lead.on");
  }
}

function inboxBase(loaded: LoadedProfile): string {
  return `http://127.0.0.1:${meshInboxPort(loaded)}`;
}

function curlJson(method: string, url: string, body?: unknown): Record<string, unknown> | null {
  const args = ["-sS", "-m", "5", "-X", method, url];
  if (body !== undefined) {
    args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  }
  const r = spawnSync("curl", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "{}") as Record<string, unknown>;
  } catch {
    return { raw: r.stdout };
  }
}

/** Arm via daemon HTTP — never write CHECKBACK.jsonl directly (sqlite split-brain). */
function armBalanceTickCheckback(
  loaded: LoadedProfile,
  leadPane: string,
  interval: string,
  leadLabel: string,
): void {
  ensureMeshInbox(loaded);
  const secs = parseDurationSeconds(interval);
  const expires = new Date(Date.now() + secs * 1000).toISOString();
  const base = inboxBase(loaded);
  curlJson("POST", `${base}/patience/${encodeURIComponent(BALANCE_LEAD_TICK_ID)}/cancel`);
  const created = curlJson("POST", `${base}/patience`, {
    id: BALANCE_LEAD_TICK_ID,
    kind: "balance-lead-tick",
    renewSec: secs,
    expect: BALANCE_CHECKBACK.balanceLeadTickExpect,
    ownerPane: leadPane,
    expiresAt: expires,
    senderLabel: "daemon",
    recipientLabel: leadLabel,
  });
  if (!created || created.ok === false) {
    throw new Error(`patience arm failed for ${BALANCE_LEAD_TICK_ID} — is mesh-inbox up?`);
  }
}

function cancelBalanceTick(loaded: LoadedProfile): void {
  ensureMeshInbox(loaded);
  curlJson(
    "POST",
    `${inboxBase(loaded)}/patience/${encodeURIComponent(BALANCE_LEAD_TICK_ID)}/cancel`,
  );
}

export function balanceLeadCommand(
  loaded: LoadedProfile,
  _registry: ProviderRegistry,
  sub: "on" | "off" | "status" | "run",
  intervalArg?: string,
  runOpts?: { dryRun?: boolean },
): void {
  const contractsDir = contractsDirFor(loaded);
  const doc = loadBalanceVendorContract(contractsDir);
  const interval = intervalArg ?? doc.interval ?? "10m";

  if (sub === "run") {
    const r = runBalanceTick(loaded, { dryRun: runOpts?.dryRun });
    const auto = runBalanceAutoActions(loaded, r, { dryRun: runOpts?.dryRun });
    console.log(r.statusLine);
    if (r.wroteLedger) console.log(`OK: ledger ${r.lastPath}`);
    if (auto.roomStatusPosted) console.log("OK: room STATUS posted (balance + managers)");
    if (auto.autoPullAssigned) console.log(`OK: auto-assign -> ${doc.balance_lead}`);
    if (auto.balanceeAssigned.length) {
      console.log(`OK: auto-assign balancees: ${auto.balanceeAssigned.join(", ")}`);
    }
    if (r.rebalanceHint) console.log("hint: rebalance skew across balancees");
    return;
  }

  const leadResolved = resolvePaneTarget(doc.balance_lead, loaded);
  if ("error" in leadResolved && sub !== "status") {
    throw new Error(`${leadResolved.error} — balance lead pane missing`);
  }

  if (sub === "status") {
    const on = isBalanceContractOn(loaded) || fs.existsSync(balanceMarkerPath(loaded));
    ensureMeshInbox(loaded);
    const listed = curlJson("GET", `${inboxBase(loaded)}/patience?all=1`);
    const entries = Array.isArray((listed as { entries?: unknown })?.entries)
      ? ((listed as { entries: Array<{ id?: string; status?: string; ownerPane?: string }> }).entries)
      : [];
    const row = entries.find((r) => r.id === BALANCE_LEAD_TICK_ID && r.status === "active");
    console.log(`balance: ${on ? "ON" : "OFF"}`);
    console.log(`  lead: ${doc.balance_lead}`);
    console.log(`  main: ${doc.main_lead}`);
    console.log(`  balancees: ${doc.balancees.join(", ")}`);
    console.log(`  interval: ${interval}`);
    if (row?.ownerPane) console.log(`  tick pane: ${row.ownerPane}`);
    return;
  }

  if (sub === "off") {
    cancelBalanceTick(loaded);
    disarmContractLock(contractsDir, doc.id, doc.balance_lead);
    console.log("OK: balance OFF (tick cancelled, contract lock removed)");
    return;
  }

  if ("error" in leadResolved) {
    throw new Error(leadResolved.error);
  }

  armContractLock(contractsDir, doc.id, doc.balance_lead);
  armBalanceTickCheckback(loaded, leadResolved.paneId, interval, doc.balance_lead);

  const brief = balanceLeadBrief({ interval, balancees: doc.balancees });
  try {
    enqueuePrompt(loaded, doc.balance_lead, brief, { prefix: "" });
  } catch {
    /* tick still fires via daemon */
  }

  const initial = runBalanceTick(loaded);
  runBalanceAutoActions(loaded, initial);

  console.log(
    `OK: balance ON interval=${interval} lead=${leadResolved.paneId} balancees=${doc.balancees.join(",")}`,
  );
  console.log("  tick kind=balance-lead-tick (daemon + seatmesh --profile .sm balance run)");
  console.log("  off: seatmesh --profile .sm balance off");
}
