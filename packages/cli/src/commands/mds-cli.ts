/**
 * `seatmesh agent mds …` — three MD galleries:
 *   hosted | agent-self | agent <kind>
 */
import type { LoadedProfile } from "@seat-mesh/core";
import {
  AGENT_MD_KINDS,
  defaultHubOrigin,
  hostMarkdownIntoSm,
  hostedMdHubUrl,
  hostedToRefs,
  listAgentKindMds,
  listAgentSelfMds,
  listHostedMds,
  parseAgentMdKind,
  readAgentKindMd,
  readAgentSelfMd,
  readHostedMd,
  type AgentMdRef,
} from "@seat-mesh/core";
import { runWhoami } from "@seat-mesh/tmux";

function printHelp(): void {
  console.log(`mds — markdown galleries (CLI ↔ hub /mds)

  mds                         overview (counts + hub URL)
  mds hosted [list]           list .sm/mds (hub gallery)
  mds hosted host <file.md> [--as slug]   copy into .sm/mds + print hub URL
  mds hosted show <slug>      print body (+ hub URL)
  mds hosted url <slug>       print hub URL only

  mds agent-self [list]       this seat FOCUS/TASKS/REMINDER + _shared
  mds agent-self show <id>    e.g. FOCUS.md | TASKS | _shared/NOTES.md
  mds agent-self [--seat <col>] …

  mds agent <kind> [list]     role POV: common|manager|secretary|worker|mini
  mds agent <kind> show       print that kind's locked doc

  mds preview …               alias → seatmesh preview (mdview.io)

Hub: ${defaultHubOrigin()}/mds
Hosted files: .sm/mds/  ·  agent-self: .sm/seats/<you>/  ·  agent kind: .sm/roles/_vendor/docs/
Parity: docs/patterns/cli-web-parity.md`);
}

function printRefs(rows: AgentMdRef[]): void {
  if (!rows.length) {
    console.log("(none)");
    return;
  }
  for (const r of rows) {
    const when = r.when ? r.when.slice(0, 19) : "-";
    const url = r.url ? `\t${r.url}` : "";
    const note = r.note ? `\t${r.note}` : "";
    console.log(`${r.id}\t${r.title}\t${when}${note}${url}`);
  }
}

function resolveSeatColumn(loaded: LoadedProfile, seatFlag?: string): string {
  if (seatFlag?.trim()) return seatFlag.trim();
  try {
    const w = runWhoami(loaded);
    return (
      (w.slotLabel && String(w.slotLabel)) ||
      (w.ports && String(w.ports)) ||
      (w.role && String(w.role)) ||
      "manager"
    );
  } catch {
    return "manager";
  }
}

function takeFlag(args: string[], name: string): { value?: string; rest: string[] } {
  const out: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === name || a === `--${name.replace(/^--/, "")}`) {
      value = args[++i];
      continue;
    }
    if (a.startsWith(`${name}=`)) {
      value = a.slice(name.length + 1);
      continue;
    }
    out.push(a);
  }
  return { value, rest: out };
}

