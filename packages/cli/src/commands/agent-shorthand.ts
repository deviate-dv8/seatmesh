/**
 * Universal agent shorthands — zero flag forest.
 * All seats may run these via `seatmesh agent <shorthand> …`.
 */
export const AGENT_SHORTHANDS = {
  /** peer <target> "…" — open/send ask */
  ask: "peer",
  msg: "peer",
  tell: "peer",
  /** peer --ack — reply + close open ask */
  ackmsg: "peer-ack",
  answered: "peer-ack",
  /** ack reply <id> [msg] */
  reply: "ack-reply",
} as const;

export type AgentShorthand = keyof typeof AGENT_SHORTHANDS;

export function isAgentShorthand(cmd: string): cmd is AgentShorthand {
  return Object.prototype.hasOwnProperty.call(AGENT_SHORTHANDS, cmd.trim().toLowerCase());
}

/**
 * Rewrite argv for shorthand → canonical verb.
 * Input: rest args after the shorthand verb (target/msg or id/msg).
 * Returns new process.argv-style list starting at the CLI verb (no node/bin).
 */
export function expandAgentShorthand(
  shorthand: string,
  args: string[],
): { argvRest: string[]; label: string } {
  const s = shorthand.trim().toLowerCase() as AgentShorthand;
  const kind = AGENT_SHORTHANDS[s];
  if (!kind) {
    throw new Error(`unknown shorthand: ${shorthand}`);
  }
  if (kind === "peer") {
    if (args.length < 2) {
      throw new Error(`usage: ${s} <target> "<msg>"`);
    }
    return {
      argvRest: ["peer", ...args],
      label: `${s} → peer (send)`,
    };
  }
  if (kind === "peer-ack") {
    if (args.length < 2) {
      throw new Error(`usage: ${s} <target> "<msg>"   # peer --ack`);
    }
    return {
      argvRest: ["peer", "--ack", ...args],
      label: `${s} → peer --ack (reply+close)`,
    };
  }
  // ack-reply
  if (args.length < 1) {
    throw new Error(`usage: ${s} <ack-id> [msg]`);
  }
  return {
    argvRest: ["ack", "reply", ...args],
    label: `${s} → ack reply`,
  };
}
