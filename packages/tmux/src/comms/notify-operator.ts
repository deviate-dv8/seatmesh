import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import notifier from "node-notifier";
import {
  formatNotifyActLinksForToast,
  inboxBaseFromPort,
  isManagerKind,
  registerNotifyActLinks,
  yesNoNotifyActActions,
  type LoadedProfile,
  type NotifyActRegisterAction,
} from "@seat-mesh/core";
import { runWhoami, type WhoamiResult } from "../agents/whoami.js";
import { meshInboxPort } from "./inbox-bridge.js";

/** Desktop toasts from mesh inbox daemon — not a worker/manager seat. */
export const INBOX_NOTIFY_SLOT = "inbox";

export type InboxNotifyPhase =
  | "starting"
  | "sent"
  | "complete"
  | "incomplete"
  | "escalating";

function inboxPhaseLabel(phase: InboxNotifyPhase): string {
  switch (phase) {
    case "starting":
      return "starting";
    case "sent":
      return "resume sent";
    case "complete":
      return "complete";
    case "incomplete":
      return "incomplete";
    case "escalating":
      return "escalating";
  }
}

/** Mute file/env gates (same semantics as workspace notify scripts). */
export function shouldSkipDesktopNotify(workspace: string): boolean {
  if (process.env.ZSIGN_SKIP_DESKTOP_NOTIFY || process.env.CPE_SKIP_DESKTOP_NOTIFY) {
    return true;
  }
  const skipFile = path.join(workspace, ".sm/runtime/skip-desktop-notify");
  try {
    return fs.existsSync(skipFile);
  } catch {
    return false;
  }
}

/**
 * Native desktop toast via node-notifier only (terminal-notifier / SnoreToast / notify-send).
 * No workspace shell scripts.
 */
export function sendDesktopToastSync(workspace: string, title: string, body: string): boolean {
  if (shouldSkipDesktopNotify(workspace)) return false;
  if (!desktopNotifyAvailable()) return false;
  try {
    const isNotifySend =
      process.platform === "linux" || !!process.platform.match(/BSD$/);
    notifier.notify({
      title,
      message: body,
      sound: false,
      ...(isNotifySend ? { urgency: "critical" as const } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

export function buildOperatorNotifyTitle(seatDisplay: string, session: string): string {
  const seat = seatDisplay.trim();
  const about = session.trim();
  if (seat && about) return `${seat} · ${about}`;
  if (seat) return seat;
  if (about) return about;
  return "seatmesh";
}

export function buildOperatorNotifyBody(session: string, check: string, url?: string): string {
  let body = session.trim();
  const chk = check.trim();
  if (chk) {
    body += body ? `\n\nCheck: ${chk}` : `Check: ${chk}`;
  }
  const link = url?.trim();
  if (link) {
    body += body ? `\n\n${link}` : link;
  }
  if (!body) body = "(no details)";
  return body;
}

export interface InboxDesktopNotifyInput {
  topic: string;
  phase: InboxNotifyPhase;
  sessionAbout: string;
  check: string;
}

/** Inbox/CPE/proxy toasts — same title shape as legacy shell helper, library delivery only. */
export function runInboxDesktopNotifySync(workspace: string, input: InboxDesktopNotifyInput): boolean {
  const title = `${INBOX_NOTIFY_SLOT} · ${input.topic} (${inboxPhaseLabel(input.phase)})`;
  let body = input.sessionAbout;
  if (input.check) {
    body += body ? `\n\nCheck: ${input.check}` : `Check: ${input.check}`;
  }
  return sendDesktopToastSync(workspace, title, body);
}

/** Register one-shot /act/v1 links on the inbox daemon, then show them in the toast body. */
export async function sendDesktopToastWithActLinks(
  loaded: LoadedProfile,
  title: string,
  body: string,
  actions: NotifyActRegisterAction[],
  ttlSec = 3600,
): Promise<boolean> {
  const base = inboxBaseFromPort(meshInboxPort(loaded));
  const links = await registerNotifyActLinks(base, actions, ttlSec);
  const linkBlock = formatNotifyActLinksForToast(links);
  let fullBody = body;
  if (linkBlock) {
    fullBody += fullBody ? `\n\n${linkBlock}` : linkBlock;
  }
  return sendDesktopToastSync(loaded.workspace, title, fullBody);
}

/** Yes / No as notification links → inbox /act/v1 (browser side effect on click). */
export async function sendYesNoToast(
  loaded: LoadedProfile,
  title: string,
  body: string,
  yesMsg: string,
  yesTarget = "secretary",
): Promise<boolean> {
  return sendDesktopToastWithActLinks(
    loaded,
    title,
    body,
    yesNoNotifyActActions({ yesMsg, yesTarget }),
  );
}

function tmuxMini(paneId: string | null): string {
  if (!paneId) return "";
  const r = spawnSync("tmux", ["display-message", "-t", paneId, "-p", "#{@mesh_mini}"], {
    encoding: "utf8",
  });
  if (r.status !== 0) return "";
  return (r.stdout ?? "").trim();
}

/** Seat key from live pane identity (for title prefix). */
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

  const title = buildOperatorNotifyTitle(seatDisplay, session);
  const body = buildOperatorNotifyBody(session, check, input.url);
  const sent = sendDesktopToastSync(loaded.workspace, title, body);
  if (!sent) {
    return {
      ok: false,
      seatDisplay,
      error: "native toast not delivered (muted or no notifier)",
      exitCode: 1,
    };
  }

  return { ok: true, seatDisplay, exitCode: 0 };
}
