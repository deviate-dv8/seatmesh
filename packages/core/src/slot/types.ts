import { z } from "zod";

export const SlotRoleSchema = z.enum([
  "manager",
  "secretary",
  "worker",
  "mini",
  "plain",
]);

export type SlotRole = z.infer<typeof SlotRoleSchema>;

/** Canonical slot id: manager | secretary | worker-N | mini-N */
export const SlotIdSchema = z.union([
  z.literal("manager"),
  z.literal("secretary"),
  z.string().regex(/^worker-[1-9]$/),
  z.string().regex(/^mini-[1-9]$/),
]);

export type SlotId = z.infer<typeof SlotIdSchema>;

export interface SlotRef {
  id: SlotId;
  role: SlotRole;
  paneId?: string;
  ports?: string;
  numeric?: number; // worker 1-6 or mini 1-8
}

export type CommsAction =
  | "send.toMaster"
  | "send.peer"
  | "send.coord"
  | "spawn.mini"
  | "prompt.worker"
  | "merge"
  | "board.mutate"
  | "snapshot.cold"
  | "nav.log";

export interface SlotGuard {
  role: SlotRole;
  allow: CommsAction[];
  deny?: CommsAction[];
}

export interface SeatFileBundle {
  focus: string;
  tasks: string;
  reminder: string;
  navJsonl?: string;
}

export interface PaneRuntime {
  paneId: string;
  windowName: string;
  cwd: string;
  currentCommand: string;
  captureTail: string;
  providerId?: string;
  resumeId?: string;
  composerPhase?: string;
  borderTitle?: string;
  borderStatus?: string;
}

export interface SlotSnapshotMeta {
  slug?: string;
  hub?: string;
  mark?: string;
  sourceDir?: string;
}

/** Cold archive and/or live capture — same type for all slot kinds. */
export interface SlotSnapshot {
  id: SlotId;
  role: SlotRole;
  takenAt: string;
  files?: SeatFileBundle;
  runtime?: PaneRuntime;
  meta: SlotSnapshotMeta;
}

export function parseSlotId(raw: string): SlotRef | null {
  if (raw === "manager") return { id: "manager", role: "manager" };
  if (raw === "secretary") return { id: "secretary", role: "secretary" };
  const wm = raw.match(/^worker-(\d+)$/);
  if (wm) {
    const n = Number(wm[1]);
    return { id: raw as SlotId, role: "worker", numeric: n, ports: `30${n}0/30${n}1` };
  }
  const mm = raw.match(/^mini-(\d+)$/);
  if (mm) {
    const n = Number(mm[1]);
    return { id: raw as SlotId, role: "mini", numeric: n, ports: `mini-${n}` };
  }
  // Legacy: slot-N -> worker-N
  const lm = raw.match(/^slot-(\d+)$/);
  if (lm) {
    const n = Number(lm[1]);
    return { id: `worker-${n}` as SlotId, role: "worker", numeric: n, ports: `30${n}0/30${n}1` };
  }
  return null;
}
