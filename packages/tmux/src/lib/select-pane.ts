import { tmux } from "./tmux-run.js";

/** Parse `list-panes -F '#{pane_id}\\t#{pane_active}'` output. */
export function pickActivePaneId(listPanesOut: string): string | null {
  for (const line of (listPanesOut || "").split("\n")) {
    const [id, active] = line.trim().split("\t");
    if (id?.startsWith("%") && active === "1") return id;
  }
  return null;
}

/** Active pane in the same window as `paneId`, or null if tmux cannot say. */
export function activePaneIdForWindowOf(paneId: string): string | null {
  const win = tmux(["display-message", "-t", paneId, "-p", "#{session_name}:#{window_id}"])
    .out;
  if (!win) return null;
  const listed = tmux(["list-panes", "-t", win, "-F", "#{pane_id}\t#{pane_active}"]).out;
  return pickActivePaneId(listed);
}

/** Put focus back if it drifted. No-op when prev is missing or already active. */
export function restoreActivePane(prev: string | null): void {
  if (!prev) return;
  const win = tmux(["display-message", "-t", prev, "-p", "#{session_name}:#{window_id}"])
    .out;
  if (!win) return;
  const now = pickActivePaneId(
    tmux(["list-panes", "-t", win, "-F", "#{pane_id}\t#{pane_active}"]).out,
  );
  if (now === prev) return;
  tmux(["select-pane", "-t", prev]);
}

/**
 * Run fn, then restore the window's previously-active pane.
 * tmux 3.6: every select-pane (including -e/-d/-T) makes the target active.
 */
export function withActivePanePreserved<T>(paneId: string, fn: () => T): T {
  const prev = activePaneIdForWindowOf(paneId);
  try {
    return fn();
  } finally {
    restoreActivePane(prev);
  }
}

/**
 * select-pane for input lock / title only — never leave focus on the target
 * unless that pane was already active.
 */
export function selectPaneUnfocused(args: string[]): void {
  const t = args.indexOf("-t");
  const paneId = t >= 0 ? args[t + 1] : "";
  if (!paneId) {
    tmux(["select-pane", ...args]);
    return;
  }
  withActivePanePreserved(paneId, () => {
    tmux(["select-pane", ...args]);
  });
}

/**
 * Run inject with the target pane able to receive programmatic input.
 *
 * tmux `select-pane -d` (pane_input_off) blocks *all* input — including daemon
 * `send-keys` / `paste-buffer`. There is no "user-only" keyboard lock in tmux:
 * inject must run with input enabled and rely on capture→buffer→clear→paste→restore
 * (see inject.ts) so operator drafts are not sent with inbox mail.
 *
 * If the pane was already locked for minis, briefly unlock, inject, restore lock.
 * Active-pane focus is preserved so inject does not steal the operator's cursor.
 */
export function withPaneInjectLock(paneId: string, fn: () => void): void {
  withActivePanePreserved(paneId, () => {
    const wasInputOff =
      tmux(["display-message", "-t", paneId, "-p", "#{pane_input_off}"]).out === "1";
    if (wasInputOff) {
      selectPaneUnfocused(["-e", "-t", paneId]);
    }
    try {
      fn();
    } finally {
      if (wasInputOff) {
        selectPaneUnfocused(["-d", "-t", paneId]);
      }
    }
  });
}
