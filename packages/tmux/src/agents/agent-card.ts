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
    m('peer <target> "<msg>" [--ended <ack-id>]'),
    m("to-slot <N> <msg>"),
    m("to-mini <N> <msg>"),
    m('room say [-r slug] <msg>'),
  ],
  "send.coord": [
    m('peer <coord> "<msg>" [--ended <ack-id>]'),
    m("room broadcast <msg>"),
    m('room say [-r slug] <msg>'),
    m("to-master <coord>"),
  ],
  "spawn.mini": [
    m("mini spawn [--role R] <task>"),
    m("mini list | prompt | done | kill | reassign"),
  ],
  "prompt.worker": [
    m('assign <target> "<msg>"'),
    m("prompt <slot> <msg>"),
    m("remind <slot|all> [note]"),
    m("switch|handoff <target> <cli> [reason]"),
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
  m("whoami [target]"),
  m('notify "<session>" "<check>" [--url <link>]   ← operator eyes (beta)'),
  m('notify info|md "<title>" --md <file>|--body "…"   ← craft Info on /act/card UI'),
  m('notify yesno "<title>" "<blurb>" [--md file]   ← Info+Yes/No on same UI card'),
  m('ack <id> "<note>" | ack | ack clear'),
  m("cb list | cb cancel <id>   ← STOP renew (chat does NOT)"),
  m('cb start <dur> --expect "…"'),
  m('peer <target> "<msg>" [--ended <ack-id>]'),
  m("room tail [-r slug]"),
  m("contexts"),
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
    m("launch [targets]"),
    m("verify | reload | labels"),
  ],
  secretary: [
    m("secretary dispatch|collect|watch on|off"),
    m("mini spawn (tester|code-reviewer|helper only)"),
    m("limit idle [--all|--pane %N]"),
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
