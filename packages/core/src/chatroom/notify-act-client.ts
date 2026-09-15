import type {
  NotifyActCard,
  NotifyActLink,
  NotifyActRegisterAction,
  NotifyActRegisterCardInput,
} from "./notify-act.js";

export function inboxBaseFromPort(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export interface RegisterNotifyActResult {
  links: NotifyActLink[];
  card?: NotifyActCard;
  infoUrl?: string;
}

/** Trim + strip trailing junk so toast/copy links stay clickable. */
export function cleanUrl(url?: string | null): string | undefined {
  if (url == null) return undefined;
  const u = String(url).trim().replace(/[>\]).,;]+$/g, "");
  return u || undefined;
}

export async function registerNotifyActLinks(
  inboxBase: string,
  actions: NotifyActRegisterAction[],
  ttlSec = 3600,
  card?: NotifyActRegisterCardInput,
): Promise<RegisterNotifyActResult> {
  if (!actions.length && !card) return { links: [] };
  const base = inboxBase.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/act/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actions,
        ttlSec,
        ...(card
          ? {
              card: {
                title: card.title,
                body: card.body,
                ...(card.openUrl ? { openUrl: card.openUrl } : {}),
              },
            }
          : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { links: [] };
    const json = (await res.json()) as {
      ok?: boolean;
      links?: NotifyActLink[];
      card?: NotifyActCard;
      infoUrl?: string;
    };
    const infoUrl = cleanUrl(json.infoUrl ?? json.card?.infoUrl);
    return {
      links: (json.links ?? []).map((l) => ({
        ...l,
        url: cleanUrl(l.url) || l.url,
      })),
      card: json.card
        ? { ...json.card, infoUrl: cleanUrl(json.card.infoUrl) || json.card.infoUrl }
        : undefined,
      infoUrl,
    };
  } catch {
    return { links: [] };
  }
}

export function formatNotifyActLinksHtml(links: NotifyActLink[]): string {
  if (!links.length) return "";
  return links
    .map((l) => `<a href="${escapeHtmlAttr(l.url)}">${escapeHtmlText(l.label)}</a>`)
    .join(" · ");
}

/**
 * Toast body: short blurb only. Info / Yes / No are native action buttons —
 * never dump URLs or HTML anchors into the toast text.
 */
export function formatYesNoToastBody(
  body: string,
  _infoUrl?: string,
  _yesUrl?: string,
  _noUrl?: string,
): string {
  return body.trim() || "Choose Yes or No.";
}

/**
 * Plain URL lines when needed — always cleanUrl.
 */
export function formatNotifyActLinksForToast(
  links: NotifyActLink[],
  infoUrl?: string,
): string {
  const lines: string[] = [];
  const info = cleanUrl(infoUrl);
  if (info) lines.push(`Info: ${info}`);
  for (const l of links) {
    const u = cleanUrl(l.url);
    if (u) lines.push(`${l.label}: ${u}`);
  }
  return lines.join("\n");
}

/** Build peer inject text for an operator Yes/No click. */
export function formatOperatorDecideMsg(
  answer: "YES" | "NO",
  title: string,
  custom?: string,
): string {
  const t = title.trim() || "decision";
  const customTrim = custom?.trim();
  if (customTrim && !/^Dan notify reply:/i.test(customTrim) && !/^\[operator-decide\]/i.test(customTrim)) {
    return `PRIORITY [operator-decide] ${answer} — ${t}\n${customTrim}`;
  }
  if (customTrim && /^\[operator-decide\]/i.test(customTrim)) {
    return /\bPRIORITY\b/i.test(customTrim) ? customTrim : `PRIORITY ${customTrim}`;
  }
  return `PRIORITY [operator-decide] ${answer} — ${t}`;
}

/** Standard Yes / No peer actions — both target the same seat (the requester). */
export function yesNoNotifyActActions(input: {
  title: string;
  yesTarget?: string;
  yesMsg?: string;
  noMsg?: string;
  noLabel?: string;
  yesLabel?: string;
}): NotifyActRegisterAction[] {
  const target = (input.yesTarget ?? "manager").trim() || "manager";
  const title = input.title.trim() || "decision";
  return [
    {
      label: input.yesLabel ?? "Yes",
      type: "peer",
      params: {
        target,
        msg: formatOperatorDecideMsg("YES", title, input.yesMsg),
        kind: "prompt",
      },
    },
    {
      label: input.noLabel ?? "No",
      type: "peer",
      params: {
        target,
        msg: formatOperatorDecideMsg("NO", title, input.noMsg),
        kind: "prompt",
      },
    },
  ];
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtmlText(s).replace(/"/g, "&quot;");
}
