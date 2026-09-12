/** Parse @worker-3 @slot-6 @mini-2 style mentions from room / peer text. */
export function parseMentionAgentIds(text: string): string[] {
  const found = new Set<string>();
  const re = /@(?:worker-|slot-)?(\d+)\b|@mini-(\d+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) found.add(`worker-${m[1]}`);
    if (m[2]) found.add(`mini-${m[2]}`);
  }
  return [...found];
}

export function agentIdToSlot(agentId: string): string | null {
  const w = agentId.match(/^worker-(\d+)$/);
  if (w) return w[1];
  return null;
}
