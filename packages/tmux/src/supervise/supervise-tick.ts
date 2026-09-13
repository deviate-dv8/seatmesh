import fs from "node:fs";
import path from "node:path";
import {
  chatRoomConfigForLoaded,
  formatSuperviseStatusLine,
  hubLockActive,
  managerColumnIds,
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
  nudged: string[];
  wroteLedger: boolean;
}

function superviseLastPath(loaded: LoadedProfile): string {
  const dir =
    loaded.profile.seats.dirs?.secretary ?? "secretary";
  return path.join(loaded.workspace, ".sm", "seats", dir, "SUPERVISE-LAST.md");
}

function parsePriorLine(lastText: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\|\\s*${esc}\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\w+)\\s*\\|`);
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
  deliverContinue?: (role: string, paneId: string) => boolean;
  dryRun?: boolean;
}

/** Daemon-native supervise — writes SUPERVISE-LAST, optional managers room STATUS, lead nudges. */
export function runSuperviseTick(
  loaded: LoadedProfile,
  opts: SuperviseTickOpts,
): SuperviseTickResult {
  const mgrIds = managerColumnIds(loaded.profile.layout);
  const leads = mgrIds.map((id) => {
    const snap = readSeatSnapshot(loaded, { role: id });
    return {
      id,
      mark: snap?.focus.mark ?? "?",
      open: snap?.tasks.open ?? 0,
    };
  });
  const statusLine = formatSuperviseStatusLine(leads);

  const lastPath = superviseLastPath(loaded);
  const priorText = fs.existsSync(lastPath) ? fs.readFileSync(lastPath, "utf8") : "";
  const nowById = new Map(leads.map((l) => [l.id, `${l.mark}:${l.open}`]));
  const materialChange =
    !priorText.trim() ||
    leads.some((l) => parsePriorLine(priorText, l.id) !== nowById.get(l.id));

  const stamp = new Date().toISOString().slice(0, 16).replace("T", "T");
  const tableLines = [
    "# Last supervise snapshot (daemon tick — secretary pane not required)",
    "",
    `**Tick:** ${stamp}`,
    "",
    "| Lead | Open TASKS | Mark | vs prior |",
    "|------|------------|------|----------|",
    ...leads.map((l) => {
      const now = nowById.get(l.id) ?? `${l.mark}:${l.open}`;
      const prior = parsePriorLine(priorText, l.id);
      return `| ${l.id} | ${l.open} | ${l.mark} | ${prior === now ? "same" : `${prior ?? "?"} -> ${now}`} |`;
    }),
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

  const nudged: string[] = [];
  if (opts.deliverContinue && !opts.dryRun) {
    for (const lead of leads) {
      if (lead.open <= 0) continue;
      const paneId = coordPaneForRole(opts.session, opts.baseWindow, lead.id);
      if (!paneId) continue;
      if (!leadIdle(opts.registry, paneId)) continue;
      if (opts.deliverContinue(lead.id, paneId)) nudged.push(lead.id);
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
