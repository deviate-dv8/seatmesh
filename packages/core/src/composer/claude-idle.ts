/** A run of box-drawing/rule characters — decorative divider, not composer text. */
const RULE_LINE_RE = /^[\s─━│┃┆┊╌╍┄┅╭╮╰╯┌┐└┘┏┓┗┛┣┫┳┻╋=_.\-]{3,}$/;

const CLAUDE_NON_DRAFT_HINT_RE = /^Press up to edit queued messages$/i;

export function isClaudePlaceholderPromptContent(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (RULE_LINE_RE.test(t)) return true;
  if (/^[\s─━│┃┆┊╌╍┄┅╭╮╰╯┌┐└┘┏┓┗┛┣┫┳┻╋=_.\-]+$/.test(t)) return true;
  return false;
}

export function isClaudeDecorativeChromeNeighbor(prevLine: string, nextLine: string): boolean {
  return RULE_LINE_RE.test(prevLine.trim()) || RULE_LINE_RE.test(nextLine.trim());
}

const CLAUDE_AUTO_MODE_FOOTER_RE = /auto mode on|shift\+tab to cycle/i;

/**
 * Claude auto-mode wraps the live composer between divider lines with an
 * "auto mode on" footer — still the real composer, not a scrollback chip.
 */
export function isClaudeLiveComposerRow(lines: string[], idx: number): boolean {
  const prev = lines[idx - 1] ?? "";
  const next = lines[idx + 1] ?? "";
  if (!isClaudeDecorativeChromeNeighbor(prev, next)) return true;
  for (let j = idx + 1; j < Math.min(lines.length, idx + 6); j++) {
    if (CLAUDE_AUTO_MODE_FOOTER_RE.test(lines[j] ?? "")) return true;
  }
  return false;
}

/**
 * True when Claude shows a live empty composer (❯ with no draft) in the bottom band.
 * Scrollback status lines like "still thinking" must not wedge borders as BUSY.
 */
export function claudeIdleEmptyComposer(captureTail: string): boolean {
  const lines = captureTail.split("\n");
  const start = Math.max(0, lines.length - 14);
  for (let i = lines.length - 1; i >= start; i--) {
    const line = lines[i] ?? "";
    const m = /^\s*❯\s+(.*)$/.exec(line);
    if (m) {
      const first = (m[1] ?? "").trim();
      const emptyPrompt =
        isClaudePlaceholderPromptContent(first) || CLAUDE_NON_DRAFT_HINT_RE.test(first);
      if (!emptyPrompt && !isClaudeLiveComposerRow(lines, i)) {
        continue;
      }
      if (!emptyPrompt) {
        // Live draft on prompt row (may continue on following lines).
        for (let j = i + 1; j < lines.length; j++) {
          const cont = lines[j] ?? "";
          if (!cont.trim()) break;
          if (/^\s*❯\s/.test(cont)) break;
          if (cont.trim()) return false;
        }
        return false;
      }
      return true;
    }
    if (/^\s*❯\s*$/.test(line.replace(/\u00a0/g, " "))) {
      return true;
    }
  }
  return false;
}
