import type { NotifyActLink } from "@seat-mesh/core";
import type { NotifyActCardRow } from "./notify-act.js";
import { renderSimpleMarkdown } from "./simple-markdown.js";

/** Shared blueish shell — matches packages/daemon/static/ui/targets.css */
export const MESH_UI_CSS = `
:root{
  --bg:#0b1220;--panel:#121a2b;--ink:#e8eef8;--muted:#8b9bb4;--line:#243149;
  --accent:#5b9fd4;--yes:#3d8bfd;--no:#5a6a80;--info:#7eb8e8;
  --ok:#5bb89a;--danger:#c47a6a;--warn:#d4a574;
  --font:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink);font:15px/1.45 var(--font)}
.top{display:flex;align-items:center;gap:1.5rem;padding:.85rem 1.5rem;border-bottom:1px solid var(--line);background:var(--panel)}
.brand{font-weight:650;letter-spacing:.04em;text-transform:lowercase}
nav a{color:var(--muted);text-decoration:none;margin-right:1rem}
nav a.on{color:var(--accent)}
.meta{margin-left:auto;color:var(--muted);font-size:.85rem;font-family:var(--mono)}
main{max-width:40rem;margin:0 auto;padding:1.75rem 1.25rem 4rem}
h1{font-size:1.55rem;font-weight:600;margin:0 0 .5rem}
.lede{color:var(--muted);margin:0 0 1.25rem}
.body,.md{color:var(--muted);margin:0 0 1.25rem}
.md h1,.md h2,.md h3{color:var(--ink);margin:1rem 0 .4rem;font-weight:600}
.md h1{font-size:1.35rem}.md h2{font-size:1.15rem}.md h3{font-size:1.05rem}
.md p{margin:.55rem 0}.md ul{margin:.4rem 0 .8rem 1.2rem;padding:0}
.md li{margin:.25rem 0}.md code{font-family:var(--mono);font-size:.9em;color:var(--ink)}
.md a{color:var(--accent)}.md-img{display:block;max-width:100%;margin:.75rem 0;border:1px solid var(--line)}
.panel{padding:1.25rem;background:var(--panel);border:1px solid var(--line);margin-bottom:1.25rem}
.row{display:flex;flex-wrap:wrap;gap:.65rem;margin:1.1rem 0}
.btn{display:inline-block;padding:.55rem 1.15rem;border-radius:2px;text-decoration:none;font-weight:600;font-size:.95rem;border:1px solid transparent}
.btn-yes{background:var(--yes);color:#061018}
.btn-no{background:var(--no);color:var(--ink)}
.btn-info{background:transparent;color:var(--info);border-color:var(--line)}
.btn-link{background:var(--accent);color:#061018}
.btn-muted{background:transparent;color:var(--muted);border-color:var(--line)}
.ok h1{color:var(--ok)}
.bad h1{color:var(--danger)}
small,.foot{color:var(--muted);font-size:.8rem}
.foot{border-top:1px solid var(--line);padding:1rem 1.5rem;margin-top:2rem}
.foot a{color:var(--accent)}
code{font-family:var(--mono);font-size:.9em}
`;

export function htmlUiShell(title: string, bodyHtml: string, opts?: { navOn?: string }): string {
  const on = opts?.navOn ?? "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${MESH_UI_CSS}</style></head>
<body>
<header class="top">
  <div class="brand">seatmesh</div>
  <nav>
    <a class="${on === "targets" ? "on" : ""}" href="/ui/">Targets</a>
    <a class="${on === "decide" ? "on" : ""}" href="/ui/decide.html">Decide</a>
  </nav>
</header>
${bodyHtml}
</body></html>`;
}

export function htmlButtonLinks(
  links: NotifyActLink[],
  variant: "yesno" | "plain" = "plain",
): string {
  if (!links.length) return "<p class=\"lede\"><em>No action links.</em></p>";
  return links
    .map((l, i) => {
      const label = escapeHtml(l.label);
      const href = escapeHtmlAttr(l.url);
      let cls = "btn btn-link";
      const lower = l.label.toLowerCase();
      if (variant === "yesno") {
        if (lower === "yes" || (i === 0 && links.length >= 2)) cls = "btn btn-yes";
        else if (lower === "no" || (i === 1 && links.length >= 2)) cls = "btn btn-no";
      }
      return `<a class="${cls}" href="${href}">${label}</a>`;
    })
    .join("\n");
}

/** Browser Info card — markdown body + optional Yes/No (and other) actions. */
export function htmlDecideCardPage(card: NotifyActCardRow, port: number): string {
  const buttons = card.links.length
    ? `<p class="lede">Actions (one-shot):</p><div class="row">${htmlButtonLinks(card.links, "yesno")}</div>`
    : "";
  const body = card.body
    ? `<div class="md">${renderSimpleMarkdown(card.body)}</div>`
    : `<p class="lede">No description.</p>`;
  return htmlUiShell(
    `seatmesh · ${card.title}`,
    `<main>
  <section class="panel">
    <h1>${escapeHtml(card.title)}</h1>
    ${body}
    ${buttons}
  </section>
</main>
<div class="foot">seatmesh Info · :${port} · <a href="/ui/">Targets</a> · <a href="/ui/decide.html">Decide</a></div>`,
    { navOn: "decide" },
  );
}

export function htmlDemoYesNoPage(links: NotifyActLink[], port: number): string {
  const buttons = htmlButtonLinks(links, "yesno");
  return htmlUiShell(
    "seatmesh · Yes / No demo",
    `<main>
  <section class="panel">
    <h1>Yes / No (demo)</h1>
    <p class="lede">Same one-shot links as a desktop toast. Info opens a real card from <code>notify yesno</code>.</p>
    <div class="row">${buttons}</div>
  </section>
</main>
<div class="foot">POST /act/register · :${port} · <a href="/ui/">Targets</a></div>`,
    { navOn: "decide" },
  );
}

export function htmlActPage(title: string, body: string, ok: boolean): string {
  const cls = ok ? "ok" : "bad";
  return htmlUiShell(
    title,
    `<main class="${cls}">
  <section class="panel">
    <h1>${escapeHtml(title)}</h1>
    <p class="body">${escapeHtml(body)}</p>
    <div class="row">
      <a class="btn btn-link" href="/ui/">Back to Targets</a>
      <a class="btn btn-muted" href="/ui/decide.html">Decide</a>
    </div>
  </section>
</main>
<div class="foot">seatmesh notify-act · one-shot</div>`,
  );
}

export function htmlUiHome(port: number): string {
  return htmlUiShell(
    "seatmesh ui",
    `<main>
  <section class="panel">
    <h1>seatmesh browser</h1>
    <p class="lede">Local inbox control plane on <code>127.0.0.1:${port}</code>.</p>
    <div class="row">
      <a class="btn btn-link" href="/ui/">Targets</a>
      <a class="btn btn-info" href="/ui/decide.html">Decide</a>
      <a class="btn btn-muted" href="/health">Health</a>
    </div>
  </section>
</main>`,
    { navOn: "targets" },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
