/**
 * Tiny safe markdown → HTML for seatmesh Info cards (no deps).
 * Supports headings, lists, bold/italic, links, images (incl. data URIs), paragraphs.
 */
export function renderSimpleMarkdown(src: string): string {
  const text = src.replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  let inUl = false;

  const flushUl = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      flushUl();
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushUl();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inline(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
      i++;
      continue;
    }

    flushUl();
    // paragraph: gather until blank
    const chunk: string[] = [trimmed];
    i++;
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3})\s+/.test(lines[i]!.trim()) && !/^[-*]\s+/.test(lines[i]!.trim())) {
      chunk.push(lines[i]!.trim());
      i++;
    }
    out.push(`<p>${inline(chunk.join(" "))}</p>`);
  }
  flushUl();
  return out.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function inline(s: string): string {
  let t = escapeHtml(s);
  // images ![alt](url) — allow http(s) and data:
  t = t.replace(
    /!\[([^\]]*)\]\((data:[^)\s]+|https?:[^)\s]+)\)/g,
    (_m, alt: string, url: string) =>
      `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" class="md-img" />`,
  );
  // links [text](url)
  t = t.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${label}</a>`,
  );
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  return t;
}
