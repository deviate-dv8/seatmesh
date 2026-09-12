import { parseGridSpec, computeMinisWantOrder, normalizeMinisLeads } from "../layout/minis.js";
import type { RoomMessageKind, RoomProfile } from "./types.js";

export type FanoutDelivery = "rich" | "thin" | "skip";

export interface FanoutRoutingInput {
  targetId: string;
  from: string;
  kind: RoomMessageKind;
  body: string;
  profile: RoomProfile;
  /** Contract room with explicit members; global passes null profile members. */
  miniGrid?: string;
  miniMax?: number;
  miniLeads?: number[];
}

export function normalizeRoomAgentId(id: string): string {
  const t = id.trim();
  if (/^[1-9]$/.test(t)) return `worker-${t}`;
  if (t.startsWith("slot-")) return `worker-${t.slice(5)}`;
  return t;
}

/** Global room default audience: coord panes only — workers opt in via @mention. */
export function buildGlobalRoomAudience(miniMax: number): Set<string> {
  const audience = new Set<string>(["manager", "secretary"]);
  for (let n = 1; n <= miniMax; n++) {
    audience.add(`mini-${n}`);
  }
  return audience;
}

const SUBSTANCE_KINDS = new Set<RoomMessageKind>([
  "claim",
  "done",
  "blocked",
  "broadcast",
  "status",
]);

export function isSubstanceRoomMessage(kind: RoomMessageKind, body: string): boolean {
  if (SUBSTANCE_KINDS.has(kind)) return true;
  return /^(CLAIMED|DONE|BLOCKED|BROADCAST|STATUS)(:|\s)/im.test(body.trim());
}

/** ACK / standing-by / test noise — not manager or secretary inbox. */
export function isAckOrNoise(body: string, kind: RoomMessageKind): boolean {
  const t = body.trim();
  if (/^TEST\b/i.test(t)) return true;
  if (/^mini-\d+ ACK:/i.test(t)) return true;
  if (/\bstanding by\.?$/i.test(t)) return true;
  if (kind === "msg" && !isSubstanceRoomMessage(kind, body)) {
    if (/^ACK:/i.test(t)) return true;
  }
  return false;
}

/** Row lead for a mini in a 4x2 (leads-left) grid — e.g. mini-7 -> mini-2. */
export function rowLeadForMiniId(
  miniId: string,
  grid: string,
  max: number,
  leads: number[],
): string | null {
  const m = /^mini-(\d+)$/.exec(normalizeRoomAgentId(miniId));
  if (!m) return null;
  const n = m[1]!;
  const { cols, rows } = parseGridSpec(grid);
  const order = computeMinisWantOrder(cols, rows, max, leads);
  const idx = order.indexOf(n);
  if (idx < 0) return null;
  const row = Math.floor(idx / cols);
  const leadNum = leads[row];
  return leadNum != null ? `mini-${leadNum}` : null;
}

function profileLeads(profile: RoomProfile): string[] {
  const out: string[] = [];
  if (profile.leads?.length) {
    for (const l of profile.leads) out.push(normalizeRoomAgentId(l));
  } else if (profile.lead) {
    out.push(normalizeRoomAgentId(profile.lead));
  }
  return out;
}

/**
 * Supervise-style contract rooms: row minis -> row lead; secretary digests substance;
 * manager only sees lead/supervisor substance (not row-mini ACK/test/msg).
 */
export function resolveFanoutDelivery(input: FanoutRoutingInput): FanoutDelivery {
  const targetId = normalizeRoomAgentId(input.targetId);
  const from = normalizeRoomAgentId(input.from);
  if (targetId === from) return "skip";

  const { kind, body, profile } = input;
  const substance = isSubstanceRoomMessage(kind, body);
  const noise = isAckOrNoise(body, kind);
  const leads = profileLeads(profile);
  const leadWorkers = (profile.leadWorkers ?? []).map(normalizeRoomAgentId);
  const fromIsLead = leads.includes(from) || leadWorkers.includes(from);
  const supervisor = profile.supervisor ? normalizeRoomAgentId(profile.supervisor) : "secretary";

  const grid = input.miniGrid ?? "4x2";
  const max = input.miniMax ?? 8;
  const gridLeads = normalizeMinisLeads(input.miniLeads ?? [1, 2]);
  const rowLead =
    from.startsWith("mini-") && !fromIsLead
      ? rowLeadForMiniId(from, grid, max, gridLeads)
      : null;

  if (targetId === "manager") {
    if (kind === "broadcast") return "rich";
    if (noise) return "skip";
    if (!substance) return "skip";
    if (from.startsWith("mini-") && !fromIsLead) return "skip";
    if (fromIsLead || from === supervisor || from === "manager" || from === "secretary") {
      return "rich";
    }
    return "skip";
  }

  if (targetId === supervisor || targetId === "secretary") {
    if (noise) return "skip";
    if (substance) return "rich";
    return "skip";
  }

  if (rowLead && targetId === rowLead && from.startsWith("mini-") && from !== rowLead) {
    return noise ? "thin" : "rich";
  }

  if (leadWorkers.includes(targetId) && substance) return "rich";

  if (leads.includes(targetId) && from.startsWith("mini-")) {
    const fromRowLead = rowLeadForMiniId(from, grid, max, gridLeads);
    if (fromRowLead && fromRowLead !== targetId) return "skip";
  }

  if (profile.members?.map(normalizeRoomAgentId).includes(targetId)) {
    if (noise && targetId.startsWith("mini-")) return "skip";
    return "thin";
  }

  return "skip";
}
