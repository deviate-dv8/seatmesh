import fs from "node:fs";
import path from "node:path";
import {
  contractsDirFor,
  formatBalanceStatusLine,
  loadBalanceVendorContract,
  type LoadedProfile,
} from "@seat-mesh/core";
import { parseSeatTarget } from "../seats/seat-paths.js";
import { readSeatSnapshot } from "../seats/seat-update.js";

export interface BalanceeRow {
  id: string;
  mark: string;
  open: number;
  resolved: boolean;
}

export interface BalanceTickResult {
  statusLine: string;
  lastPath: string;
  mainLeadId: string;
  mainMark: string;
  mainOpen: number;
  balancees: BalanceeRow[];
  pullSuggested: boolean;
  rebalanceHint: boolean;
  wroteLedger: boolean;
}

function balanceLastPath(loaded: LoadedProfile): string {
  const doc = loadBalanceVendorContract(contractsDirFor(loaded));
  const dirKey = loaded.profile.seats.dirs?.[doc.balance_lead] ?? doc.balance_lead;
  const root = path.join(loaded.workspace, ".sm", "seats", dirKey);
  return path.join(root, "BALANCE-LAST.md");
}

function parsePriorOpen(lastText: string, agentId: string): number | null {
  const re = new RegExp(`\\|\\s*${agentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|\\s*(\\d+)\\s*\\|`, "i");
  const m = lastText.match(re);
  return m ? Number(m[1]) : null;
}

function progressNote(prior: number | null, open: number): string {
  if (prior === null) return "new";
  if (open < prior) return `PROG (${prior}->${open})`;
  if (open > prior) return `regress (${prior}->${open})`;
  return "unchanged";
}

/** Real METHOD tick — snapshots seats, writes BALANCE-LAST.md, returns STATUS line. */
export function runBalanceTick(loaded: LoadedProfile, opts?: { dryRun?: boolean }): BalanceTickResult {
  const doc = loadBalanceVendorContract(contractsDirFor(loaded));
  const mainTarget = parseSeatTarget(doc.main_lead);

  const mainSnap = readSeatSnapshot(loaded, mainTarget);
  const mainMark = mainSnap?.focus.mark ?? "?";
  const mainOpen = mainSnap?.tasks.open ?? 0;

  const balancees: BalanceeRow[] = [];
  for (const id of doc.balancees) {
    let target;
    try {
      target = parseSeatTarget(id);
    } catch {
      balancees.push({ id, mark: "?", open: 0, resolved: false });
      continue;
    }
    const snap = readSeatSnapshot(loaded, target);
    balancees.push({
      id,
      mark: snap?.focus.mark ?? "?",
      open: snap?.tasks.open ?? 0,
      resolved: snap !== null,
    });
  }

  const balanceeParts = balancees.map((b) => `${b.id} ${b.mark} ${b.open} open`);
  const statusLine = formatBalanceStatusLine({
    mainLeadId: doc.main_lead,
    mainMark,
    mainOpen,
    balanceeParts,
  });

  const resolvedRows = balancees.filter((b) => b.resolved);
  const minOpen = resolvedRows.length
    ? Math.min(...resolvedRows.map((b) => b.open))
    : 999;
  const maxOpen = resolvedRows.length ? Math.max(...resolvedRows.map((b) => b.open)) : 0;
  const spareCapacity = resolvedRows.some((b) => b.open <= 1 && (b.mark === "OPEN" || b.mark === "BUSY"));
  const pullSuggested = spareCapacity && mainOpen > 0;
  const rebalanceHint = resolvedRows.length >= 2 && maxOpen - minOpen >= 2;

  const lastPath = balanceLastPath(loaded);
  const priorText = fs.existsSync(lastPath) ? fs.readFileSync(lastPath, "utf8") : "";
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "T");

  const tableLines = [
    "# Last balance snapshot (balance lead only)",
    "",
    `**Tick:** ${stamp}`,
    "",
    "| Agent | Open TASKS | Mark | Progress vs prior |",
    "|-------|------------|------|-------------------|",
    `| ${doc.main_lead} | ${mainOpen} | ${mainMark} | ${progressNote(parsePriorOpen(priorText, doc.main_lead), mainOpen)} |`,
  ];
  for (const b of balancees) {
    tableLines.push(
      `| ${b.id} | ${b.open} | ${b.mark} | ${progressNote(parsePriorOpen(priorText, b.id), b.open)} |`,
    );
  }
  tableLines.push("");
  tableLines.push(`**Pull suggested:** ${pullSuggested ? "yes (spare capacity + main queue)" : "no"}`);
  tableLines.push(`**Rebalance hint:** ${rebalanceHint ? "yes (spread skew)" : "no"}`);
  tableLines.push(`**STATUS line:** \`${statusLine}\``);
  tableLines.push("");

  let wroteLedger = false;
  if (!opts?.dryRun) {
    fs.mkdirSync(path.dirname(lastPath), { recursive: true });
    const tmp = `${lastPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, tableLines.join("\n"));
    fs.renameSync(tmp, lastPath);
    wroteLedger = true;
  }

  return {
    statusLine,
    lastPath,
    mainLeadId: doc.main_lead,
    mainMark,
    mainOpen,
    balancees,
    pullSuggested,
    rebalanceHint,
    wroteLedger,
  };
}
