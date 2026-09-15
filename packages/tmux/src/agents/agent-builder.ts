/**
 * Agent launch command builder — one place for pane shell setup before a CLI runs.
 *
 * OpenCode CPE proxy: NEVER bare `opencode`. Always `scripts/opencode-cpe.sh`, which
 * runs cpe-proxy-up, exports HTTPS_PROXY in the pane shell, then exec opencode --auto.
 * (OpenCode ignores JSON network.proxy — env in the shell is the proven path.)
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
      return resumeId
        ? `cd ${workspace} && ${workspace}/scripts/opencode-cpe.sh --session ${resumeId}`
        : `cd ${workspace} && ${workspace}/scripts/opencode-cpe.sh`;
    case "opencode-main":
      return `cd ${workspace} && ${workspace}/scripts/opencode-main.sh`;
    default:
      return null;
  }
}
