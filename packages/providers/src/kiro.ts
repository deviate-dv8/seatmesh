import type { AgentProvider, Detection, InjectPlan, PaneSnapshot } from "@seat-mesh/core";
import {
  cmdlines,
  composerFromCapture,
  defaultComposerReady,
  extractUuid,
  matchAny,
  modelFromCmdlines,
  scrapePromptTurnGeneric,
  sessionIdFromDetection,
} from "./shared.js";

const PATTERNS = [/kiro-cli/, /kiro-cli-chat/];

export const kiroProvider: AgentProvider = {
  id: "kiro",

  detect(pane: PaneSnapshot): Detection | null {
    const lines = cmdlines(pane);
    if (!matchAny(lines, PATTERNS)) return null;
    let resumeId: string | undefined;
    for (const line of lines) {
      resumeId = extractUuid(line, ["--resume-id", "--resume"]);
      if (resumeId) break;
    }
    return { providerId: "kiro", resumeId };
  },

  composerState(pane: PaneSnapshot) {
    return composerFromCapture(pane, "kiro");
  },

  composerReady(pane: PaneSnapshot) {
    return defaultComposerReady(pane, "kiro");
  },

  injectPlan(_pane: PaneSnapshot): InjectPlan {
    return {
      prefix: "",
      useBracketedPaste: true,
      enterDelayMs: 280,
      // Escape on kiro-cli can submit empty turns — clear with C-u only in inject.ts.
      flushEscFirst: false,
    };
  },

  sessionId(_pane, detection) {
    return sessionIdFromDetection(detection);
  },

  modelId(pane) {
    return modelFromCmdlines(cmdlines(pane), "kiro");
  },

  scrapePromptTurn(pane) {
    return scrapePromptTurnGeneric(pane);
  },

  kindBase() {
    return {
      provider: "kiro",
      launch: { builtin: "kiro" },
    };
  },
};
