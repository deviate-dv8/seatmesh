/**
 * Agent launch command builder — one place for pane shell setup before a CLI runs.
 *
 * OpenCode is plain `opencode --auto` (same style as claude/kiro/agent). CPE / proxy
 * wrappers live in workspace configs (e.g. scripts/opencode-cpe.sh) — not the engine.
 */

const LAUNCH_PREFIX = "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor";

export type HarnessCliType =
  | "agent"
  | "claude"
  | "kiro"
  | "opencode"
  | "opencode-main"
  | "empty";

/** Shell prefix for Cursor / Claude launches (color + permission quirks). */
export function cliLaunchPrefix(): string {
  return LAUNCH_PREFIX;
}

/**
 * Full one-liner pasted into the pane (send-keys -l … Enter).
 * Returns null for empty seats.
 */
export function buildAgentLaunchCmd(
  type: string,
  workspace: string,
  resumeId?: string | null,
): string | null {
  const t = type === "cursor-agent" ? "agent" : type;
  if (!t || t === "empty") return null;

  switch (t) {
    case "agent":
      // --trust: skip "accept this workspace" prompt (blocks spawn if unanswered).
      // --approve-mcps: avoid MCP approval dialogs on first boot.
      return resumeId
        ? `${LAUNCH_PREFIX} agent --trust --approve-mcps --resume ${resumeId} --workspace ${workspace}`
        : `${LAUNCH_PREFIX} agent --trust --approve-mcps --workspace ${workspace}`;
    case "claude":
      return resumeId
        ? `${LAUNCH_PREFIX} claude --permission-mode auto --resume ${resumeId}`
        : `${LAUNCH_PREFIX} claude --permission-mode auto`;
    case "kiro":
      // kiro-cli is the binary on PATH (not `kiro`). Opus = claude-opus-5.
      return resumeId
        ? `${LAUNCH_PREFIX} kiro-cli chat --resume-id ${resumeId} --trust-all-tools --model claude-opus-5`
        : `${LAUNCH_PREFIX} kiro-cli chat --trust-all-tools --model claude-opus-5`;
    case "opencode":
    case "opencode-main":
      // Plain OC — no CPE/proxy wrapper. Workspace configs may still set a custom
      // resumeCmd in mesh-agents.json when they need scripts/opencode-cpe.sh.
      return resumeId
        ? `${LAUNCH_PREFIX} opencode --auto --session ${resumeId}`
        : `${LAUNCH_PREFIX} opencode --auto`;
    default:
      return null;
  }
}
