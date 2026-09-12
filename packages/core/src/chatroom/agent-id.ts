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
  if (role === "secretary") return "secretary";
  if (role === "manager-2") return "manager-2";
  if (role === "manager" || role === "master") return "manager";
  if (input.slot != null) return `worker-${input.slot}`;
  return role || "unknown";
}
