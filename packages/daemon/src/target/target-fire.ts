import { randomUUID } from "node:crypto";
import { resolveTargetTriageTo, type LoadedProfile } from "@seat-mesh/core";
import { resolvePaneTarget, sendDesktopToastSync } from "@seat-mesh/tmux";
import type { TargetRow } from "../store/target-jsonl.js";
import type { PeerRow } from "../store/jsonl-store.js";

const TARGET_FIRE_BUDGET = 4;

export interface TargetFireStore {
  readTargets(): TargetRow[];
  upsertTarget(row: TargetRow): TargetRow;
  findTarget(id: string): TargetRow | null;
  appendPeer(row: PeerRow): void;
}

export interface TargetFireCtx {
  store: TargetFireStore;
  loaded: LoadedProfile;
  log: (line: string) => void;
  nowMs?: number;
}

function triageSeats(ctx: TargetFireCtx, row: TargetRow): string[] {
  const raw = row.triageTo?.length ? row.triageTo : resolveTargetTriageTo(ctx.loaded);
  return [...new Set(raw.map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

function enqueueTriagePeers(ctx: TargetFireCtx, row: TargetRow): string[] {
  const sent: string[] = [];
  const short = row.id.slice(0, 8);
  const kind = row.kind === "slice" ? "slice" : row.kind === "scope" ? "scope" : "target";
  const breakdown =
    kind === "scope"
      ? `\nSCOPE: break into workable slices — seatmesh target add "<ticket>" --under ${short} --deadline 6h\nThen assign workers; balance load. Mark scope done when children clear.`
      : kind === "slice"
        ? `\nSLICE under ${row.parentId?.slice(0, 8) ?? "?"}: assign a worker/mini; seatmesh target done ${short} when finished.`
        : `\nTriage: balance load across workers/minis.`;
  const msg =
    `[target ${short}] ${kind.toUpperCase()} DUE: ${row.goal}\n` +
    `deadline=${row.deadlineAt}` +
    breakdown +
    `\nOperator: seatmesh target done ${short} · UI: http://127.0.0.1:<daemon>/ui/`;
  const now = new Date().toISOString();
  for (const seat of triageSeats(ctx, row)) {
    const hit = resolvePaneTarget(seat, ctx.loaded);
    if ("error" in hit) {
      ctx.log(`target triage skip ${seat}: ${hit.error}`);
      continue;
    }
    const peer: PeerRow = {
      id: randomUUID(),
      at: now,
      kind: "to-slot",
      fromSlot: "operator",
      fromPorts: null,
      roomSlug: null,
      fromAgent: "target",
      targetPane: hit.paneId,
      targetLabel: seat,
      msg,
      sent: false,
    };
    ctx.store.appendPeer(peer);
    sent.push(seat);
  }
  return sent;
}

export function fireOneTarget(
  ctx: TargetFireCtx,
  row: TargetRow,
  opts?: { forceToast?: boolean; forceTriage?: boolean },
): void {
  const nowIso = new Date(ctx.nowMs ?? Date.now()).toISOString();
  const short = row.id.slice(0, 8);
  const title = `Target due · ${short}`;
  const body =
    `${row.goal}\n` +
    `deadline ${row.deadlineAt}\n` +
    `done: seatmesh target done ${short}   cancel: seatmesh target cancel ${short}`;

  if (opts?.forceToast || !row.remindedAt) {
    const ok = sendDesktopToastSync(ctx.loaded.workspace, title, body);
    ctx.log(`target toast id=${short} ok=${ok}`);
    row.remindedAt = nowIso;
  }

  if (opts?.forceTriage || !row.triageAt) {
    const seats = enqueueTriagePeers(ctx, row);
    if (seats.length) {
      row.triageAt = nowIso;
      ctx.log(`target triage id=${short} -> ${seats.join(",")}`);
    }
  }

  row.updatedAt = nowIso;
  ctx.store.upsertTarget(row);
}

/** One-shot: toast operator + peer manager/secretary when deadline passes. No renew. */
export function fireDueTargets(ctx: TargetFireCtx): void {
  const now = ctx.nowMs ?? Date.now();
  const rows = ctx.store.readTargets().filter((r) => r.status === "active");
  let n = 0;
  for (const row of rows) {
    if (n >= TARGET_FIRE_BUDGET) break;
    const due = Date.parse(row.deadlineAt);
    if (Number.isNaN(due) || due > now) continue;
    if (row.remindedAt && row.triageAt) continue;
    fireOneTarget(ctx, row);
    n++;
  }
}
