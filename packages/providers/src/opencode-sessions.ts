import { spawnSync } from "node:child_process";

export interface OpenCodeSessionRow {
  id: string;
  title: string;
  updated: number;
  directory?: string;
}

function opencodeBin(): string {
  return (
    process.env.OPENCODE_BIN ??
    `${process.env.HOME ?? ""}/.opencode/bin/opencode`
  );
}

/** Recent OpenCode sessions for workspace (JSON list). */
export function listOpenCodeSessions(
  workspace: string,
  max = 30,
): OpenCodeSessionRow[] {
  const r = spawnSync(
    opencodeBin(),
    ["session", "list", "--format", "json", "-n", String(max)],
    { cwd: workspace, encoding: "utf8", timeout: 20_000 },
  );
  if (r.status !== 0) return [];
  try {
    return JSON.parse(r.stdout || "[]") as OpenCodeSessionRow[];
  } catch {
    return [];
  }
}

/** Best-effort secretary session when cmdline/pane var are empty. */
export function guessSecretaryOpenCodeSession(workspace: string): string | undefined {
  const sessions = listOpenCodeSessions(workspace, 40);
  const sec = sessions.filter((s) => /secretary/i.test(s.title));
  if (!sec.length) return undefined;
  sec.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
  return sec[0]?.id;
}
