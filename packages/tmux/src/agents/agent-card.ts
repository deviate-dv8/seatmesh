import {
  DEFAULT_GUARDS,
  seatmeshCmd,
  type CommsAction,
  type SlotGuard,
  type SlotRole,
} from "@seat-mesh/core";

const m = (sub: string) => seatmeshCmd(sub);
import type { WhoamiResult } from "./whoami.js";

/** Map tmux mesh role -> guard role + optional extra deny. */
export function resolveGuardRole(w: WhoamiResult): {
  guardRole: SlotRole;
  seatKind: string;
  extraDeny: CommsAction[];
} {
  const r = w.role.trim().toLowerCase();
  if (!r || r === "plain") {
    return { guardRole: "plain", seatKind: "plain", extraDeny: [] };
  }
  if (r === "manager-mini") {
    return { guardRole: "mini", seatKind: "mini", extraDeny: [] };
  }
  if (r === "secretary") {
    return { guardRole: "secretary", seatKind: "secretary", extraDeny: [] };
  }
  if (r === "manager") {
    return { guardRole: "manager", seatKind: "manager", extraDeny: [] };
  }
  if (r === "worker") {
    return { guardRole: "worker", seatKind: "worker", extraDeny: [] };
  }
  return { guardRole: "worker", seatKind: "worker", extraDeny: [] };
}

const ACTION_COMMANDS: Record<CommsAction, string[]> = {
  "send.toMaster": [m("to-master <msg>")],
  "send.peer": [
    m('peer <target> "<msg>" [--ack|--ended [id]]  ← reply+close; ACK/FYI msg auto --ack'),
    m('ack <id> | ack reply <id> [msg]  ← close only | peer-back+close'),
    m("to-slot <N> <msg>"),
    m("to-mini <N> <msg>"),
    m('room say [-r slug] <msg>'),
  ],
  "send.coord": [
    m('peer <coord> "<msg>" [--ack|--ended [id]]'),
    m("room broadcast <msg>"),
    m('room say [-r slug] <msg>'),
    m("to-master <coord>"),
  ],
  "spawn.mini": [
    m("mini spawn [--role R] <task>"),
    m("mini list | prompt | done | kill | reassign"),
  ],
  "prompt.worker": [
    m('todo give <target> "<msg>"  ← preferred over assign'),
    m('assign <target> "<msg>"'),
    m("prompt <slot> <msg>"),
    m("remind <slot|all> [note]"),
    m("spawn <target> <cli>          ← empty→CLI"),
    m("switch|handoff <target> <cli> [reason]  ← replace live"),
    m("continue <slot|all> (night)"),
    m("flush <target>"),
  ],
  "snapshot.cold": [m("snapshot here <slug>")],
  "nav.log": [m("nav log ... (if enabled)")],
  merge: ["merge / QA column / board mutate (operator only — not CLI)"],
  "board.mutate": ["board column moves (operator only)"],
};

/**
 * Shared baseline — every in-session agent (via `agent <cmd>` gateway).
 * patterns.md: one surface; card lists exactly what `agent` will allow.
 */
const BASE_COMMANDS = [
  m(""), // → seatmesh agent  (card)
  m("help [cmd]  ← usage for one verb (also: <cmd> --help)"),
  m("whoami [target]"),
  m('notify "<session>" "<check>" [--url <link>]   ← eyes only'),
  m('notify info|md "<title>" --body "…"|--md file   ← Info card (no Yes/No)'),
  m('notify yesno "<title>" "<blurb>" --body "…" [--target seat]  ← Info+Yes/No'),
  m('notify run|cmd "<title>" --cmd "…" [--body "…"]  ← Review → see cmd → Run|Decline'),
  m("  help notify  ← full notify recipe (link|info|yesno|run)"),
  m("preview <file.md> [--set days] [--notify]  ← publish MD+Mermaid → mdview.io URL"),
  m("mds hosted|agent-self|agent <kind>  ← .sm/mds hub gallery · seat MDs · role POV"),
  m('ack <id> "<note>" | ack | ack clear'),
  m("cb list | cb cancel <id>   ← STOP renew (chat does NOT)"),
  m('cb start <dur> --expect "…"'),
  m('ask <target> "<msg>"     ← send (open ask)'),
  m('msg <target> "<msg>"     ← send (alias: tell)'),
  m('ackmsg <target> "<msg>"  ← send + close ask (peer --ack)'),
  m('reply <ack-id> [msg]     ← ack reply + close'),
  m('peer <target> "<msg>" [--ack|--ended [id]]'),
  m("room tail [-r slug]"),
  m("hub [contexts|todos|acks|cbs|chat|room|shared|sessions]  ← retrieve + CRUD map (alias: get)"),
  m("sessions [--json]  ← other live meshes + @alias peer hint"),
  m('remote [<alias> <seat>|<@alias:seat>] "<msg>"  ← list meshes OR cross-mesh peer'),
  m("chat tail | chat query  ← prompt/response history"),
  m("read-history | history  ← same as hub chat (+ room tip)"),
  m('todo give <target> "…" | todo <target> "…"  ← GIVE work (all agents)'),
  m("todo list|add|check …"),
  m('seat task list|add|check [target] "…"'),
  m("contexts"),
  m("ppa [--raw] [--idle SEC]  ← who is slacking? (idle∧open work)"),
  m("peek <target> status|full"),
  m("kind <target>   ← agent vs terminal (alias: what | typeof)"),
  m("inbox"),
];

