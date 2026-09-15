import type { NotifyActLink } from "@seat-mesh/core";
import type { NotifyActCardRow } from "./notify-act.js";
import { markdownNeedsMermaid, renderSimpleMarkdown } from "./simple-markdown.js";

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
main.wide{max-width:56rem}
h1{font-size:1.55rem;font-weight:600;margin:0 0 .5rem}
.lede{color:var(--muted);margin:0 0 1.25rem}
.body,.md{color:var(--muted);margin:0 0 1.25rem}
.md h1,.md h2,.md h3{color:var(--ink);margin:1rem 0 .4rem;font-weight:600}
.md h1{font-size:1.35rem}.md h2{font-size:1.15rem}.md h3{font-size:1.05rem}
.md p{margin:.55rem 0}.md ul,.md ol{margin:.4rem 0 .8rem 1.2rem;padding:0}
.md li{margin:.25rem 0}.md code{font-family:var(--mono);font-size:.9em;color:var(--ink)}
.md a{color:var(--accent)}.md-img{display:block;max-width:100%;margin:.75rem 0;border:1px solid var(--line)}
.md pre{overflow:auto;padding:.75rem 1rem;background:#0a101c;border:1px solid var(--line);margin:.75rem 0}
.md pre code{color:var(--ink);font-size:.85em}
.md pre.mermaid{background:transparent;border:none;margin:0;padding:0;text-align:center;overflow:visible}
.mm-view{position:relative;margin:.85rem 0;border:1px solid var(--line);background:#0a101c}
.mm-toolbar{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;padding:.4rem .55rem;border-bottom:1px solid var(--line);background:#0e1624}
.mm-toolbar button{appearance:none;background:transparent;color:var(--muted);border:1px solid var(--line);padding:.25rem .55rem;font:600 .8rem/1.2 var(--font);cursor:pointer}
.mm-toolbar button:hover{color:var(--ink);border-color:var(--accent)}
.mm-toolbar .mm-pct{margin-left:auto;font:500 .75rem/1 var(--mono);color:var(--muted);min-width:3.2rem;text-align:right}
.mm-stage{position:relative;overflow:hidden;height:min(52vh,28rem);cursor:grab;touch-action:none;background:#0a101c}
.mm-stage:active{cursor:grabbing}
.mm-stage .mm-canvas{transform-origin:0 0;will-change:transform;display:inline-block;padding:1rem;min-width:100%;text-align:center}
.mm-stage svg{max-width:none;height:auto}
.mm-view.mm-expanded{position:fixed;inset:0;z-index:80;margin:0;border:none;display:flex;flex-direction:column;background:rgba(6,10,18,.96)}
.mm-view.mm-expanded .mm-stage{flex:1;height:auto}
.mm-hint{padding:.35rem .65rem;font-size:.72rem;color:var(--muted);border-top:1px solid var(--line)}
body.mm-noscroll{overflow:hidden}
.md table{width:100%;border-collapse:collapse;margin:.75rem 0;font-size:.92em}
.md th,.md td{border:1px solid var(--line);padding:.35rem .55rem;text-align:left}
.md th{color:var(--ink);background:#0e1624}
.md blockquote{margin:.75rem 0;padding:.25rem 0 .25rem .9rem;border-left:3px solid var(--line);color:var(--muted)}
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

/** Mermaid CDN + zoom / pan / expand chrome for Info cards. */
export const MERMAID_CARD_SCRIPT = `
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "strict",
  fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif",
});
await mermaid.run({ querySelector: "pre.mermaid" });

const MIN = 0.35;
const MAX = 4;
const STEP = 0.15;

function wireMermaidView(pre) {
  const svg = pre.querySelector("svg");
  if (!svg || pre.closest(".mm-view")) return;

  const view = document.createElement("div");
  view.className = "mm-view";

  const toolbar = document.createElement("div");
  toolbar.className = "mm-toolbar";
  toolbar.innerHTML = [
    '<button type="button" data-act="out" title="Zoom out (−)">−</button>',
    '<button type="button" data-act="in" title="Zoom in (+)">+</button>',
    '<button type="button" data-act="reset" title="Reset (0)">Reset</button>',
    '<button type="button" data-act="fit" title="Fit">Fit</button>',
    '<button type="button" data-act="expand" title="Expand (f)">Expand</button>',
    '<span class="mm-pct">100%</span>',
  ].join("");

  const stage = document.createElement("div");
  stage.className = "mm-stage";
  const canvas = document.createElement("div");
  canvas.className = "mm-canvas";

  const hint = document.createElement("div");
  hint.className = "mm-hint";
  hint.textContent = "Scroll zoom · drag pan · double-click expand · Esc exit";

  const parent = pre.parentNode;
  parent.insertBefore(view, pre);
  canvas.appendChild(pre);
  pre.style.display = "block";
  pre.style.border = "none";
  pre.style.margin = "0";
  pre.style.padding = "0";
  pre.style.background = "transparent";
  stage.appendChild(canvas);
  view.appendChild(toolbar);
  view.appendChild(stage);
  view.appendChild(hint);

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const pct = toolbar.querySelector(".mm-pct");

  function apply() {
    canvas.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
    pct.textContent = Math.round(scale * 100) + "%";
  }

  function zoomAt(next, cx, cy) {
    const rect = stage.getBoundingClientRect();
    const x = (cx ?? rect.left + rect.width / 2) - rect.left;
    const y = (cy ?? rect.top + rect.height / 2) - rect.top;
    const clamped = Math.min(MAX, Math.max(MIN, next));
    const k = clamped / scale;
    tx = x - (x - tx) * k;
    ty = y - (y - ty) * k;
    scale = clamped;
    apply();
  }

  function fit() {
    const sRect = stage.getBoundingClientRect();
    const b = svg.getBBox();
    if (!b.width || !b.height || !sRect.width || !sRect.height) {
      scale = 1; tx = 0; ty = 0; apply(); return;
    }
    const pad = 32;
    const sx = (sRect.width - pad) / b.width;
    const sy = (sRect.height - pad) / b.height;
    scale = Math.min(MAX, Math.max(MIN, Math.min(sx, sy, 1.5)));
    tx = (sRect.width - b.width * scale) / 2 - b.x * scale;
    ty = (sRect.height - b.height * scale) / 2 - b.y * scale;
    apply();
  }

  function reset() {
    scale = 1; tx = 0; ty = 0; apply();
  }

  function setExpanded(on) {
    view.classList.toggle("mm-expanded", on);
    document.body.classList.toggle("mm-noscroll", on);
    const btn = toolbar.querySelector('[data-act="expand"]');
    if (btn) btn.textContent = on ? "Exit" : "Expand";
    if (on) requestAnimationFrame(fit);
  }

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    if (act === "in") zoomAt(scale + STEP);
    else if (act === "out") zoomAt(scale - STEP);
    else if (act === "reset") reset();
    else if (act === "fit") fit();
    else if (act === "expand") setExpanded(!view.classList.contains("mm-expanded"));
  });

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -STEP : STEP;
    zoomAt(scale + delta, e.clientX, e.clientY);
  }, { passive: false });

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  });
  stage.addEventListener("pointerup", () => { dragging = false; });
  stage.addEventListener("pointercancel", () => { dragging = false; });

  stage.addEventListener("dblclick", (e) => {
    e.preventDefault();
    setExpanded(!view.classList.contains("mm-expanded"));
  });

  document.addEventListener("keydown", (e) => {
    if (!view.classList.contains("mm-expanded")) return;
    if (e.key === "Escape") setExpanded(false);
    else if (e.key === "+" || e.key === "=") zoomAt(scale + STEP);
    else if (e.key === "-") zoomAt(scale - STEP);
    else if (e.key === "0") reset();
    else if (e.key === "f" || e.key === "F") setExpanded(false);
  });

  apply();
}

for (const pre of document.querySelectorAll("pre.mermaid")) {
  wireMermaidView(pre);
}
</script>
`.trim();

export function htmlUiShell(
  title: string,
  bodyHtml: string,
  opts?: { navOn?: string; headExtra?: string; wide?: boolean },
): string {
  const on = opts?.navOn ?? "";
  const headExtra = opts?.headExtra ?? "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${MESH_UI_CSS}</style>
${headExtra}</head>
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
        if (lower === "yes" || (i === 0 && links.length >= 2 && lower !== "open")) cls = "btn btn-yes";
        else if (lower === "no" || (i === 1 && links.length >= 2 && lower !== "open")) cls = "btn btn-no";
      }
      if (lower === "open") cls = "btn btn-link";
      const ext = /^https?:\/\//i.test(l.url) ? ' target="_blank" rel="noopener"' : "";
      return `<a class="${cls}" href="${href}"${ext}>${label}</a>`;
    })
    .join("\n");
}

/** Browser Info card — markdown body + optional Yes/No (and other) actions. */
export function htmlDecideCardPage(card: NotifyActCardRow, port: number): string {
  const hasActs = card.links.some((l) => l.token);
  const buttons = card.links.length
    ? `<p class="lede">${hasActs ? "Actions (one-shot):" : "Links:"}</p><div class="row">${htmlButtonLinks(card.links, "yesno")}</div>`
    : "";
  const needsMermaid = markdownNeedsMermaid(card.body ?? "");
  const body = card.body
    ? `<div class="md">${renderSimpleMarkdown(card.body)}</div>`
    : `<p class="lede">No description.</p>`;
  const wide = needsMermaid ? " wide" : "";
  return htmlUiShell(
    `seatmesh · ${card.title}`,
    `<main class="${wide.trim()}">
  <section class="panel">
    <h1>${escapeHtml(card.title)}</h1>
    ${body}
    ${buttons}
  </section>
</main>
<div class="foot">seatmesh Info · :${port} · <a href="/ui/">Targets</a> · <a href="/ui/decide.html">Decide</a></div>
${needsMermaid ? MERMAID_CARD_SCRIPT : ""}`,
    { navOn: "decide", wide: needsMermaid },
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
