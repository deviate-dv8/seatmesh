import type { AgentProvider, Detection, InjectPlan, PaneSnapshot } from "@seat-mesh/core";
import {
  agentInputDraft,
  cmdlines,
  composerFromCapture,
  defaultComposerReady,
  extractUuid,
  matchAny,
  modelFromCmdlines,
  scrapePromptTurnGeneric,
  sessionIdFromDetection,
} from "./shared.js";

const PATTERNS = [
  /cursor-agent/,
  /\/\.local\/bin\/agent(\s|$)/,
];

export const cursorAgentProvider: AgentProvider = {
  id: "cursor-agent",

  detect(pane: PaneSnapshot): Detection | null {
    const lines = cmdlines(pane);
    if (!matchAny(lines, PATTERNS)) return null;
    let resumeId: string | undefined;
    for (const line of lines) {
      resumeId = extractUuid(line, ["--resume"]);
      if (resumeId) break;
    }
    return { providerId: "cursor-agent", resumeId };
  },

  composerState(pane: PaneSnapshot) {
    return composerFromCapture(pane, "cursor-agent");
  },

  composerReady(pane: PaneSnapshot) {
    return defaultComposerReady(pane, "cursor-agent");
  },

  injectPlan(_pane: PaneSnapshot): InjectPlan {
    return {
      prefix: "",
      useBracketedPaste: true,
      enterDelayMs: 450,
      flushEscFirst: false,
    };
  },

  sessionId(_pane, detection) {
    return sessionIdFromDetection(detection);
  },

  modelId(pane) {
    return modelFromCmdlines(cmdlines(pane), "cursor-agent");
  },

  scrapePromptTurn(pane) {
    return scrapePromptTurnGeneric(pane);
  },

  humanDraft(pane: PaneSnapshot): string {
    return agentInputDraft(pane.captureTail, pane.captureTailAnsi);
  },
};