const ROLE_EXTRA_CAN: Record<string, string[]> = {
  manager: [
    m("triage (read)"),
    m("secretary start|status|digest"),
    m("inbox restart"),
    m("limit idle [--all|--pane %N]  ← CC-LIMIT banner → idle (CBs stay)"),
    m("ack redirect <mini-N>  ← temp block wrong ACK target → secretary"),
    m("swap <a> <b> [--identity]  ← visual pane swap; --identity exchanges numbers+seats"),
    m("launch [targets]"),
    m("verify | rebuild|reload | labels"),
  ],
  secretary: [
    m("secretary dispatch|collect|watch on|off"),
    m("mini spawn (tester|code-reviewer|helper only)"),
    m("limit idle [--all|--pane %N]"),
    m("swap <a> <b> [--identity]"),
  ],
  worker: [],
  mini: [m("mini done <N> PASS|FAIL: ...")],
};

function allowsAction(
  guard: SlotGuard,
  extraDeny: CommsAction[],
  action: CommsAction,
): boolean {
  if (extraDeny.includes(action)) return false;
  if (guard.deny?.includes(action)) return false;
  return guard.allow.includes(action);
}

export function buildAgentCard(w: WhoamiResult): {
  lines: string[];
  can: string[];
  cannot: string[];
} {
  const { guardRole, seatKind, extraDeny } = resolveGuardRole(w);
  const guard = DEFAULT_GUARDS[guardRole];
  const can: string[] = [...BASE_COMMANDS];
  const cannot: string[] = [];

  const allActions = Object.keys(ACTION_COMMANDS) as CommsAction[];
  for (const action of allActions) {
    const cmds = ACTION_COMMANDS[action];
    if (allowsAction(guard, extraDeny, action)) {
      for (const c of cmds) {
        if (!can.includes(c)) can.push(c);
      }
    } else {
      const relevant =
        guard.allow.includes(action) ||
        guard.deny?.includes(action) ||
        extraDeny.includes(action) ||
        action === "merge" ||
        action === "board.mutate";
      if (relevant) {
        for (const c of cmds) {
          if (!cannot.includes(c)) cannot.push(c);
        }
      }
    }
  }

  for (const c of ROLE_EXTRA_CAN[seatKind] ?? []) {
    if (!can.includes(c)) can.push(c);
  }

  const slotBit =
    w.slotLabel != null
      ? `slot=${w.slotLabel}`
      : w.slot != null
        ? `slot=${w.slot}`
        : "";
  const portsBit = w.ports ? `ports=${w.ports}` : "";

  const lines: string[] = [
    `you_are=${w.role ? w.role.toUpperCase() : "PLAIN"}`,
    `seat_kind=${seatKind}`,
    `guard_role=${guardRole}`,
    ...(slotBit ? [slotBit] : []),
    ...(portsBit ? [portsBit] : []),
    `scope=${m("")} <cmd> … — only listed can; else UNAUTHORIZED`,
    "--- can ---",
    ...can.map((c) => `  ${c}`),
    "--- cannot ---",
    ...(cannot.length ? cannot.map((c) => `  ${c}`) : ["  (none beyond operator gates)"]),
    "---",
    `full_hub=${m("whoami")}`,
    "fyi=follow-ups / more inbox while busy are queued — inject when idle",
    "one_path=services/seatmesh/docs/ONE-PATH.md",
    "operator=session|update|init|report|inbox restart — without agent",
  ];

  return { lines, can, cannot };
}

export function printAgentCard(w: WhoamiResult): void {
  for (const line of buildAgentCard(w).lines) {
    console.log(line);
  }
}
