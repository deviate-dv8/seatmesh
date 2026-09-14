export type CallDest =
  | { tier: "worker"; slot: number }
  | { tier: "mini"; mini: number };

/** Parse room-call / cross-tier peer destination (slot-1, 1, mini-2, m2). */
export function parseCallDest(
  raw: string,
  opts: { workerCount: number; miniMax: number },
): CallDest {
  const t = raw.trim().replace(/^slot-/, "");
  const miniMatch =
    raw.match(/^(?:mini|manager-mini)-([1-9]\d*)$/i) ??
    raw.match(/^m([1-9]\d*)$/i);
  if (miniMatch) {
    const mini = Number(miniMatch[1]);
    if (mini < 1 || mini > opts.miniMax) {
      throw new Error(`refused: mini-${mini} outside 1..${opts.miniMax}`);
    }
    return { tier: "mini", mini };
  }
  const slot = Number(t);
  if (!/^[1-9]\d*$/.test(t) || slot < 1 || slot > opts.workerCount) {
    throw new Error(
      `usage: room call <slot-N|mini-N> <topic...>   (workers 1-${opts.workerCount}, minis 1-${opts.miniMax})`,
    );
  }
  return { tier: "worker", slot };
}

export function callDestLabel(dest: CallDest): string {
  return dest.tier === "worker" ? `slot-${dest.slot}` : `mini-${dest.mini}`;
}

export function callDestResolveTarget(dest: CallDest): string {
  return dest.tier === "worker" ? String(dest.slot) : `mini-${dest.mini}`;
}

export function peerRoomSlugAgents(agentA: string, agentB: string, shortId: string): string {
  const [lo, hi] = [agentA, agentB].sort();
  const safe = (s: string) => s.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-");
  return `peer-${safe(lo)}-${safe(hi)}-${shortId}`;
}
