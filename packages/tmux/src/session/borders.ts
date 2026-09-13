import { tmux } from "../lib/tmux-run.js";

/** Kept for callers; tmux 3.6 drops a format newline so we never split rows. */
export const BANNER_SINGLE_MIN_WIDTH = 72;

/**
 * Always one row. A format newline is dropped by tmux and smashes
 * `inbox 5 cb 0` + `follow-up` into `inbox 5 cb 0follow-up` with no `|`.
 */
export const MESH_PANE_BORDER_FORMAT_ONE =
  "#[align=centre]#{@mesh_name}  |  #{@mesh_tasks}  |  #{@mesh_inbox}  |  #{@mesh_status} ";

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
