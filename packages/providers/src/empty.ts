import type { AgentProvider, Detection, InjectPlan, PaneSnapshot } from "seat-mesh-core";
import { cmdlines, matchAny } from "./shared.js";

const CLI_PATTERNS = [
  /cursor-agent/,
  /\/\.local\/bin\/agent/,
  /kiro-cli/,
  /\bclaude\b/,
  /opencode/,
];

export const emptyProvider: AgentProvider = {
  id: "empty",

  detect(pane: PaneSnapshot): Detection | null {
    const lines = cmdlines(pane);
    if (lines.length === 0) return { providerId: "empty" };
    if (matchAny(lines, CLI_PATTERNS)) return null;
    const shellOnly = lines.every((l) => /^(zsh|bash|sh|fish|tmux)/.test(l) || l.includes(" -zsh") || l.includes(" -bash"));
    if (shellOnly || pane.currentCommand.match(/^(zsh|bash|sh)$/)) {
      return { providerId: "empty" };
    }
    return null;
  },

  composerState() {
    return { phase: "plain_shell" };
  },

  composerReady() {
    return false;
  },

  injectPlan(): InjectPlan {
    return {
      prefix: "",
      useBracketedPaste: false,
      enterDelayMs: 0,
      flushEscFirst: false,
    };
  },

  sessionId() {
    return undefined;
  },

  modelId() {
    return undefined;
  },

  scrapePromptTurn() {
    return null;
  },
};
