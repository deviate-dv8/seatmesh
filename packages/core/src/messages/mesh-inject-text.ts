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
  if (matches(/^\[from:[^\]]+ to:[^\]]+\]/)) return true;
  if (matches(/^\[remote\s/)) return true;
  if (matches(/^\[agent-manager/)) return true;
  if (matches(/^\[mesh-inbox/)) return true;
  if (matches(/^\[mesh-peer\]/)) return true;
  if (matches(/^\[mesh-secretary\]/)) return true;
  if (matches(/^\[agent-worker-slot-/)) return true;
  if (matches(/^\[agent-mini-/)) return true;
  if (/\[sent:[a-z0-9]+\]/i.test(t)) return true;
  if (matches(/^ASSIGN\s/)) return true;
  if (matches(/^FRESH SUMMON/)) return true;
  if (matches(/^Check:\s/)) return true;
  if (matches(/^SUPERVISE|^SECRETARY-DIGEST/)) return true;
  if (matches(/\[mesh-inbox\]\s+DIGEST\b/)) return true;
  return false;
}
