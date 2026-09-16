import { seatmeshCmd } from "./cli-hints.js";
import { MESH_INBOX_ACTION } from "./mesh-copy.js";
import { formatMeshInboxStamp } from "./mesh-inbox-intent.js";

export interface TriagePeerTargetLine {
  id: string;
  goal: string;
  deadlineAt: string;
  kind?: "scope" | "slice" | string;
}

/** Active targets block embedded in triage context inject. */
export function formatTriageTargetsSummary(targets: TriagePeerTargetLine[]): string {
  const active = targets.filter((t) => t.goal?.trim());
  if (!active.length) return "(no active targets in queue)";
  return active
    .map((t) => {
      const k = (t.kind ?? "target").toUpperCase();
      return `· ${t.id.slice(0, 8)} ${k} deadline=${t.deadlineAt} — ${t.goal.trim()}`;
    })
    .join("\n");
}

/** Steering inject — lands before the [target …] ask peer (FIFO-linked rows). */
export function formatTriageContextInject(targets: TriagePeerTargetLine[]): string {
  const summary = formatTriageTargetsSummary(targets);
  const body =
    `${MESH_INBOX_ACTION.continueVerb} — TRIAGE CONTEXT (read before the target ask that follows). ` +
    `Run: ${seatmeshCmd("hub targets")} · ${seatmeshCmd("contexts")} · ${seatmeshCmd("ppa")}. ` +
    `Then act on the [target …] peer next — no chat reply to this line.\n` +
    `Active targets:\n${summary}`;
  return formatMeshInboxStamp(body, "triage-context");
}

export function isTriageBodyMessage(msg: string): boolean {
  return /^\[target\s+\S+\]/i.test(msg.trim());
}

export function isTriageContextPeerMsg(msg: string): boolean {
  return /intent=triage-context/i.test(msg);
}
