import type { LoadedProfile } from "@seat-mesh/core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { selectPaneUnfocused } from "../lib/select-pane.js";
import { tmux } from "../lib/tmux-run.js";

export function setPaneTitle(loaded: LoadedProfile, target: string, title: string): void {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);
  selectPaneUnfocused(["-t", resolved.paneId, "-T", title]);
  tmux(["set-option", "-p", "-t", resolved.paneId, "@mesh_title", title]);
}

export function setPaneStatus(loaded: LoadedProfile, target: string, status: string): void {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);
  tmux(["set-option", "-p", "-t", resolved.paneId, "@mesh_status", status]);
}
