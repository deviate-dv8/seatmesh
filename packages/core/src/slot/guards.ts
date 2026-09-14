import type { CommsAction, SlotGuard, SlotRole } from "./types.js";

/** Default guards — profile may override/extend. Same features, different allow lists. */
export const DEFAULT_GUARDS: Record<SlotRole, SlotGuard> = {
  manager: {
    role: "manager",
    allow: [
      "send.coord",
      "spawn.mini",
      "prompt.worker",
      "snapshot.cold",
      "nav.log",
    ],
    deny: ["merge", "board.mutate"],
  },
  secretary: {
    role: "secretary",
    allow: [
      "send.coord",
      "send.toMaster", // digest bulk only via daemon filter
      "spawn.mini",
      "snapshot.cold",
      "nav.log",
    ],
    deny: ["prompt.worker", "merge", "board.mutate"],
  },
  worker: {
    role: "worker",
    allow: [
      "send.toMaster",
      "send.peer",
      "snapshot.cold",
      "nav.log",
    ],
    deny: ["spawn.mini", "prompt.worker", "merge", "board.mutate"],
  },
  mini: {
    role: "mini",
    allow: ["send.peer", "snapshot.cold", "nav.log"],
    deny: [
      "send.toMaster",
      "spawn.mini",
      "prompt.worker",
      "merge",
      "board.mutate",
    ],
  },
  plain: {
    role: "plain",
    allow: ["snapshot.cold", "nav.log"],
    deny: [
      "send.toMaster",
      "send.peer",
      "send.coord",
      "spawn.mini",
      "prompt.worker",
      "merge",
      "board.mutate",
    ],
  },
};

export function guardAllows(role: SlotRole, action: CommsAction): boolean {
  const g = DEFAULT_GUARDS[role];
  if (g.deny?.includes(action)) return false;
  return g.allow.includes(action);
}
