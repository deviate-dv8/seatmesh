import { spawnSync } from "node:child_process";
import path from "node:path";
import notifier from "node-notifier";
import { isManagerKind, type LoadedProfile } from "@seat-mesh/core";
import { runWhoami, type WhoamiResult } from "../agents/whoami.js";

function tmuxMini(paneId: string | null): string {
  if (!paneId) return "";
  const r = spawnSync("tmux", ["display-message", "-t", paneId, "-p", "#{@mesh_mini}"], {
    encoding: "utf8",
  });
  if (r.status !== 0) return "";
  return (r.stdout ?? "").trim();
}

/** `--slot` value for workspace notify.sh from live pane identity. */
export function notifySlotArg(w: WhoamiResult, mini?: string | null): string {
  if (isManagerKind(w.role)) return "manager";
  if (w.role === "secretary") return "secretary";
  if (w.role === "manager-mini") {
    const n = mini || w.slotLabel?.replace(/^mini-/, "") || "";
    return n ? `mini-${n}` : "mini";
  }
  if (w.slot != null) return String(w.slot);
  if (w.slotLabel?.startsWith("mini-")) return w.slotLabel;
  if (w.slotLabel?.startsWith("slot-")) return w.slotLabel.replace(/^slot-/, "");
  if (w.slotLabel && /^[1-9]$/.test(w.slotLabel)) return w.slotLabel;
  return w.slotLabel || "manager";
}

/** Human seat label for `ok toast` line (slot-3, manager, mini-2, …). */
export function notifySeatDisplay(slotArg: string): string {
  if (/^[1-9]$/.test(slotArg)) return `slot-${slotArg}`;
  return slotArg;
}

export function notifySendAvailable(): boolean {
  const r = spawnSync("sh", ["-c", "command -v notify-send >/dev/null"], {
    encoding: "utf8",
  });
  return r.status === 0;
}

function commandExists(cmd: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${cmd} >/dev/null`]).status === 0;
}

/** Whether this OS has a toast mechanism this module knows how to drive. */
export function desktopNotifyAvailable(): boolean {
  if (process.platform === "darwin") return commandExists("osascript");
  if (process.platform === "win32") return true; // powershell ships with Windows
  return notifySendAvailable();
}

/** macOS/Windows toast via node-notifier (bundles terminal-notifier / SnoreToast). */
function sendNativeNotification(title: string, message: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    notifier.notify({ title, message }, (err) => {
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true });
    });
  });
}

export interface MeshNotifyInput {
  session: string;
  check: string;
  url?: string;
}

export interface MeshNotifyResult {
  ok: boolean;
  seatDisplay: string;
  error?: string;
  exitCode: number;
}

export async function runMeshNotify(
  loaded: LoadedProfile,
  input: MeshNotifyInput,
): Promise<MeshNotifyResult> {
  const session = input.session.trim();
  const check = input.check.trim();
  if (!session) {
    return { ok: false, seatDisplay: "-", error: "need session text", exitCode: 2 };
  }
  if (!check) {
    return { ok: false, seatDisplay: "-", error: "need check text", exitCode: 2 };
  }

  if (!desktopNotifyAvailable()) {
    const missing =
      process.platform === "darwin"
        ? "osascript missing"
        : process.platform === "win32"
          ? "powershell missing"
          : "no display (notify-send missing)";
    return { ok: false, seatDisplay: "-", error: missing, exitCode: 1 };
  }

  let who: WhoamiResult;
  try {
    who = runWhoami(loaded, "here");
  } catch (e) {
    return {
      ok: false,
      seatDisplay: "-",
      error: (e as Error).message,
      exitCode: 1,
    };
  }

  const mini = tmuxMini(who.paneId);
  const slotArg = notifySlotArg(who, mini || null);
  const seatDisplay = notifySeatDisplay(slotArg);

  if (process.platform === "darwin" || process.platform === "win32") {
    const title = notifySeatDisplay(slotArg);
    const body = input.url ? `${session}\n\nCheck: ${check}\n${input.url}` : `${session}\n\nCheck: ${check}`;
    const sent = await sendNativeNotification(title, body);
    if (!sent.ok) {
      return { ok: false, seatDisplay, error: sent.error ?? "toast failed", exitCode: 1 };
    }
    return { ok: true, seatDisplay, exitCode: 0 };
  }

  const notifySh = path.join(loaded.workspace, "scripts/notify.sh");

  const args = input.url
    ? ["--url", input.url, "--slot", slotArg, session, check]
    : ["--slot", slotArg, session, check];

  const r = spawnSync("bash", [notifySh, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });

  if (r.status !== 0) {
    const detail = (r.stderr ?? r.stdout ?? "").trim();
    return {
      ok: false,
      seatDisplay,
      error: detail ? `notify-send rejected (${detail})` : "notify-send rejected",
      exitCode: 1,
    };
  }

  return { ok: true, seatDisplay, exitCode: 0 };
}
