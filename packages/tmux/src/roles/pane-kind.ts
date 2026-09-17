import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { composerFromCapture } from "@seat-mesh/providers";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { seatAgentEntry } from "../agents/agents-state.js";
import { kindsForLoaded } from "../agents/agent-launch.js";
import { resolveOpenCodeHarnessType } from "../agents/opencode-cpe-live.js";

export type PaneSurfaceKind = "agent" | "terminal" | "unknown";

export interface PaneKindReport {
  seat: string;
  paneId: string;
  kind: PaneSurfaceKind;
  provider: string;
  phase: string;
  cmd: string;
  /** One-line agent-readable verdict. */
  verdict: string;
}

const AGENT_PROVIDERS = new Set([
  "claude",
  "opencode",
  "cursor",
  "cursor-agent",
  "kiro",
  "agent",
]);

function seatLabel(role: string, slot: string, mini: string): string {
  if (mini) return mini.startsWith("mini-") ? mini : `mini-${mini}`;
  if (slot && /^\d+$/.test(slot)) return `slot-${slot}`;
  if (slot && slot !== "-") return slot;
  if (role === "manager" || role === "manager-2") return "manager";
  if (role === "secretary") return "secretary";
  return role || "unknown";
}

function isShellCmd(cmd: string): boolean {
  const c = cmd.trim().split(/\s+/)[0] ?? "";
  return /^(zsh|bash|sh|fish|tmux|nu|pwsh|powershell)$/i.test(c);
}

/**
 * Classify whether a pane is a live agent CLI or a plain terminal.
 * Used by manager/secretary before peer/inject when unsure.
 */
export function classifyPaneSurface(input: {
  providerId: string;
  phase: string;
  cmd: string;
}): PaneSurfaceKind {
  const provider = (input.providerId || "unknown").toLowerCase();
  const phase = (input.phase || "").toLowerCase();

  if (provider === "empty") return "terminal";
  if (AGENT_PROVIDERS.has(provider)) return "agent";
  if (phase === "plain_shell") return "terminal";
  if (provider === "unknown" || !provider) {
    return isShellCmd(input.cmd) ? "terminal" : "unknown";
  }
  // Custom / third-party provider id that detected itself — treat as agent.
  return "agent";
}

export function inspectPaneKind(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
): PaneKindReport {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }
  const { paneId, row } = resolved;
  const snap = capturePaneSnapshot(paneId);
  if (!snap) {
    throw new Error(`kind: could not read pane ${paneId}`);
  }

  const prov = registry.detect(snap);
  const detectId = prov?.id ?? "unknown";
  const role = snap.options.mesh_role || row.role || "?";
  const slot = snap.options.mesh_slot || row.slot || "-";
  const mini = snap.options.mesh_mini || row.mini || "";
  const seat = seatLabel(role, slot === "-" ? "" : slot, mini);
  const saved = seatAgentEntry(loaded, seat);
  const kinds = kindsForLoaded(loaded);
  const providerId = resolveOpenCodeHarnessType({
    detectId: detectId === "unknown" ? "empty" : detectId,
    savedType: saved?.type,
    resumeCmd: saved?.resume_cmd,
    snap,
    kinds,
  });
  const reportProvider = providerId === "empty" ? detectId : providerId;
  const composer = composerFromCapture(snap, detectId === "unknown" ? "empty" : detectId);
  const cmd = snap.currentCommand || "?";
  const phase = composer.phase;
  const kind = classifyPaneSurface({
    providerId: reportProvider === "opencode-cpe" ? "opencode" : reportProvider,
    phase,
    cmd,
  });

  const verdict =
    kind === "agent"
      ? `AGENT — ${seat} is a live agent (${reportProvider}, ${phase})`
      : kind === "terminal"
        ? `TERMINAL — ${seat} is a plain shell (${cmd}, ${phase})`
        : `UNKNOWN — ${seat} provider=${reportProvider} cmd=${cmd} phase=${phase}`;

  return {
    seat,
    paneId,
    kind,
    provider: reportProvider,
    phase,
    cmd,
    verdict,
  };
}

export function runPaneKind(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  opts: { json?: boolean } = {},
): PaneKindReport {
  const report = inspectPaneKind(loaded, registry, target);
  if (opts.json) {
    console.log(JSON.stringify(report));
    return report;
  }
  // Machine-friendly first; human verdict last.
  console.log(
    [
      `kind=${report.kind}`,
      `seat=${report.seat}`,
      `pane=${report.paneId}`,
      `provider=${report.provider}`,
      `phase=${report.phase}`,
      `cmd=${report.cmd}`,
      report.verdict,
    ].join("\n"),
  );
  return report;
}
