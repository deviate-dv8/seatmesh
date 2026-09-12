import {
  DEFAULT_GUARDS,
  type CommsAction,
  type SlotGuard,
  type SlotRole,
} from "@seat-mesh/core";
import type { WhoamiResult } from "./whoami.js";

/** Map tmux mesh role -> guard role + optional extra deny. */
export function resolveGuardRole(w: WhoamiResult): {
  guardRole: SlotRole;
  seatKind: string;
  extraDeny: CommsAction[];
} {
  const r = w.role.toLowerCase();
  if (r === "manager-mini") {
    return { guardRole: "mini", seatKind: "mini", extraDeny: [] };
  }
  if (r === "secretary") {
    return { guardRole: "secretary", seatKind: "secretary", extraDeny: [] };
  }
  if (r === "manager") {
    return { guardRole: "manager", seatKind: "manager", extraDeny: [] };
  }
  return { guardRole: "worker", seatKind: "worker", extraDeny: [] };
}

const ACTION_COMMANDS: Record<CommsAction, string[]> = {
  "send.toMaster": ["./sm.sh to-master <msg>"],
  "send.peer": [
    "./sm.sh to-slot <N> <msg>",
    "./sm.sh to-mini <N> <msg>",
    "./sm.sh room say [-r slug] <msg>",
  ],
  "send.coord": [
    "./sm.sh room broadcast <msg>",
    "./sm.sh room say [-r slug] <msg>",
    "./sm.sh to-master <coord>",
  ],
  "spawn.mini": [
    "./sm.sh mini spawn [--role R] <task>",
    "./sm.sh mini list | prompt | done | kill | reassign",
  ],
  "prompt.worker": [
    "./sm.sh prompt <slot> <msg>",
    "./sm.sh remind <slot|all> [note]",
    "./sm.sh switch|handoff <target> <cli> [reason]",
    "./sm.sh continue <slot|all> (night)",
    "./sm.sh flush <target>",
  ],
  "snapshot.cold": ["./sm.sh snapshot here <slug>"],
  "nav.log": ["./sm.sh nav log ... (if enabled)"],
  merge: ["merge / QA column / board mutate (operator only — not CLI)"],
  "board.mutate": ["board column moves (operator only)"],
};

/** Shared baseline — every in-session agent. */
const BASE_COMMANDS = [
  "./sm.sh agent",
  "./sm.sh whoami [target]",
  "./sm.sh checkback start|list|cancel ...",
  "./sm.sh room tail [-r slug]",
  "./sm.sh contexts",
  "./sm.sh peek <target> status|full",
  "./sm.sh inbox (health)",
  "./sm.sh profile show",
];

const ROLE_EXTRA_CAN: Record<string, string[]> = {
  manager: [
    "./sm.sh triage (read)",
    "./sm.sh secretary start|status|digest",
    "./sm.sh inbox restart",
    "./sm.sh launch [targets]",
    "./sm.sh verify | reload | labels",
  ],
  secretary: [
    "./sm.sh secretary dispatch|collect|watch on|off",
    "./sm.sh mini spawn (tester|code-reviewer|helper only)",
  ],
  worker: ["workspace notify script (operator prove)"],
  mini: ["./sm.sh mini done <N> PASS|FAIL: ..."],
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
    `you_are=${w.role.toUpperCase()}`,
    `seat_kind=${seatKind}`,
    `guard_role=${guardRole}`,
    ...(slotBit ? [slotBit] : []),
    ...(portsBit ? [portsBit] : []),
    "scope=./sm.sh agent (profile role — not full whoami hub)",
    "--- can ---",
    ...can.map((c) => `  ${c}`),
    "--- cannot ---",
    ...(cannot.length ? cannot.map((c) => `  ${c}`) : ["  (none beyond operator gates)"]),
    "---",
    "full_hub=./sm.sh whoami",
    "one_path=services/seatmesh/docs/ONE-PATH.md",
  ];

  return { lines, can, cannot };
}

export function printAgentCard(w: WhoamiResult): void {
  for (const line of buildAgentCard(w).lines) {
    console.log(line);
  }
}