export async function runMdsCommand(loaded: LoadedProfile, argv: string[]): Promise<number> {
  const raw = argv.filter((a) => a !== "--json");
  if (raw[0] === "help" || raw[0] === "-h" || raw[0] === "--help") {
    printHelp();
    return 0;
  }

  const scope = raw[0] ?? "status";

  // Overview
  if (scope === "status" || scope === "overview") {
    const seat = resolveSeatColumn(loaded);
    const hosted = listHostedMds(loaded);
    const self = listAgentSelfMds(loaded, seat);
    const kinds = listAgentKindMds(loaded);
    console.log(`mds overview  hub=${defaultHubOrigin()}/mds`);
    console.log(`  hosted=${hosted.length}  (.sm/mds)`);
    console.log(`  agent-self=${self.length}  (seat=${seat})`);
    console.log(`  agent-kind=${kinds.length}  [${AGENT_MD_KINDS.join(",")}]`);
    console.log(`  tip: mds hosted | mds agent-self | mds agent manager`);
    return 0;
  }

  if (scope === "preview") {
    console.error("hint: use seatmesh agent preview <file.md> (mdview.io) — or: mds hosted host <file.md>");
    return 2;
  }

  // ── hosted ──────────────────────────────────────────────
  if (scope === "hosted" || scope === "host") {
    const sub = raw[1] ?? "list";
    if (sub === "list" || sub === "ls") {
      printRefs(hostedToRefs(listHostedMds(loaded), loaded));
      return 0;
    }
    if (sub === "host" || sub === "put" || sub === "add") {
      const { value: asSlug, rest } = takeFlag(raw.slice(2), "--as");
      const file = rest.find((a) => !a.startsWith("-"));
      if (!file) {
        console.error("usage: mds hosted host <file.md> [--as slug]");
        return 2;
      }
      try {
        const { slug, absPath } = hostMarkdownIntoSm(loaded, file, asSlug);
        const url = hostedMdHubUrl(loaded, slug);
        console.log(`ok hosted ${slug}`);
        console.log(`  file=${absPath}`);
        console.log(`  url=${url}`);
        return 0;
      } catch (e) {
        console.error(`FAIL: ${(e as Error).message}`);
        return 1;
      }
    }
    if (sub === "show" || sub === "cat" || sub === "url") {
      const slug = raw[2];
      if (!slug) {
        console.error(`usage: mds hosted ${sub} <slug>`);
        return 2;
      }
      if (sub === "url") {
        console.log(hostedMdHubUrl(loaded, slug));
        return 0;
      }
      const doc = readHostedMd(loaded, slug);
      if (!doc) {
        console.error(`not found: hosted ${slug}`);
        return 1;
      }
      console.log(`# ${doc.title}`);
      console.log(`file=${doc.absPath}`);
      console.log(`url=${hostedMdHubUrl(loaded, slug)}`);
      console.log("---");
      console.log(doc.body);
      return 0;
    }
    // bare `mds hosted` → list; or `mds hosted <slug>` → show
    if (sub !== "help") {
      const maybeSlug = sub;
      const doc = readHostedMd(loaded, maybeSlug);
      if (doc) {
        console.log(`# ${doc.title}`);
        console.log(`url=${hostedMdHubUrl(loaded, maybeSlug)}`);
        console.log("---");
        console.log(doc.body);
        return 0;
      }
      printRefs(hostedToRefs(listHostedMds(loaded), loaded));
      return 0;
    }
    printHelp();
    return 0;
  }

  // ── agent-self ──────────────────────────────────────────
  if (scope === "agent-self" || scope === "self" || scope === "seat") {
    const { value: seatFlag, rest } = takeFlag(raw.slice(1), "--seat");
    const seat = resolveSeatColumn(loaded, seatFlag);
    const sub = rest[0] ?? "list";
    if (sub === "list" || sub === "ls") {
      console.log(`agent-self seat=${seat}`);
      printRefs(listAgentSelfMds(loaded, seat));
      return 0;
    }
    if (sub === "show" || sub === "cat") {
      const id = rest[1];
      if (!id) {
        console.error("usage: mds agent-self show <FOCUS.md|TASKS|_shared/NOTES.md>");
        return 2;
      }
      const doc = readAgentSelfMd(loaded, seat, id);
      if (!doc) {
        console.error(`not found: agent-self ${id} (seat=${seat})`);
        return 1;
      }
      console.log(`# ${doc.title}`);
      console.log(`file=${doc.absPath}`);
      console.log("---");
      console.log(doc.body);
      return 0;
    }
    // bare list
    console.log(`agent-self seat=${seat}`);
    printRefs(listAgentSelfMds(loaded, seat));
    return 0;
  }

  // ── agent <kind> ────────────────────────────────────────
  if (scope === "agent" || scope === "kind" || scope === "role") {
    const kindRaw = raw[1];
    const kind = parseAgentMdKind(kindRaw);
    if (!kind) {
      console.error(`usage: mds agent <${AGENT_MD_KINDS.join("|")}> [list|show]`);
      console.log("available:");
      printRefs(listAgentKindMds(loaded));
      return 2;
    }
    const sub = raw[2] ?? "show";
    if (sub === "list" || sub === "ls") {
      printRefs(listAgentKindMds(loaded).filter((r) => r.id === kind));
      return 0;
    }
    // show (default)
    const doc = readAgentKindMd(loaded, kind);
    if (!doc) {
      console.error(`not found: agent kind ${kind} under roles/_vendor/docs`);
      return 1;
    }
    console.log(`# ${doc.title}`);
    console.log(`file=${doc.absPath}`);
    console.log(`kind=${kind}`);
    console.log("---");
    console.log(doc.body);
    return 0;
  }

  // Convenience: `mds list` → hosted list
  if (scope === "list" || scope === "ls") {
    printRefs(hostedToRefs(listHostedMds(loaded), loaded));
    return 0;
  }

  console.error(`unknown mds scope: ${scope}`);
  printHelp();
  return 2;
}
