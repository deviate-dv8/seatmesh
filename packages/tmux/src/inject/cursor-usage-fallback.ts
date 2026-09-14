import { tmux } from "../lib/tmux-run.js";

/** Best-effort: switch cursor-agent composer to Auto after usage-limit block. */
export function cursorUsageAutoFallback(paneId: string): boolean {
  const steps: string[][] = [
    ["send-keys", "-t", paneId, "Escape"],
    ["send-keys", "-t", paneId, "C-u"],
    ["send-keys", "-t", paneId, "-l", "/model Auto"],
    ["send-keys", "-t", paneId, "Enter"],
  ];
  for (const args of steps) {
    const r = tmux(args);
    if (!r.ok) return false;
  }
  return true;
}

export const CURSOR_USAGE_LIMIT_RE =
  /out of usage|Increase limits for faster responses|ask your admin to increase your limit/i;
