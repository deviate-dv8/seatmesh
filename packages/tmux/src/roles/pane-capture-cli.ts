import { spawnSync } from "node:child_process";
import type { LoadedProfile } from "@seat-mesh/core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";

function tmux(args: string[]): string | null {
  const r = spawnSync("tmux", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trimEnd();
}

/**
 * P4-2 (5.12): read-only `capture <target>` — dumps a pane's current scrollback.
 * Read-only by design: ARCHITECTURE.md's "No direct send" reserves pane *writes*
 * for the daemon; a capture verb never writes to a pane, so it doesn't touch that
 * rule. `inject`/`interrupt`/`restart` (the other three base-layer verbs) are
 * bypass primitives and are deliberately NOT added here.
 */
export function runPaneCapture(loaded: LoadedProfile, argv: string[]): void {
  const ansi = argv.includes("--ansi");
  const json = argv.includes("--json");
  const args = argv.filter((a) => a !== "--ansi" && a !== "--json");

  const linesIdx = args.findIndex((a) => a === "--lines");
  let lines: number | undefined;
  if (linesIdx !== -1) {
    lines = Number.parseInt(args[linesIdx + 1] ?? "", 10);
    if (!Number.isFinite(lines) || lines <= 0) {
      throw new Error("capture: --lines expects a positive integer");
    }
    args.splice(linesIdx, 2);
  }

  const target = args[0] ?? "here";
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const text =
    lines === undefined
      ? (capturePaneSnapshot(resolved.paneId)?.[ansi ? "captureTailAnsi" : "captureTail"] ??
        tmux([...(ansi ? ["capture-pane", "-e"] : ["capture-pane"]), "-t", resolved.paneId, "-p", "-S", "-80"]) ??
        "")
      : (tmux([
          ...(ansi ? ["capture-pane", "-e"] : ["capture-pane"]),
          "-t",
          resolved.paneId,
          "-p",
          "-S",
          `-${lines}`,
        ]) ?? "");

  if (json) {
    console.log(JSON.stringify({ paneId: resolved.paneId, lines: text.split("\n") }, null, 2));
    return;
  }
  console.log(text);
}
