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

/** FE test page: Yes / No as plain link-buttons (same URLs as notification body). */
export function htmlDemoYesNoPage(links: NotifyActLink[], port: number): string {
  const buttons = htmlButtonLinks(links, "yesno");
  return htmlUiShell(
    "seatmesh · Yes / No demo",
    `<h1>Notify-act demo (localhost)</h1>
<p>These are the same one-shot links you would embed in a desktop notification. Click once — token burns.</p>
<div class="row">${buttons}</div>
<p><small>Register: POST /act/register · Daemon :${port} · <a href="/ui">/ui</a> · <a href="/health">/health</a></small></p>`,
  );
}

export function htmlUiHome(port: number): string {
  return htmlUiShell(
    "seatmesh ui",
    `<h1>seatmesh browser (v0)</h1>
<p>Local mesh control plane on <code>127.0.0.1:${port}</code>.</p>
<div class="row">
  <a class="btn btn-link" href="/ui/demo-yesno">Yes / No button links</a>
  <a class="btn btn-muted" href="/health">Health (JSON)</a>
</div>
<p><small>Notifications: register actions, paste HTML links in toast body (Plasma opens in browser).</small></p>`,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
