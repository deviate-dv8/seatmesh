import fs from "node:fs";
import path from "node:path";
import {
  chatRoomConfigForLoaded,
  listRooms,
  loadRoomProfile,
  meshRuntimePaths,
  resolveAgentId,
  roomDir,
  runtimePathHint,
  unseenSummaryForAgent,
  isManagerKind,
  type LoadedProfile,
} from "@seat-mesh/core";
import type { WhoamiResult } from "./whoami.js";

interface CheckbackRow {
  id: string;
  kind: string;
  status: string;
  expect?: string;
  ownerPane?: string;
  expiresAt?: string;
}

interface InboxRow {
  id: string;
  at: string;
  from: string;
  msg: string;
  resolved: boolean;
}

interface MiniRow {
  id: number;
  paneId?: string;
  job_role?: string;
  status?: string;
  hub?: string;
  task?: string;
}

function readJsonl<T>(file: string, parse: (row: unknown) => T | null): T[] {
  if (!fs.existsSync(file)) return [];
  const out: T[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = parse(JSON.parse(t));
      if (row) out.push(row);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function roomMembership(
  loaded: LoadedProfile,
  agentId: string,
): { slug: string; role: string; scope?: string }[] {
  const cfg = chatRoomConfigForLoaded(loaded);
  const out: { slug: string; role: string; scope?: string }[] = [
    { slug: cfg.globalSlug, role: "implicit-all-agents" },
  ];
  for (const slug of listRooms(loaded.workspace, cfg)) {
    if (slug === cfg.globalSlug) continue;
    const prof = loadRoomProfile(roomDir(loaded.workspace, cfg, slug));
    if (!prof) continue;
    const members = prof.members ?? [];
    let role = "";
    const leadWorkers = (prof.leadWorkers ?? []).map((w) =>
      w.startsWith("slot-") ? `worker-${w.slice(5)}` : w.startsWith("worker-") ? w : `worker-${w}`,
    );
    const multiLeads = prof.leads ?? (prof.lead ? [prof.lead] : []);
    if (multiLeads.includes(agentId) || prof.lead === agentId) role = "lead";
    else if (prof.supervisor === agentId) role = "supervisor";
    else if (leadWorkers.includes(agentId)) role = "lead-worker";
    else if (members.includes(agentId)) role = "member";
    else if (slug === "supervise" && agentId === "manager") role = "observer";
    else continue;
    out.push({ slug, role, scope: prof.scope?.trim() });
  }
  return out;
}

function commsOneLiner(role: string, mini: string | null, workerCount: number): string {
  if (isManagerKind(role)) {
    return "comms: room say -r supervise|-r managers | checkback list | peer workers";
  }
  if (role === "secretary") {
    return "comms: room broadcast|say | to-master digest | secretary collect --nudge";
  }
  if (role === "manager-mini" || mini) {
    return `comms: room say [--room supervise] | mini done ${mini ?? "N"} | mini peer (dev harness)`;
  }
  return `comms: room call|say|accept (checkback default) | to-slot 1-${workerCount} | room read marks seen | to-master PROVED|DONE only`;
}

/** Extra whoami lines: agent id, rooms, checkbacks, mini task, inbox, comms. */
export function buildWhoamiContextLines(
  loaded: LoadedProfile,
  w: WhoamiResult,
  opts: { mini?: string; jobRole?: string } = {},
): string[] {
  const lines: string[] = [];
  const mini = opts.mini || null;
  const agentId = resolveAgentId({
    role: w.role,
    slot: w.slot,
    mini: mini ? Number(mini) : null,
  });

  lines.push("--- context ---");
  lines.push(`agent_id=${agentId}`);
  lines.push("fresh_summon=run ./sm.sh whoami first; hub is that dump; later peer is a task");
  if (mini) lines.push(`mini=${mini}`);
  if (opts.jobRole) lines.push(`job_role=${opts.jobRole}`);

  const leads = loaded.profile.layout?.minis?.leads ?? [1, 2];
  if (mini && leads.includes(Number(mini))) {
    lines.push(`mini_lead=yes (grid leads: ${leads.map((n) => `mini-${n}`).join(", ")})`);
  }

  if (w.ports) lines.push(`ports_paired=${w.ports}`);
  lines.push("staging_sim=http://localhost:5080 (gateway; not :3000/:3080)");

  const rooms = roomMembership(loaded, agentId);
  lines.push("--- rooms ---");
  for (const r of rooms) {
    const scope = r.scope ? ` | ${truncate(r.scope, 72)}` : "";
    lines.push(`room=${r.slug} role=${r.role}${scope}`);
  }
  lines.push("room_cmds=./sm.sh room tail -n 30 | ./sm.sh room tail -r supervise -n 20");

  const cfg = chatRoomConfigForLoaded(loaded);
  const superviseSlug = listRooms(loaded.workspace, cfg).includes("supervise")
    ? "supervise"
    : null;
  if (superviseSlug) {
    const unseen = unseenSummaryForAgent(loaded.workspace, cfg, superviseSlug, agentId);
    const prof = loadRoomProfile(roomDir(loaded.workspace, cfg, superviseSlug));
    const leadWorkers = (prof?.leadWorkers ?? []).map((id) =>
      id.startsWith("slot-") ? `worker-${id.slice(5)}` : id.startsWith("worker-") ? id : `worker-${id}`,
    );
    const multiLeads = prof?.leads ?? (prof?.lead ? [prof.lead] : []);
    const gridLeads = (loaded.profile.layout?.minis?.leads ?? []).map((n) => `mini-${n}`);
    const isAudience =
      prof?.members?.includes(agentId) ||
      multiLeads.includes(agentId) ||
      prof?.lead === agentId ||
      gridLeads.includes(agentId) ||
      leadWorkers.includes(agentId) ||
      prof?.supervisor === agentId ||
      agentId === "manager" ||
      w.role === "secretary" ||
      w.role === "manager" ||
      Boolean(mini);
    if (isAudience) {
      lines.push("--- supervise inbox (room ledger) ---");
      lines.push(`supervise_unseen=${unseen}`);
      lines.push(`supervise_path=tasks/chat-rooms/${superviseSlug}/ROOM.jsonl`);
      lines.push(`supervise_tail=./sm.sh room tail -r ${superviseSlug} -n 20`);
      if (unseen > 0) {
        lines.push(`supervise_hint=${unseen} unseen — run supervise_tail before continuing`);
      }
    }
  }

  const rt = meshRuntimePaths(loaded);

  if (w.paneId) {
    const cbs = readJsonl<CheckbackRow>(rt.checkbackJsonl, (row) => {
      const r = row as CheckbackRow;
      if (r.status !== "active" || r.ownerPane !== w.paneId) return null;
      return r;
    });
    lines.push("--- checkbacks (this pane) ---");
    if (!cbs.length) {
      lines.push("checkback=none active");
    } else {
      for (const cb of cbs.slice(0, 5)) {
        lines.push(
          `checkback=${cb.id} kind=${cb.kind} expect=${truncate(cb.expect ?? cb.kind, 64)}`,
        );
      }
      if (cbs.length > 5) lines.push(`checkback_more=${cbs.length - 5}`);
      lines.push("checkback_cmds=./sm.sh checkback list | ./sm.sh checkback cancel <id>");
    }
  }

  if (mini) {
    const miniDir = path.join(
      loaded.workspace,
      loaded.profile.seats.root,
      (loaded.profile.seats.dirs?.mini ?? "mini-{n}").replace("{n}", mini),
    );
    lines.push("--- mini seat files ---");
    lines.push(`mini_focus=${miniDir}/FOCUS.md`);
    lines.push(`mini_tasks=${miniDir}/TASKS.md`);
    lines.push(`gate_queue=${runtimePathHint(loaded.workspace, rt.gateQueue)}`);
    lines.push("cold_start=./sm.sh cold-start (full hub inline)");

    const minisPath = rt.minisJson;
    if (fs.existsSync(minisPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(minisPath, "utf8")) as {
          minis?: Record<string, MiniRow>;
          campaign?: string;
        };
        const row = data.minis?.[mini];
        if (row) {
          lines.push(`mini_campaign_status=${row.status ?? "?"}`);
          if (row.hub && row.hub !== "-") lines.push(`mini_campaign_hub=${row.hub}`);
        }
        if (data.campaign) lines.push(`campaign=${data.campaign}`);
      } catch {
        /* optional legacy minis.json */
      }
    }
  }

  if (w.role === "worker" && w.slot != null) {
    lines.push(`gate_queue=${runtimePathHint(loaded.workspace, rt.gateQueue)}`);
    lines.push("fresh_summon=run ./sm.sh whoami first; hub is that dump; later peer is a task");
    lines.push("cold_start=./sm.sh whoami (includes GATE-QUEUE + open TASKS inline)");
  }

  if (w.role === "manager") {
    const inbox = readJsonl<InboxRow>(rt.inboxJsonl, (row) => {
      const r = row as InboxRow;
      if (r.resolved) return null;
      return r;
    });
    lines.push("--- inbox (unresolved) ---");
    lines.push(`inbox_unresolved=${inbox.length}`);
    for (const row of inbox.slice(-3)) {
      lines.push(`inbox=${row.id.slice(0, 8)} from=${row.from} ${truncate(row.msg, 80)}`);
    }
    lines.push(`inbox_path=${runtimePathHint(loaded.workspace, rt.inboxJsonl)}`);
  }

  lines.push("--- comms ---");
  lines.push(commsOneLiner(w.role, mini, loaded.profile.session.workerCount));
  lines.push("checkback_vs_supervise=checkback=poll-later self; supervise=secretary->manager only (./sm.sh secretary supervise)");
  lines.push("slot_vs_mini=slot-N=worker 30N0/30N1; mini-N=minis window only");

  return lines;
}
