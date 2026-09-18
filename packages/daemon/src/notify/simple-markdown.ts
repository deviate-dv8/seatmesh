/**
 * Info-card markdown → HTML (marked GFM) with Mermaid fence support.
 * ```mermaid blocks become <pre class="mermaid"> for client-side mermaid.js.
 */
import { Marked } from "marked";
import { unescapeNotifyMarkdown } from "@seat-mesh/core";

const marked = new Marked({
  gfm: true,
  breaks: false,
});

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang ?? "").trim().toLowerCase();
      if (language === "mermaid") {
        return `<pre class="mermaid">${escapeHtml(text)}</pre>\n`;
      }
      const cls = language ? ` class="language-${escapeAttr(language)}"` : "";
      return `<pre><code${cls}>${escapeHtml(text)}</code></pre>\n`;
    },
    image({ href, title, text }: { href: string; title: string | null; text: string }) {
      const src = String(href ?? "").trim();
      if (!src || !/^(https?:|data:image\/)/i.test(src)) {
        return escapeHtml(text || "");
      }
      const alt = escapeAttr(text || "");
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return `<img src="${escapeAttr(src)}" alt="${alt}" class="md-img"${titleAttr} />`;
    },
    link({ href, title, text }: { href: string; title?: string | null; text: string }) {
      const url = String(href ?? "").trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        return text;
      }
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener"${titleAttr}>${text}</a>`;
    },
  },
});

/** Render card markdown → safe-ish HTML (GFM + mermaid fences). */
export function renderSimpleMarkdown(src: string): string {
  const text = unescapeNotifyMarkdown(src.replace(/\r\n/g, "\n")).trim();
  if (!text) return "";
  const html = marked.parse(text, { async: false });
  return typeof html === "string" ? html : "";
}

/** True when body has a ```mermaid fence (card should load mermaid.js). */
export function markdownNeedsMermaid(src: string): boolean {
  return /```\s*mermaid\b/i.test(src);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
