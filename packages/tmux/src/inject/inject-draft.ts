import { coordComposerDraft } from "@seat-mesh/providers";

/**
 * True if `text` is mesh-generated inject/steering copy, not a human draft.
 * Room-fanout pings (formatRoomPeerNotify/formatRoomCoordNotify) and the worker
 * inject stamp (formatWorkerInjectStamp) all prefix the actual tag with
 * "<seat> | " (any profile column id + inbox tag), so an
 * anchored ^ check alone never matches them — check the text with that seat
 * prefix stripped too, or every room-fanout ping gets misread as a human draft.
 */
export function isSmInjectText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const stripped = t.replace(/^[^\n|]{1,40}\|\s*/, "");
  const matches = (re: RegExp) => re.test(t) || re.test(stripped);
  if (matches(/^\[agent-manager/)) return true;
  if (matches(/^\[mesh-inbox/)) return true;
  if (matches(/^\[mesh-secretary\]/)) return true;
  if (matches(/^\[agent-worker-slot-/)) return true;
  if (/\[sent:[a-z0-9]+\]/i.test(t)) return true;
  if (matches(/^ASSIGN\s/)) return true;
  if (matches(/^FRESH SUMMON/)) return true;
  if (matches(/^Check:\s/)) return true;
  if (matches(/^SUPERVISE|^SECRETARY-DIGEST/)) return true;
  return false;
}

/** Claude Code UI hints that reuse the "❯" marker but are never a human draft. */
const CLAUDE_NON_DRAFT_HINT_RE = /^Press up to edit queued messages$/i;

function claudeComposerDraft(captureTail: string): string {
  const lines = captureTail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*❯\s+(.*)$/.exec(lines[i] ?? "");
    if (!m) continue;
    const first = (m[1] ?? "").trim();
    if (CLAUDE_NON_DRAFT_HINT_RE.test(first)) return "";
    // Continuation lines wrap without repeating "❯" — collect indented,
    // non-empty lines that follow, until a blank line or the next marker.
    const parts = [first];
    for (let j = i + 1; j < lines.length; j++) {
      const cont = lines[j] ?? "";
      if (!cont.trim()) break;
      if (/^\s*❯\s/.test(cont)) break;
      parts.push(cont.trim());
    }
    return parts.join(" ").trim();
  }
  return "";
}

/** Live human composer text to restore after an inject (empty = nothing to save). */
export function humanDraftToPreserve(
  captureTail: string,
  providerId: string,
  injectBody: string,
  captureTailAnsi?: string,
): string {
  let draft = coordComposerDraft(captureTail, providerId, captureTailAnsi).trim();
  if (!draft && providerId === "claude") draft = claudeComposerDraft(captureTail);
  if (!draft) return "";
  if (isSmInjectText(draft)) return "";
  const body = injectBody.trim();
  if (!body) return draft;
  if (draft === body || body.includes(draft)) return "";
  return draft;
}
