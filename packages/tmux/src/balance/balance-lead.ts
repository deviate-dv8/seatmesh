import fs from "node:fs";
import path from "node:path";
import {
  armContractLock,
  balanceLeadBrief,
  BALANCE_CHECKBACK,
  balanceLockPath,
  contractsDirFor,
  disarmContractLock,
  isBalanceContractOn,
  loadBalanceVendorContract,
  meshRuntimePaths,
  type LoadedProfile,
  type ProviderRegistry,
} from "@seat-mesh/core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { enqueuePrompt } from "../inject/prompt.js";
import { runBalanceAutoActions } from "./balance-actions.js";
import { runBalanceTick } from "./balance-tick.js";

interface CheckbackRowLocal {
  id: string;
  kind: string;
  status: "active" | "cancelled";
  renewSec?: number;
  expect?: string;
  ownerPane?: string;
  expiresAt?: string;
  senderLabel?: string;
  recipientLabel?: string;
  createdAt: string;
  updatedAt: string;
}

function checkbackPath(loaded: LoadedProfile): string {
  return meshRuntimePaths(loaded).checkbackJsonl;
}

function readCheckbacksLocal(loaded: LoadedProfile): CheckbackRowLocal[] {
  const p = checkbackPath(loaded);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CheckbackRowLocal);
}

function writeCheckbacksLocal(loaded: LoadedProfile, rows: CheckbackRowLocal[]): void {
  const p = checkbackPath(loaded);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

function upsertCheckbackLocal(loaded: LoadedProfile, row: CheckbackRowLocal): void {
  const rows = readCheckbacksLocal(loaded).filter((r) => r.id !== row.id);
  rows.push(row);
  writeCheckbacksLocal(loaded, rows);
}

function cancelCheckbackLocal(loaded: LoadedProfile, id: string): void {
  const now = new Date().toISOString();
  const rows = readCheckbacksLocal(loaded);
  let hit = false;
  for (const r of rows) {
    if (r.id === id || r.id.startsWith(id)) {
      r.status = "cancelled";
      r.updatedAt = now;
      hit = true;
    }
  }
  if (hit) writeCheckbacksLocal(loaded, rows);
}

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
    return path.join(loaded.workspace, ".sm/contracts/locks/balance/manager-2.on");
  }
}

function armBalanceTickCheckback(loaded: LoadedProfile, leadPane: string, interval: string): void {
  const secs = parseDurationSeconds(interval);
  const expires = new Date(Date.now() + secs * 1000).toISOString();
  cancelCheckbackLocal(loaded, BALANCE_LEAD_TICK_ID);
  const now = new Date().toISOString();
  const body: Omit<CheckbackRowLocal, "createdAt" | "updatedAt" | "status"> = {
    id: BALANCE_LEAD_TICK_ID,
    kind: "balance-lead-tick",
    renewSec: secs,
    expect: BALANCE_CHECKBACK.balanceLeadTickExpect,
    ownerPane: leadPane,
    expiresAt: expires,
    senderLabel: "daemon",
    recipientLabel: "manager-2",
  };
  upsertCheckbackLocal(loaded, {
    ...body,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
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
    if (auto.balanceeAssigned.length) console.log(`OK: auto-assign balancees: ${auto.balanceeAssigned.join(", ")}`);
    if (r.rebalanceHint) console.log("hint: rebalance skew across balancees");
    return;
  }

  const leadResolved = resolvePaneTarget(doc.balance_lead, loaded);
  if ("error" in leadResolved && sub !== "status") {
    throw new Error(`${leadResolved.error} — balance lead pane missing`);
  }

  if (sub === "status") {
    const on = isBalanceContractOn(loaded) || fs.existsSync(balanceMarkerPath(loaded));
    const rows = readCheckbacksLocal(loaded).filter(
      (r) => r.id === BALANCE_LEAD_TICK_ID && r.status === "active",
    );
    console.log(`balance: ${on ? "ON" : "OFF"}`);
    console.log(`  lead: ${doc.balance_lead}`);
    console.log(`  main: ${doc.main_lead}`);
    console.log(`  balancees: ${doc.balancees.join(", ")}`);
    console.log(`  interval: ${interval}`);
    if (rows[0]?.ownerPane) console.log(`  tick pane: ${rows[0].ownerPane}`);
    return;
  }

  if (sub === "off") {
    cancelCheckbackLocal(loaded, BALANCE_LEAD_TICK_ID);
    disarmContractLock(contractsDir, doc.id, doc.balance_lead);
    console.log("OK: balance OFF (tick cancelled, contract lock removed)");
    return;
  }

  if ("error" in leadResolved) {
    throw new Error(leadResolved.error);
  }

  armContractLock(contractsDir, doc.id, doc.balance_lead);
  armBalanceTickCheckback(loaded, leadResolved.paneId, interval);

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
  console.log("  tick kind=balance-lead-tick (daemon + ./sm.sh balance run)");
  console.log("  off: ./sm.sh balance off");
}
