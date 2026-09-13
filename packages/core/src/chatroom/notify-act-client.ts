import type { NotifyActLink, NotifyActRegisterAction } from "./notify-act.js";

export function inboxBaseFromPort(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function registerNotifyActLinks(
  inboxBase: string,
  actions: NotifyActRegisterAction[],
  ttlSec = 3600,
): Promise<NotifyActLink[]> {
  if (!actions.length) return [];
  const base = inboxBase.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/act/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actions, ttlSec }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { ok?: boolean; links?: NotifyActLink[] };
    return json.links ?? [];
  } catch {
    return [];
  }
}

export function formatNotifyActLinksHtml(links: NotifyActLink[]): string {
  if (!links.length) return "";
  return links
    .map((l) => `<a href="${escapeHtmlAttr(l.url)}">${escapeHtmlText(l.label)}</a>`)
    .join(" · ");
}

/** Standard Yes / No link pair for notifications (not notify-send -A buttons). */
export function yesNoNotifyActActions(input: {
  yesMsg: string;
  yesTarget?: string;
  noLabel?: string;
  yesLabel?: string;
}): NotifyActRegisterAction[] {
  const target = input.yesTarget ?? "manager";
  return [
    {
      label: input.yesLabel ?? "Yes",
      type: "peer",
      params: { target, msg: input.yesMsg, kind: "prompt" },
    },
    {
      label: input.noLabel ?? "No",
      type: "ping",
      params: {},
    },
  ];
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtmlText(s).replace(/"/g, "&quot;");
}
