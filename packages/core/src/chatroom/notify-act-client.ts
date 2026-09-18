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
  meta?: { cardId?: string; infoUrl?: string; target?: string; session?: string },
): string {
  const t = title.trim() || "decision";
  const customTrim = custom?.trim();
  let head: string;
  if (customTrim && !/^Dan notify reply:/i.test(customTrim) && !/^\[operator-decide\]/i.test(customTrim)) {
    head = `PRIORITY [operator-decide] ${answer} — ${t}\n${customTrim}`;
  } else if (customTrim && /^\[operator-decide\]/i.test(customTrim)) {
    head = /\bPRIORITY\b/i.test(customTrim) ? customTrim : `PRIORITY ${customTrim}`;
  } else {
    head = `PRIORITY [operator-decide] ${answer} — ${t}`;
  }
  if (!meta) return head;
  if (/\bcard=/.test(head)) return head;
  const lines = [head.trimEnd()];
  const cardId = meta.cardId?.trim();
  if (cardId) lines.push(`card=${cardId}`);
  const infoUrl = meta.infoUrl?.trim();
  if (infoUrl) lines.push(`info=${infoUrl}`);
  const target = meta.target?.trim();
  if (target) lines.push(`target=${target}`);
  const session = meta.session?.trim();
  if (session) lines.push(`session=${session}`);
  return lines.join("\n");
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

/** Run / Decline — Run executes shell in workspace after Review card. */
export function runCmdNotifyActActions(input: {
  cmd: string;
  cwd?: string;
}): NotifyActRegisterAction[] {
  const cmd = input.cmd.trim();
  return [
    {
      label: "Run",
      type: "run-cmd",
      params: {
        cmd,
        ...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
      },
    },
    {
      label: "Decline",
      type: "ping",
      params: { note: "operator declined run-cmd" },
    },
  ];
}

/** Markdown body for the Review step — command is always visible. */
export function formatRunCmdCardBody(input: {
  cmd: string;
  blurb?: string;
  cwd?: string;
}): string {
  const parts: string[] = [];
  const blurb = unescapeNotifyMarkdown(input.blurb ?? "").trim();
  if (blurb) parts.push(blurb);
  parts.push("## Command to run");
  if (input.cwd?.trim()) {
    parts.push(`Working directory: \`${input.cwd.trim()}\``);
  }
  parts.push("```bash", input.cmd.trim(), "```");
  parts.push(
    "_Step 2 of 2 — **Run** executes this under the mesh workspace. **Decline** cancels (one-shot)._",
  );
  return parts.join("\n\n");
}

/**
 * Shell `--body "## Why\\n\\n…"` arrives with literal backslash-n (help documents this).
 * Turn common escapes into real whitespace so hub markdown renders.
 */
export function unescapeNotifyMarkdown(s: string): string {
  if (!s.includes("\\")) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const n = s[i + 1]!;
      if (n === "n") {
        out += "\n";
        i++;
        continue;
      }
      if (n === "t") {
        out += "\t";
        i++;
        continue;
      }
      if (n === "r") {
        out += "\r";
        i++;
        continue;
      }
      if (n === "\\") {
        out += "\\";
        i++;
        continue;
      }
    }
    out += s[i]!;
  }
  return out;
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtmlText(s).replace(/"/g, "&quot;");
}
