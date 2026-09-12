import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { enqueuePeer } from "../comms/inbox-bridge.js";
import { injectPromptDirect } from "../inject/prompt.js";
import { runWhoami } from "../agents/whoami.js";
import { buildFullColdStartBrief } from "./cold-start.js";
import { gateQueuePath, seatFile } from "./seat-paths.js";
import {
  recordColdStartEnqueue,
  seatHubFingerprint,
  shouldSkipColdStartEnqueue,
} from "./cold-start-state.js";

const PREFIX = "[mesh-cold-start] ";

function hubPaths(
  loaded: LoadedProfile,
  w: ReturnType<typeof runWhoami>,
  mini: string | null,
): (string | null)[] {
  const role = w.role;
  const target =
    role === "manager"
      ? { role: "manager" as const }
      : role === "secretary"
        ? { role: "secretary" as const }
        : role === "manager-mini" || mini
          ? { role: "manager-mini" as const, mini }
          : {
              role: "worker" as const,
              slot: w.slotLabel ?? (w.slot != null ? String(w.slot) : null),
            };
  return [
    gateQueuePath(loaded),
    seatFile(loaded, target, "FOCUS.md"),
    seatFile(loaded, target, "TASKS.md"),
  ];
}

/** Enqueue cold-start briefing to a pane (daemon inject when idle). Idempotent per hub fingerprint. */
export function enqueueColdStart(
  loaded: LoadedProfile,
  target: string,
  opts: { mini?: string | null; force?: boolean } = {},
): { skipped: boolean; fingerprint: string } {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const w = runWhoami(loaded, target);
  const mini = opts.mini ?? resolved.row.mini ?? null;
  const paths = hubPaths(loaded, w, mini);
  const fingerprint = seatHubFingerprint(loaded, paths);

  const targetLabel =
    resolved.row.role === "manager-mini" && mini
      ? `mini-${mini}`
      : resolved.row.role === "worker" && resolved.row.slot
        ? `slot-${resolved.row.slot}`
        : target;

  if (
    shouldSkipColdStartEnqueue(
      loaded,
      resolved.paneId,
      targetLabel,
      fingerprint,
      { force: opts.force },
    )
  ) {
    return { skipped: true, fingerprint };
  }

  const body = PREFIX + buildFullColdStartBrief(loaded, w, { mini });
  const resp = enqueuePeer(loaded, {
    kind: "prompt",
    msg: body,
    targetPane: resolved.paneId,
    targetLabel,
    fromSlot: "mesh-cold-start",
  });
  if (!resp?.ok) {
    throw new Error("FAIL: cold-start enqueue — run: ./sm.sh inbox restart");
  }
  recordColdStartEnqueue(loaded, resolved.paneId, targetLabel, fingerprint);
  return { skipped: false, fingerprint };
}

/** Direct inject when CLI is already live (handoff / mini spawn). */
export function injectColdStartDirect(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  opts: { mini?: string | null } = {},
): void {
  const w = runWhoami(loaded, target);
  const mini = opts.mini ?? null;
  const body = PREFIX + buildFullColdStartBrief(loaded, w, { mini });
  injectPromptDirect(loaded, registry, target, body, { prefix: "" });
}
