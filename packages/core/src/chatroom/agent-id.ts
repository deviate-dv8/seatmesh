/** Stable agent id for room log lines (machine-oriented, not human chat). */
export function resolveAgentId(input: {
  role: string;
  slot?: number | null;
  mini?: string | number | null;
}): string {
  const role = input.role.toLowerCase();
  if (role === "manager-mini" || role === "mini") {
    const m = input.mini ?? input.slot;
    return m != null && String(m).length ? `mini-${m}` : "mini";
  }
  if (role === "manager" || role === "master") return "manager";
  if (role && role !== "worker") return role;
  if (input.slot != null) return `worker-${input.slot}`;
  return role || "unknown";
}

/** One `./sm.sh peer` target — never bare `manager-mini` (use mini-N). */
export function peerTargetForComms(input: {
  role: string;
  slot?: number | null;
  mini?: string | number | null;
}): string {
  const role = input.role.toLowerCase();
  if (role === "manager-mini" || role === "mini") {
    const m = input.mini ?? null;
    if (m != null && String(m).length > 0) return `mini-${m}`;
    return "mini-?";
  }
  if (role === "manager" || role === "master") return "manager";
  if (role === "manager2") return "manager-2";
  if (role && role !== "worker") return role;
  if (input.slot != null) return `slot-${input.slot}`;
  return role || "unknown";
}
