import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import notifier from "node-notifier";
import {
  appendImagesToMarkdown,
  formatYesNoToastBody,
  inboxBaseFromPort,
  isManagerKind,
  readMarkdownFile,
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
 * Native desktop toast via node-notifier / notify-send.
 * When openUrl is set: macOS/Windows click-opens; Linux gets an Open action button.
 */
export function sendDesktopToastSync(
  workspace: string,
  title: string,
  body: string,
  opts: { openUrl?: string } = {},
): boolean {
  if (shouldSkipDesktopNotify(workspace)) return false;
  if (!desktopNotifyAvailable()) return false;
  const openUrl = opts.openUrl?.trim();
  const isNotifySend =
    process.platform === "linux" || !!process.platform.match(/BSD$/);

  if (isNotifySend && openUrl) {
    return spawnLinuxOpenUrlToast({ title, body, openUrl });
  }

  try {
    notifier.notify({
      title,
      message: body,
      sound: false,
      ...(openUrl ? { open: openUrl } : {}),
      ...(isNotifySend ? { urgency: "critical" as const, timeout: false } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Linux: Open / Info action only when the user clicks — never on dismiss/timeout.
 */
export function spawnLinuxOpenUrlToast(input: {
  title: string;
  body: string;
  openUrl: string;
  actionLabel?: string;
}): boolean {
  if (!notifySendAvailable()) return false;
  const label = (input.actionLabel ?? "Info").replace(/[=\n]/g, "");
  const script = `
action=$(notify-send -a seatmesh -u critical -t 0 \\
  -A info=${label} -- "$SM_TITLE" "$SM_BODY" 2>/dev/null || true)
# Only user-clicked Info — empty action means dismissed / timed out (do NOT open).
if [ "$action" = "info" ]; then
  command -v xdg-open >/dev/null && xdg-open "$SM_URL" >/dev/null 2>&1 || true
fi
`.trim();
  try {
    spawn("bash", ["-c", script], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        SM_TITLE: input.title.slice(0, 120),
        SM_BODY: input.body.slice(0, 800),
        SM_URL: input.openUrl.trim(),
      },
    }).unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Linux: Info / Yes / No — open/curl only on explicit click (never auto).
 */
export function spawnLinuxYesNoActionToast(input: {
  title: string;
  body: string;
  infoUrl: string;
  yesUrl: string;
  noUrl: string;
}): boolean {
  if (!notifySendAvailable()) return false;
  const script = `
action=$(notify-send -a seatmesh -u critical -t 0 \\
  -A info=Info -A yes=Yes -A no=No -- "$SM_TITLE" "$SM_BODY" 2>/dev/null || true)
case "$action" in
  info) command -v xdg-open >/dev/null && xdg-open "$SM_INFO" >/dev/null 2>&1 || true ;;
  yes) curl -fsS -o /dev/null "$SM_YES" 2>/dev/null || wget -q -O /dev/null "$SM_YES" 2>/dev/null || true ;;
  no) curl -fsS -o /dev/null "$SM_NO" 2>/dev/null || wget -q -O /dev/null "$SM_NO" 2>/dev/null || true ;;
esac
`.trim();
  try {
    spawn("bash", ["-c", script], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        SM_TITLE: input.title.slice(0, 120),
        SM_BODY: input.body.slice(0, 800),
        SM_INFO: input.infoUrl.trim(),
        SM_YES: input.yesUrl.trim(),
        SM_NO: input.noUrl.trim(),
      },
    }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Register one-shot /act/v1 links; toast with native Yes/No where possible. */
export async function sendDesktopToastWithActLinks(
  loaded: LoadedProfile,
  title: string,
  body: string,
  actions: NotifyActRegisterAction[],
  ttlSec = 3600,
  card?: { title: string; body: string },
  /** Agent-crafted Info URL (mdview); overrides /act/card for the Info button. */
  craftedInfoUrl?: string,
): Promise<{ ok: boolean; infoUrl?: string; target?: string }> {
  const base = inboxBaseFromPort(meshInboxPort(loaded));
  const registered = await registerNotifyActLinks(base, actions, ttlSec, card);
  // Prefer agent-crafted override; else local /act/card Info URL.
  const infoUrl = (
    craftedInfoUrl?.trim() ||
    registered.infoUrl?.trim() ||
    ""
  ).trim() || undefined;
  if (!registered.links.length && !infoUrl) {
    return { ok: false };
  }
  const yes = registered.links.find((l) => /^yes$/i.test(l.label));
  const no = registered.links.find((l) => /^no$/i.test(l.label));
  const toastBody = formatYesNoToastBody(body, infoUrl, yes?.url, no?.url);

  let toasted = false;
  if (
    process.platform === "linux" &&
    infoUrl &&
    yes?.url &&
    no?.url &&
    !shouldSkipDesktopNotify(loaded.workspace)
  ) {
    toasted = spawnLinuxYesNoActionToast({
      title,
      body: toastBody,
      infoUrl,
      yesUrl: yes.url.trim(),
      noUrl: no.url.trim(),
    });
  } else if (
    process.platform === "linux" &&
    infoUrl &&
    !shouldSkipDesktopNotify(loaded.workspace)
  ) {
    toasted = spawnLinuxOpenUrlToast({
      title,
      body: toastBody.includes("Tap Open") ? toastBody : `${toastBody}\n\nTap Open`,
      openUrl: infoUrl,
    });
  }
  if (!toasted) {
    toasted = sendDesktopToastSync(loaded.workspace, title, toastBody, {
      openUrl: infoUrl,
    });
  }
  // Never auto-open — operator clicks Info when ready.
  return {
    ok: toasted || Boolean(infoUrl),
    infoUrl,
    target: String(actions[0]?.params?.target ?? ""),
  };
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
  // URL stays on Open/Info action — do not paste into body.
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

/** Open Info / decide URL in the default browser (best-effort). */
export function openDesktopUrl(url: string): void {
  const u = url.trim();
  if (!u) return;
  try {
    if (process.platform === "darwin") {
      spawn("open", [u], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", u], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [u], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Default Yes/No reply seat = the agent who asked (whoami), else manager (operator hub).
 * Maps to resolvePaneTarget ids: manager | secretary | slot-N | mini-N.
 */
export function defaultYesNoReplyTarget(loaded: LoadedProfile): string {
  try {
    const who = runWhoami(loaded);
    if (!who) return "manager";
    const mini = tmuxMini(process.env.TMUX_PANE ?? null);
    const arg = notifySlotArg(who, mini || null);
    return notifySeatDisplay(arg);
  } catch {
    return "manager";
  }
}

export interface SendYesNoToastResult {
  ok: boolean;
  target: string;
  infoUrl?: string;
}

export interface CraftInfoLinkInput {
  title: string;
  body?: string;
  mdFile?: string;
  images?: string[];
  expiresInDays?: number;
}

/**
 * Agent crafts an Info link on the local seatmesh UI (`/act/card/…`).
 * Markdown (+ optional images) renders in-browser with Yes/No when provided.
 */
export async function craftInfoLink(
  loaded: LoadedProfile,
  input: CraftInfoLinkInput & {
    actions?: import("@seat-mesh/core").NotifyActRegisterAction[];
  },
): Promise<
  | { ok: true; viewerUrl: string; markdownUrl?: string; shortId: string }
  | { ok: false; error: string }
> {
  const title = input.title.trim() || "Info";
  let markdown = "";
  try {
    if (input.mdFile?.trim()) {
      markdown = readMarkdownFile(loaded.workspace, input.mdFile.trim());
    } else if (input.body?.trim()) {
      markdown = input.body;
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!markdown.trim()) {
    return { ok: false, error: "need --md <file> or --body markdown to craft Info" };
  }
  const { content } = appendImagesToMarkdown(markdown, input.images ?? [], {
    workspace: loaded.workspace,
  });
  const base = inboxBaseFromPort(meshInboxPort(loaded));
  const registered = await registerNotifyActLinks(
    base,
    input.actions ?? [],
    Math.min(86_400, Math.max(60, (input.expiresInDays ?? 7) * 86_400)),
    { title, body: content },
  );
  const infoUrl = registered.infoUrl?.trim();
  if (!infoUrl) {
    return { ok: false, error: "inbox did not return Info card URL (is inbox up?)" };
  }
  return {
    ok: true,
    viewerUrl: infoUrl,
    shortId: registered.card?.id ?? "",
  };
}

/** Yes / No + Info (local UI card with optional crafted markdown) → peer reply seat. */
export async function sendYesNoToast(
  loaded: LoadedProfile,
  title: string,
  body: string,
  opts: {
    yesMsg?: string;
    noMsg?: string;
    target?: string;
    /** Pre-built Info URL (local /act/card or https). */
    infoUrl?: string;
    /** Craft Info markdown on the local UI card. */
    infoMdFile?: string;
    infoBody?: string;
    infoImages?: string[];
    infoDays?: number;
  } = {},
): Promise<SendYesNoToastResult> {
  const target = (opts.target?.trim() || defaultYesNoReplyTarget(loaded)).trim() || "manager";
  const actions = yesNoNotifyActActions({
    title,
    yesTarget: target,
    yesMsg: opts.yesMsg,
    noMsg: opts.noMsg,
  });

  let cardBody = body.trim();
  let craftedInfoUrl = opts.infoUrl?.trim() || undefined;

  if (!craftedInfoUrl && (opts.infoMdFile || opts.infoBody)) {
    let markdown = "";
    try {
      if (opts.infoMdFile?.trim()) {
        markdown = readMarkdownFile(loaded.workspace, opts.infoMdFile.trim());
      } else if (opts.infoBody?.trim()) {
        markdown = opts.infoBody;
      }
    } catch (e) {
      return { ok: false, target, infoUrl: undefined };
    }
    const { content } = appendImagesToMarkdown(markdown, opts.infoImages ?? [], {
      workspace: loaded.workspace,
    });
    cardBody = content;
  }

  const ttlSec = Math.min(86_400, Math.max(60, (opts.infoDays ?? 7) * 86_400));
  // One register: Yes/No acts + Info card (markdown body) on local UI.
  const result = await sendDesktopToastWithActLinks(
    loaded,
    title,
    body,
    actions,
    ttlSec,
    { title, body: cardBody },
    craftedInfoUrl,
  );
  return {
    ok: result.ok,
    target,
    infoUrl: result.infoUrl,
  };
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

  let who: WhoamiResult | null = null;
  try {
    who = runWhoami(loaded, "here");
  } catch {
    who = null;
  }

  const mini = who ? tmuxMini(who.paneId) : "";
  const slotArg = who ? notifySlotArg(who, mini || null) : "operator";
  const seatDisplay = notifySeatDisplay(slotArg);

  const title = buildOperatorNotifyTitle(seatDisplay, session);
  const body = buildOperatorNotifyBody(session, check, input.url);
  const sent = sendDesktopToastSync(loaded.workspace, title, body, {
    openUrl: input.url?.trim(),
  });
  if (!sent) {
    return {
      ok: false,
      seatDisplay,
      error: "native toast not delivered (muted or no notifier)",
      exitCode: 1,
    };
  }
  // Never auto-open URL — operator taps Info/Open on the toast.
  return { ok: true, seatDisplay, exitCode: 0 };
}

export interface NotifyDetailsInput {
  title: string;
  /** Inline markdown body (optional if mdFile set). */
  body?: string;
  /** Path to .md file (workspace-relative or absolute). */
  mdFile?: string;
  /** Local image paths to embed in the mdview doc. */
  images?: string[];
  /** What the operator should verify (toast Check: line). */
  check?: string;
  expiresInDays?: number;
  /** Skip desktop toast (still publish + print URL). */
  quiet?: boolean;
}

export interface NotifyDetailsResult {
  ok: boolean;
  viewerUrl?: string;
  markdownUrl?: string;
  shortId?: string;
  embedded?: string[];
  skipped?: { path: string; reason: string }[];
  error?: string;
  exitCode: number;
}

/**
 * Craft Info on local seatmesh UI (`/act/card/…`) — markdown + images, toast Open.
 * Actionables (Yes/No) belong on the same card via `notify yesno --md`.
 */
export async function runNotifyDetails(
  loaded: LoadedProfile,
  input: NotifyDetailsInput,
): Promise<NotifyDetailsResult> {
  const title = input.title.trim();
  if (!title) {
    return { ok: false, error: "need title", exitCode: 2 };
  }

  let markdown = "";
  try {
    if (input.mdFile?.trim()) {
      markdown = readMarkdownFile(loaded.workspace, input.mdFile.trim());
    } else if (input.body?.trim()) {
      markdown = input.body;
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message, exitCode: 1 };
  }
  if (!markdown.trim()) {
    return { ok: false, error: "need --md <file> or --body markdown", exitCode: 2 };
  }

  const { content, embedded, skipped } = appendImagesToMarkdown(markdown, input.images ?? [], {
    workspace: loaded.workspace,
  });

  const crafted = await craftInfoLink(loaded, {
    title,
    body: content,
    expiresInDays: input.expiresInDays ?? 7,
  });
  if (!crafted.ok) {
    return { ok: false, error: crafted.error, exitCode: 1, embedded, skipped };
  }

  if (!input.quiet) {
    const check = input.check?.trim() || "Tap Info on the toast";
    const notify = await runMeshNotify(loaded, {
      session: title,
      check,
      url: crafted.viewerUrl,
    });
    if (!notify.ok) {
      return {
        ok: true,
        viewerUrl: crafted.viewerUrl,
        shortId: crafted.shortId,
        embedded,
        skipped,
        error: `Info card ready but notify failed: ${notify.error}`,
        exitCode: 0,
      };
    }
  }
  // quiet: still no auto-open — print URL only

  return {
    ok: true,
    viewerUrl: crafted.viewerUrl,
    shortId: crafted.shortId,
    embedded,
    skipped,
    exitCode: 0,
  };
}
