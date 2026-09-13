import type { NotifyActLink } from "@seat-mesh/core";

const UI_CSS = `
body{font-family:system-ui,sans-serif;margin:2rem;max-width:36rem;line-height:1.45}
h1{font-size:1.25rem}
.btn{display:inline-block;margin:.35rem .5rem .35rem 0;padding:.55rem 1.1rem;
  border-radius:6px;text-decoration:none;font-weight:600;font-size:.95rem}
.btn-yes{background:#2e7d32;color:#fff}
.btn-no{background:#5f6368;color:#fff}
.btn-link{background:#1565c0;color:#fff}
.btn-muted{background:#eceff1;color:#202124}
.row{margin:1.25rem 0}
small{color:#5f6368}
`;

export function htmlUiShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${UI_CSS}</style></head><body>${bodyHtml}</body></html>`;
}

export function htmlButtonLinks(links: NotifyActLink[], variant: "yesno" | "plain" = "plain"): string {
  if (!links.length) return "<p><em>No links registered.</em></p>";
  return links
    .map((l, i) => {
      const label = escapeHtml(l.label);
      const href = escapeHtmlAttr(l.url);
      let cls = "btn btn-link";
      if (variant === "yesno" && links.length >= 2) {
        if (i === 0) cls = "btn btn-yes";
        else if (i === 1) cls = "btn btn-no";
      }
      return `<a class="${cls}" href="${href}">${label}</a>`;
    })
    .join("\n");
}

/** Browser page: same one-shot Yes/No URLs as embedded in desktop toasts. */
export function htmlDemoYesNoPage(links: NotifyActLink[], port: number): string {
  const buttons = htmlButtonLinks(links, "yesno");
  return htmlUiShell(
    "seatmesh · Yes / No",
    `<h1>Yes / No (notify-act)</h1>
<p>Same links as in a desktop notification. One click executes the action and burns the token.</p>
<div class="row">${buttons}</div>
<p><small>POST /act/register · :${port} · <a href="/ui">/ui</a> · <a href="/health">/health</a></small></p>`,
  );
}

export function htmlUiHome(port: number): string {
  return htmlUiShell(
    "seatmesh ui",
    `<h1>seatmesh browser</h1>
<p>Local inbox control plane on <code>127.0.0.1:${port}</code>.</p>
<div class="row">
  <a class="btn btn-link" href="/ui/demo-yesno">Yes / No (demo links)</a>
  <a class="btn btn-muted" href="/health">Health (JSON)</a>
</div>
<p><small>CLI: <code>notify yesno</code> · toast body uses HTML Yes/No anchors only.</small></p>`,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
