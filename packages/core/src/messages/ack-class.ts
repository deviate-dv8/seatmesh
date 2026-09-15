/**
 * Lightweight peer/inbox class: FYI / progress / ACK / closings — deliver without
 * opening an unanswered-ask row, without a Reply: peer footer, and without arming
 * a checkback that nags the sender for a manager reply (that loop is n+1).
 */
export function stripPeerStamps(msg: string): string {
  let body = msg.trim();
  for (let i = 0; i < 8; i++) {
    const next = body.replace(/^\[[^\]]+\]\s*/, "").trim();
    if (next === body) break;
    body = next;
  }
  return body;
}

/** Looks like an ask that needs a human/coord decision (not fire-and-forget). */
function looksLikeAsk(body: string): boolean {
  if (/\?\s*$/.test(body)) return true;
  if (
    /\b(please|pls|need you|need manager|need secretary|should I|can you|could you|waiting on (you|manager|secretary)|what (should|do) I|tell me (to|what)|awaiting (your|manager))\b/i.test(
      body,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * True when the message is status/progress/closing mail — not a new ask that
 * owes a reply. Used for follow-up-steer, ACK ledger skip, skipping Reply:
 * footers, and skipping sender checkback arm.
 */
export function isAckClassPeer(msg: string): boolean {
  const body = stripPeerStamps(msg);
  if (!body) return false;

  // Classic FYI/ACK lead tokens — always light (even with a trailing ?).
  if (
    /^(ACK|FYI|STAND-?BY|BUSY|MCP-?SYNCED|CHECKBACK\?|OPEN\b|INBOX\b|VERIFY\b|CONTINUE\b|REPORT\b|MINI-?(DONE|TASK)\b)/i.test(
      body,
    )
  ) {
    return true;
  }

  // Progress lead tokens — light unless the body is clearly asking for a decision.
  if (
    /^(PROG\b|PROVED\b|DONE\b|CLAIMED\b|STATUS\b|UPDATE\b|WIP\b|PROGRESS\b|BLOCKED\b)/i.test(body)
  ) {
    return !looksLikeAsk(body);
  }

  // Closing / prove / status replies
  if (
    /^(Noted|Thanks|Thank you|ACK received|closing\b|got it\b|ok\b|PASS\b|FAIL\b)/i.test(body)
  ) {
    return true;
  }

  // "… PASS — …" / prove lines
  if (/\bPASS\b/.test(body) && /\b(PASS\s*[—:-]|chrome|logs|prove|item\s*\d|part\s*\d)/i.test(body)) {
    return true;
  }

  // Natural progress without a question — do not pull manager into a reply loop.
  if (
    !looksLikeAsk(body) &&
    /\b(PROG|PROVED|DONE|CLAIMED|WIP|in progress|finished|completed|pushed|merged|blocked on)\b/i.test(
      body,
    )
  ) {
    return true;
  }

  return false;
}
