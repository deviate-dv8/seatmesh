import { tmux } from "../lib/tmux-run.js";

/** Kept for callers; tmux 3.6 drops a format newline so we never split rows. */
export const BANNER_SINGLE_MIN_WIDTH = 72;

/**
 * Always one row. A format newline is dropped by tmux and smashes
 * `inbox 5 cb 0` + `follow-up` into `inbox 5 cb 0follow-up` with no `|`.
 */
/** Pre-fitted line (paint-time width aware). Individual @mesh_* kept for peek/status. */
export const MESH_PANE_BORDER_FORMAT_ONE = "#[align=centre]#{@mesh_banner} ";

/** @deprecated same as ONE — two-row smash is not recoverable on this tmux. */
export const MESH_PANE_BORDER_FORMAT_TWO = MESH_PANE_BORDER_FORMAT_ONE;

/** @deprecated use MESH_PANE_BORDER_FORMAT_ONE via meshBorderFormat() */
export const MESH_PANE_BORDER_FORMAT = MESH_PANE_BORDER_FORMAT_ONE;

export function bannerShouldUseTwoRow(_minPaneWidth: number): boolean {
  return false;
}

export function meshBorderFormat(_twoRow?: boolean): string {
  return MESH_PANE_BORDER_FORMAT_ONE;
}

export function formatBannerTasks(open: number): string {
  return `tasks ${Math.max(0, open)}`;
}

export function formatBannerInbox(n: number, wait?: string, cb = 0): string {
  const count = Math.max(0, n);
  const extra = wait?.trim();
  const mail = `inbox ${count} cb ${Math.max(0, cb)}`;
  return extra ? `${mail} ${extra}` : mail;
}

export function formatBannerCheckbacks(n: number): string {
  return `cb ${Math.max(0, n)}`;
}

export interface BannerLineInput {
  name: string;
  tasks: string;
  inbox: string;
  /** Open unanswered asks; omit when zero. */
  ack?: string;
  status: string;
}

const BANNER_SEP = "  |  ";

export function compactBannerTasks(full: string): string {
  const m = full.match(/^tasks (\d+)$/);
  return m ? `t${m[1]}` : full;
}

export function compactBannerInbox(full: string): string {
  const m = full.match(/^inbox (\d+) cb (\d+)(?: (.+))?$/);
  if (!m) return full;
  const [, n, cb, extra] = m;
  let s = `i${n}·${cb}`;
  const tail = extra?.trim();
  if (tail === "wait") s += "w";
  else if (tail === "settle") s += "s";
  else if (tail === "pending") s += "p";
  return s;
}

export function compactBannerAck(full: string): string {
  const m = full.match(/^ack (\d+)(!?)$/);
  return m ? `a${m[1]}${m[2]}` : full;
}

function truncateBanner(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  if (max === 1) return s.slice(0, 1);
  return `${s.slice(0, max - 1)}…`;
}

function joinBannerSegs(...parts: string[]): string {
  return parts.filter(Boolean).join(BANNER_SEP);
}

/** Fit one border row to pane width — tmux cannot wrap; we truncate/compact at paint time. */
export function fitBannerLine(width: number, input: BannerLineInput): string {
  const w = Math.max(8, Math.floor(width));
  const ack = input.ack?.trim() ?? "";
  const full = joinBannerSegs(input.name, input.tasks, input.inbox, ack, input.status);
  if (full.length <= w) return full;

  const compact: BannerLineInput = {
    ...input,
    tasks: compactBannerTasks(input.tasks),
    inbox: compactBannerInbox(input.inbox),
    ack: ack ? compactBannerAck(ack) : "",
  };
  const cAck = compact.ack?.trim() ?? "";
  const cFull = joinBannerSegs(compact.name, compact.tasks, compact.inbox, cAck, compact.status);
  if (cFull.length <= w) return cFull;

  const dropTasks = joinBannerSegs(compact.name, compact.inbox, cAck, compact.status);
  if (dropTasks.length <= w) return dropTasks;

  const nameStatus = joinBannerSegs(compact.name, cAck, compact.status);
  if (nameStatus.length <= w) return nameStatus;

  const statusBudget = Math.min(compact.status.length, Math.max(6, Math.floor(w * 0.4)));
  const status = truncateBanner(compact.status, statusBudget);
  const nameBudget = w - status.length - (status ? BANNER_SEP.length : 0);
  if (nameBudget >= 3) {
    return joinBannerSegs(truncateBanner(compact.name, nameBudget), status);
  }

  return truncateBanner(compact.status || compact.name, w);
}

export function paneDisplayWidth(paneId: string): number {
  const out = tmux(["display-message", "-t", paneId, "-p", "#{pane_width}"]).out;
  const n = Number.parseInt(out.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : BANNER_SINGLE_MIN_WIDTH;
}

export function bannerNameFromMeta(
  meta: { role?: string; slot?: string; mini?: string } | null,
  fallback = "?",
): string {
  if (!meta?.role) return fallback;
  if (meta.role === "worker" && meta.slot) return `slot-${meta.slot}`;
  if (meta.mini) return `mini-${meta.mini}`;
  return meta.role;
}

export function minPaneWidthInWindow(session: string, window: string): number {
  const out = tmux(["list-panes", "-t", `${session}:${window}`, "-F", "#{pane_width}"]).out;
  const widths = out
    .split("\n")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return widths.length ? Math.min(...widths) : BANNER_SINGLE_MIN_WIDTH;
}

/** Border strip: name | tasks | inbox N cb M | status */
export function applyMeshBorderFormat(session: string, window: string): void {
  const target = `${session}:${window}`;
  tmux(["set-window-option", "-t", target, "pane-border-status", "top"]);
  tmux(["set-window-option", "-t", target, "pane-border-format", meshBorderFormat()]);
}

export function applyMeshSessionBorders(session: string, windows: string[]): void {
  for (const win of windows) {
    applyMeshBorderFormat(session, win);
  }
}
