import fs from "node:fs";
import path from "node:path";
import {
  chatRoomConfigForLoaded,
  formatSuperviseStatusLine,
  hubLockActive,
  sayInRoomSync,
  type LoadedProfile,
  type ProviderRegistry,
} from "@seat-mesh/core";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { coordPaneForRole } from "../lib/pane-meta.js";
import { readSeatSnapshot } from "../seats/seat-update.js";

export interface SuperviseTickResult {
  statusLine: string;
  lastPath: string;
  materialChange: boolean;
  roomStatusPosted: boolean;
  nudged: Array<"manager" | "manager-2">;
  wroteLedger: boolean;
}

function superviseLastPath(loaded: LoadedProfile): string {
  const dir =
    loaded.profile.seats.dirs?.secretary ?? "secretary";
  return path.join(loaded.workspace, ".sm", "seats", dir, "SUPERVISE-LAST.md");
}

function parsePriorLine(lastText: string, key: "manager" | "manager-2"): string | null {
  const re =
    key === "manager"
      ? /\|\s*manager\s*\|\s*(\d+)\s*\|\s*(\w+)\s*\|/
      : /\|\s*manager-2\s*\|\s*(\d+)\s*\|\s*(\w+)\s*\|/;
  const m = lastText.match(re);
  if (!m) return null;
  return `${m[2]}:${m[1]}`;
}

function leadIdle(registry: ProviderRegistry, paneId: string): boolean {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  const prov = registry.detect(snap);
  if (!prov) return false;
  const st = prov.composerState(snap);
  return (
    st.phase === "empty" ||
    st.phase === "afk" ||
    st.phase === "plain_shell"
  );
}

export interface SuperviseTickOpts {
  session: string;
  baseWindow: string;
  registry: ProviderRegistry;
  /** Deliver CONTINUE to idle lead with open TASKS (intent=continue). Return whether paste ok. */
  deliverContinue?: (role: "manager" | "manager-2", paneId: string) => boolean;
  dryRun?: boolean;
}

/** Daemon-native supervise — writes SUPERVISE-LAST, optional managers room STATUS, lead nudges. */
export function runSuperviseTick(
  loaded: LoadedProfile,
  opts: SuperviseTickOpts,
): SuperviseTickResult {
  const mgr = readSeatSnapshot(loaded, { role: "manager" });
  const m2 = readSeatSnapshot(loaded, { role: "manager-2" });
  const managerMark = mgr?.focus.mark ?? "?";
  const managerOpen = mgr?.tasks.open ?? 0;
  const manager2Mark = m2?.focus.mark ?? "?";
  const manager2Open = m2?.tasks.open ?? 0;

  const statusLine = formatSuperviseStatusLine({
    managerMark,
    managerOpen,
    manager2Mark,
    manager2Open,
  });

  const lastPath = superviseLastPath(loaded);
  const priorText = fs.existsSync(lastPath) ? fs.readFileSync(lastPath, "utf8") : "";
  const priorMgr = parsePriorLine(priorText, "manager");
  const priorM2 = parsePriorLine(priorText, "manager-2");
  const nowMgr = `${managerMark}:${managerOpen}`;
  const nowM2 = `${manager2Mark}:${manager2Open}`;
  const materialChange =
    priorMgr !== nowMgr ||
    priorM2 !== nowM2 ||
    !priorText.trim();

  const stamp = new Date().toISOString().slice(0, 16).replace("T", "T");
  const tableLines = [
    "# Last supervise snapshot (daemon tick — secretary pane not required)",
    "",
    `**Tick:** ${stamp}`,
    "",
    "| Lead | Open TASKS | Mark | vs prior |",
    "|------|------------|------|----------|",
    `| manager | ${managerOpen} | ${managerMark} | ${priorMgr === nowMgr ? "same" : `${priorMgr ?? "?"} -> ${nowMgr}`} |`,
    `| manager-2 | ${manager2Open} | ${manager2Mark} | ${priorM2 === nowM2 ? "same" : `${priorM2 ?? "?"} -> ${nowM2}`} |`,
    "",
    `**STATUS line:** \`${statusLine}\``,
    "",
  ];

  let wroteLedger = false;
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(lastPath), { recursive: true });
    const tmp = `${lastPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, tableLines.join("\n"));
    fs.renameSync(tmp, lastPath);
    wroteLedger = true;
  }

  let roomStatusPosted = false;
  if (materialChange && !hubLockActive(loaded.workspace) && !opts.dryRun) {
    try {
      const cfg = chatRoomConfigForLoaded(loaded);
      sayInRoomSync(loaded.workspace, cfg, "managers", "secretary", statusLine, {
        kind: "status",
        expectReply: false,
      });
      roomStatusPosted = true;
    } catch {
      roomStatusPosted = false;
    }
  }

  const nudged: Array<"manager" | "manager-2"> = [];
  if (opts.deliverContinue && !opts.dryRun) {
    const pairs: Array<{ role: "manager" | "manager-2"; open: number }> = [
      { role: "manager", open: managerOpen },
      { role: "manager-2", open: manager2Open },
    ];
    for (const { role, open } of pairs) {
      if (open <= 0) continue;
      const paneId = coordPaneForRole(opts.session, opts.baseWindow, role);
      if (!paneId) continue;
      if (!leadIdle(opts.registry, paneId)) continue;
      if (opts.deliverContinue(role, paneId)) nudged.push(role);
    }
  }

  return {
    statusLine,
    lastPath,
    materialChange,
    roomStatusPosted,
    nudged,
    wroteLedger,
  };
}
