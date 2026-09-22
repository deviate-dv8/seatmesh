/**
 * `sm sidebar` (TODO 10.2b) — first, minimal version of the "wormux-like
 * session sidebar": an auto-refreshing terminal overview of every registered
 * mesh and, for the live ones, which agent is running in each pane. Not the
 * final interactive form (dropdown/keyboard nav) — that needs a render-target
 * decision (tray app / TUI / page) the design doc (TODO 10.1/10.2,
 * docs/HANDOUT-SIDEBAR-AND-WEB-SPLIT.md) deliberately left to the operator.
 * This is the real, working starting point: same "shell out, no SDK" data
 * sources as everything else (`sm sessions list` / `sm providers scan`'s own
 * underlying functions, called in-process here rather than shelled out to,
 * since this *is* the seatmesh CLI).
 *
 * Works from anywhere — no `.sm/` workspace needed (registered in
 * bin/seatmesh's allow_outside_mesh, same as `web`/`host`/`--skill`).
 */
import { createRegistryForProfile } from "@seat-mesh/providers";
import { loadProfile } from "@seat-mesh/core";
import { listSessionRows, type SessionRow } from "./sessions-cli.js";
import { scanSessionPanes, type PaneScanRow } from "@seat-mesh/tmux";

export interface SidebarSessionView {
  row: SessionRow;
  panes: PaneScanRow[] | null; // null when not tmux-live or scan failed
}

/** One refresh's worth of data — separated from rendering so it's independently testable. */
export function buildSidebarView(): SidebarSessionView[] {
  return listSessionRows().map((row) => {
    if (!row.tmuxLive) return { row, panes: null };
    try {
      const loaded = loadProfile(row.profilePath);
      const reg = createRegistryForProfile(loaded.profile);
      return { row, panes: scanSessionPanes(reg, row.sessionName) };
    } catch {
      return { row, panes: null };
    }
  });
}

function paneLine(p: PaneScanRow): string {
  const kind = p.providerId ?? "empty";
  const status = p.limitKind ? `${p.phase}:${p.limitKind}` : p.phase;
  return `    ${p.role.padEnd(10)} ${kind.padEnd(14)} ${status}`;
}

export function renderSidebar(views: SidebarSessionView[], at = new Date()): string {
  const lines: string[] = [];
  lines.push(`seatmesh sidebar — ${views.length} registered session(s) — ${at.toISOString()}`);
  lines.push("");
  if (!views.length) {
    lines.push("(no registered sessions — sm start in a project to register one)");
    return lines.join("\n");
  }
  for (const v of views) {
    const state = v.row.tmuxLive ? "live" : "stopped";
    lines.push(`${v.row.label}  (${v.row.sessionName})  ${state}`);
    if (v.panes && v.panes.length) {
      for (const p of v.panes) lines.push(paneLine(p));
    } else if (v.row.tmuxLive) {
      lines.push("    (no panes detected)");
    }
    lines.push("");
  }
  return lines.join("\n");
}

export interface SidebarOptions {
  intervalMs: number;
  once: boolean;
}

export async function runSidebar(opts: SidebarOptions): Promise<void> {
  const tick = () => {
    if (!opts.once) process.stdout.write("\x1b[2J\x1b[H"); // clear screen, home cursor
    console.log(renderSidebar(buildSidebarView()));
    if (!opts.once) {
      console.log(`(refreshing every ${Math.round(opts.intervalMs / 1000)}s — Ctrl+C to exit)`);
    }
  };
  tick();
  if (opts.once) return;
  await new Promise<void>((resolve) => {
    const timer = setInterval(tick, opts.intervalMs);
    const stop = () => {
      clearInterval(timer);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
