/** Short provider tags for speaker labels (slot-3-kiro, mini-1-oc, …). */
export function providerSpeakerTag(providerId: string): string {
  const id = providerId.trim().toLowerCase();
  if (id === "cursor-agent" || id === "agent") return "cursor";
  if (id === "opencode") return "oc";
  if (id === "claude") return "claude";
  if (id === "kiro") return "kiro";
  if (!id || id === "unknown" || id === "empty") return "agent";
  return id.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "agent";
}

/**
 * Peer-facing seat tag: worker-3 → slot-3, mini-6 stays mini-6, manager stays manager.
 */
export function seatSpeakerTag(slot: string): string {
  const s = slot.trim();
  const worker = /^worker-(\d+)$/i.exec(s);
  if (worker) return `slot-${worker[1]}`;
  return s || "unknown";
}

/** Stable agent speaker id: `slot-3-kiro`, `mini-1-oc`, `manager-claude`. */
export function chatAgentSpeaker(slot: string, providerId: string): string {
  return `${seatSpeakerTag(slot)}-${providerSpeakerTag(providerId)}`;
}

/** Classify the inbound prompt side of a turn. */
export function chatHumanKind(humanPrompt: string): "human" | "system" {
  const t = humanPrompt.trim();
  if (/\[mesh-inbox/i.test(t)) return "system";
  if (/^\[agent[-_]/i.test(t)) return "system";
  if (/^\[mesh-cold-start\]/i.test(t)) return "system";
  return "human";
}

/** One turn as transcript lines (what operators expect to read). */
export function formatChatTranscript(record: {
  agent?: string;
  slot: string;
  providerId: string;
  humanPrompt: string;
  agentResponse?: string;
  humanKind?: "human" | "system";
}): string {
  const agent = record.agent?.trim() || chatAgentSpeaker(record.slot, record.providerId);
  const kind = record.humanKind ?? chatHumanKind(record.humanPrompt);
  const humanTag = kind === "system" ? "system" : "human";
  const lines = [`[${humanTag}]: ${record.humanPrompt.trim()}`];
  const reply = record.agentResponse?.trim();
  if (reply) lines.push(`[${agent}]: ${reply}`);
  return lines.join("\n");
}
