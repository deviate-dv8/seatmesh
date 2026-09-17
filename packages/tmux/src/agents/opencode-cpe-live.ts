import type { PaneSnapshot, ResolvedAgentKind } from "@seat-mesh/core";
import {
  liveKindSatisfiesWanted,
  resolveLiveHarnessKind,
} from "@seat-mesh/core";
import { cmdlines } from "@seat-mesh/providers";

/**
 * Live harness labeling + satisfy for OpenCode family extensions (CPE, etc.).
 * Logic lives in `@seat-mesh/core` (kind prove/satisfy). This module keeps the
 * historical API and optional kinds map from the profile.
 */

export function cmdlineLooksLikeOpenCodeCpe(snap: PaneSnapshot | null | undefined): boolean {
  if (!snap) return false;
  return cmdlines(snap).some((l) =>
    /opencode-cpe\.sh|HTTPS_PROXY=.*18887|HTTP_PROXY=.*18887/i.test(l),
  );
}

/** Prefer mesh-agents / prove evidence over raw detect id for harness label. */
export function resolveOpenCodeHarnessType(input: {
  detectId?: string | null;
  savedType?: string | null;
  resumeCmd?: string | null;
  snap?: PaneSnapshot | null;
  kinds?: Record<string, ResolvedAgentKind>;
}): string {
  return resolveLiveHarnessKind({
    detectId: input.detectId,
    savedType: input.savedType,
    resumeCmd: input.resumeCmd,
    snap: input.snap,
    cmdlines: input.snap ? cmdlines(input.snap) : undefined,
    kinds: input.kinds,
  });
}

/**
 * True when we must NOT kill/relaunch: live pane already satisfies wanted type.
 */
export function liveHarnessSatisfiesWanted(
  liveType: string,
  wantedType: string,
  snap?: PaneSnapshot | null,
  opts?: {
    savedType?: string | null;
    resumeCmd?: string | null;
    kinds?: Record<string, ResolvedAgentKind>;
  },
): boolean {
  return liveKindSatisfiesWanted(
    liveType,
    wantedType,
    {
      snap,
      cmdlines: snap ? cmdlines(snap) : undefined,
      resumeCmd: opts?.resumeCmd,
    },
    opts?.kinds,
    { savedType: opts?.savedType, resumeCmd: opts?.resumeCmd },
  );
}
