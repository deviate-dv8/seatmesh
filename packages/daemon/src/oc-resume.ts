import { spawnSync } from "node:child_process";
import path from "node:path";
import type { ProviderRegistry } from "seat-mesh-core";
import { formatOpenCodeResumeCommand } from "seat-mesh-providers";
import { capturePaneSnapshot, injectToPane, withPaneInputEnabled } from "seat-mesh-tmux";

/** Desktop toasts from mesh inbox daemon — not manager seat. */
export const INBOX_NOTIFY_SLOT = "inbox";

/** Shown on resume-sent / ack toasts so operator knows ack is inbox-automatic, not a manual command. */
export const RESUME_ACK_HOWTO =
  "Ack: automatic — when the OC composer is back (limit screen gone), inbox clears the OC-LIMIT border on that pane. " +
  "Complete toast = all borders cleared. Incomplete after 5m = eyeball stuck panes. Nothing for you to run.";

export type InboxNotifyPhase = "starting" | "sent" | "complete" | "incomplete" | "escalating";

function phaseLabel(phase: InboxNotifyPhase): string {
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

function notifyInbox(
  workspace: string,
  phase: InboxNotifyPhase,
  topic: string,
  sessionAbout: string,
  check: string,
): void {
  const notifySh = path.join(workspace, "scripts/notify.sh");
  const title = `${INBOX_NOTIFY_SLOT} · ${topic} (${phaseLabel(phase)})`;
  let body = sessionAbout;
  if (check) body += `\n\nCheck: ${check}`;
  try {
    spawnSync("bash", [notifySh, title, body], {
      encoding: "utf8",
      timeout: 5000,
    });
  } catch {
    /* notify optional */
  }
}

export function notifyConnectivityStatus(
  workspace: string,
  topic: string,
  sessionAbout: string,
  check: string,
  phase: InboxNotifyPhase = "starting",
): void {
  notifyInbox(workspace, phase, topic, sessionAbout, check);
}

/** @deprecated Use resume wave notify with carrier meta instead. */
export function notifyProxyCarrierIp(
  workspace: string,
  fromIp: string | null,
  toIp: string,
  reason: string,
): void {
  const sessionAbout =
    fromIp && fromIp !== toIp
      ? `Proxy ${reason}: carrier ${fromIp} -> ${toIp}.`
      : `Proxy ${reason}: carrier ${toIp}.`;
  notifyInbox(
    workspace,
    "sent",
    "Proxy rotate",
    sessionAbout,
    "Waiting for OC panes to confirm resume...",
  );
}

export function resumeOneOpenCodePane(
  paneId: string,
  registry: ProviderRegistry,
): { ok: boolean; cmd?: string; reason?: string } {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return { ok: false };
  const prov = registry.detect(snap);
  if (prov?.id !== "opencode") return { ok: false };
  const cmd = formatOpenCodeResumeCommand(snap);
  if (!cmd) return { ok: false, reason: "no-ses-id" };
  const plan = prov.injectPlan(snap);
  let ok = false;
  withPaneInputEnabled(paneId, () => {
    injectToPane(paneId, cmd, plan, prov.id, snap.captureTail);
    ok = true;
  });
  return ok ? { ok: true, cmd } : { ok: false, reason: "inject-failed" };
}

export function resumeAllOpenCodePanes(
  paneIds: string[],
  registry: ProviderRegistry,
  log?: (line: string) => void,
): { sent: number; total: number; sentPaneIds: string[] } {
  let sent = 0;
  let total = 0;
  const sentPaneIds: string[] = [];
  for (const paneId of paneIds) {
    const snap = capturePaneSnapshot(paneId);
    if (!snap) continue;
    if (registry.detect(snap)?.id !== "opencode") continue;
    total += 1;
    const r = resumeOneOpenCodePane(paneId, registry);
    if (r.ok) {
      sent += 1;
      sentPaneIds.push(paneId);
      log?.(`OC-RESUME ${paneId} ${r.cmd ?? "resume"}`);
    }
  }
  return { sent, total, sentPaneIds };
}

export interface ResumeWaveMeta {
  fromIp?: string | null;
  toIp?: string | null;
}

export function notifyResumeWave(
  workspace: string,
  reason: string,
  sent: number,
  total: number,
  meta?: ResumeWaveMeta,
): void {
  const ipLine =
    meta?.toIp && meta.fromIp !== meta.toIp
      ? `Carrier ${meta.fromIp ?? "?"} -> ${meta.toIp}. `
      : meta?.toIp
        ? `Carrier ${meta.toIp}. `
        : "";
  if (sent > 0) {
    notifyInbox(
      workspace,
      "sent",
      "OC resume",
      `${ipLine}Resume pasted to ${sent}/${total} OpenCode panes (${reason}).`,
      RESUME_ACK_HOWTO,
    );
    return;
  }
  if (total > 0) {
    notifyInbox(
      workspace,
      "incomplete",
      "OC resume",
      `${ipLine}Found ${total} OC panes but resume was not delivered (${reason}).`,
      "Check OC panes manually — may be busy or keyboard-locked.",
    );
  }
}
