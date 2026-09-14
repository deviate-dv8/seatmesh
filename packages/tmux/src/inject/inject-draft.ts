import { isSmInjectText } from "@seat-mesh/core";
import { claudeInputDraft, coordComposerDraft } from "@seat-mesh/providers";

export { isSmInjectText };

/** Live human composer text to restore after an inject (empty = nothing to save). */
export function humanDraftToPreserve(
  captureTail: string,
  providerId: string,
  injectBody: string,
  captureTailAnsi?: string,
): string {
  let draft = coordComposerDraft(captureTail, providerId, captureTailAnsi).trim();
  if (!draft && providerId === "claude") draft = claudeInputDraft(captureTail);
  if (!draft) return "";
  if (isSmInjectText(draft)) return "";
  const body = injectBody.trim();
  if (!body) return draft;
  if (draft === body) return "";
  // Stale paste: long draft already inside the inject body. Do not drop short human
  // drafts that happen to appear inside a large DIGEST (body.includes was too eager).
  if (draft.length >= 40 && body.includes(draft)) return "";
  return draft;
}
