import type { PaneSnapshot } from "@seat-mesh/core";
import { cmdlines, matchAny } from "@seat-mesh/providers";
import { isOpenCodeCpeResumeCmd } from "../session/save-session.js";

/**
 * Live provider detect always returns `opencode` for CPE-wrapped OC (child
 * process is bare opencode with HTTPS_PROXY). Without this, tryLaunchPane /
 * coord-sync see liveType=opencode vs wanted=oc-proxy and stopLiveCli — panes
 * "kill themselves".
 */

export function cmdlineLooksLikeOcProxy(snap: PaneSnapshot | null | undefined): boolean {
  if (!snap) return false;
  return matchAny(cmdlines(snap), [
    /opencode-cpe\.sh/i,
    /HTTPS_PROXY=.*18887/i,
    /HTTP_PROXY=.*18887/i,
  ]);
}

function ocUiLive(snap: PaneSnapshot | null | undefined): boolean {
  if (!snap) return false;
  if (snap.options?.mesh_oc_session?.trim()) return true;
  return /ctrl\+p commands|Build auto\s+·|OpenCode\s+\d/i.test(snap.captureTail ?? "");
}

/** Prefer mesh-agents / CPE proof over raw detect id for OpenCode harness label. */
export function resolveOpenCodeHarnessType(input: {
  detectId?: string | null;
  savedType?: string | null;
  resumeCmd?: string | null;
  snap?: PaneSnapshot | null;
}): string {
  const detect = input.detectId ?? "empty";
  if (detect && detect !== "opencode" && detect !== "empty") {
    return detect === "cursor-agent" ? "agent" : detect;
  }
  if (
    input.savedType === "oc-proxy" ||
    isOpenCodeCpeResumeCmd(input.resumeCmd) ||
    cmdlineLooksLikeOcProxy(input.snap)
  ) {
    return "oc-proxy";
  }
  if (detect === "opencode") return "opencode";
  return detect || "empty";
}

/**
 * True when we must NOT kill/relaunch: live pane already satisfies wanted type.
 * CPE live (detect=opencode) + mesh-agents oc-proxy / cpe cmdline → satisfies oc-proxy.
 */
export function liveHarnessSatisfiesWanted(
  liveType: string,
  wantedType: string,
  snap?: PaneSnapshot | null,
  opts?: { savedType?: string | null; resumeCmd?: string | null },
): boolean {
  if (!wantedType || wantedType === "empty") return liveType === "empty";
  if (liveType === wantedType) return true;
  if (wantedType === "oc-proxy" && liveType === "opencode") {
    if (cmdlineLooksLikeOcProxy(snap)) return true;
    // Seat is configured oc-proxy and OC UI is up — never kill as "wrong provider".
    if (
      (opts?.savedType === "oc-proxy" || isOpenCodeCpeResumeCmd(opts?.resumeCmd)) &&
      ocUiLive(snap)
    ) {
      return true;
    }
  }
  if (wantedType === "opencode" && liveType === "oc-proxy") return false;
  return false;
}
