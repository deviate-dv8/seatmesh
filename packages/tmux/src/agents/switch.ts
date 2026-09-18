import { spawnSync } from "node:child_process";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { normalizeAgentKind, portsForSlot } from "@seat-mesh/core";
import { knownHarnessKinds, kindsForLoaded, resolveSeatLaunchCmd } from "./agent-launch.js";
import { withPaneInputEnabled } from "../inject/inject.js";
import { pasteHarnessLaunchCmd, pasteLaunchCmd } from "./launch.js";
import { isOpenCodeLaunch, verifyHarnessAfterPaste } from "./launch-verify.js";
import { isOpenCodeHarnessType, stopOpenCodeCli } from "./oc-stop.js";
import { liveHarnessSatisfiesWanted, resolveOpenCodeHarnessType } from "./opencode-cpe-live.js";
import { seatAgentEntry } from "./agents-state.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { injectAfterLaunch } from "../seats/cold-start-inject.js";
import { invalidatePaneContext } from "../seats/cold-start-state.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { selectPaneUnfocused } from "../lib/select-pane.js";
import { tmux } from "../lib/tmux-run.js";
import { isSecretaryKind, seatKindFromId } from "@seat-mesh/core";
import { enqueueColdStart } from "../seats/cold-start-inject.js";
import { saveMeshSession } from "../session/save-session.js";
import { runSwitchFast } from "./switch-fast.js";

function normalizeType(t: string): string {
  return normalizeAgentKind(t);
}

function providerIdToHarnessType(id: string): string {
  if (id === "cursor-agent") return "agent";
  return id;
}

function paneCurrentCommand(paneId: string): string {
  return tmux(["display-message", "-t", paneId, "-p", "#{pane_current_command}"]).out.trim();
}

function isPlainShellCmd(cmd: string): boolean {
  return /^(zsh|bash|sh|fish|dash)$/i.test(cmd);
}

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  spawnSync("sleep", [String(ms / 1000)]);
}

function cheapLiveType(
  paneId: string,
  savedType: string | null | undefined,
): string {
  const cmd = paneCurrentCommand(paneId);
  if (isPlainShellCmd(cmd) || !cmd) return "empty";
  if (/opencode/i.test(cmd)) {
    return savedType === "opencode-cpe" ? "opencode-cpe" : "opencode";
  }
  if (/^(agent|cursor-agent)$/i.test(cmd) || /cursor-agent/i.test(cmd)) return "agent";
  if (/^claude$/i.test(cmd)) return "claude";
  if (/kiro/i.test(cmd)) return "kiro";
  return savedType && savedType !== "empty" ? savedType : "empty";
}

/** kiro-cli --trust-all-tools still shows a one-time warning (default = No, exit). */
function acceptKiroTrustDialog(paneId: string): boolean {
  for (let i = 0; i < 25; i++) {
    const snap = capturePaneSnapshot(paneId);
    const text = snap?.captureTail ?? "";
    if (text.includes("Yes, and don't ask again")) {
      tmux(["send-keys", "-t", paneId, "Down"]);
      sleepMs(150);
      tmux(["send-keys", "-t", paneId, "Down"]);
      sleepMs(150);
      tmux(["send-keys", "-t", paneId, "Enter"]);
      sleepMs(500);
      return true;
    }
    if (/kiro_default|ask a question/.test(text)) return true;
    sleepMs(300);
  }
  return false;
}

export interface SwitchOptions {
  /** Default true — switch always starts clean unless --keep-resume or --resume ID. */
  fresh?: boolean;
  resumeId?: string;
  reason?: string;
  /**
   * Instant paste like typing `opencode` in the pane — skip composer verify +
   * FRESH SUMMON wait loops. Default true for `spawn`, false for `switch`.
   */
  fast?: boolean;
}

export function runSwitch(
  loaded: LoadedProfile,
  registry: ProviderRegistry | null,
  target: string,
  newTypeRaw: string,
  opts: SwitchOptions = {},
): void {
  const session = loaded.sessionName;
  void session;
  const newType = normalizeType(newTypeRaw);
  const known = knownHarnessKinds(loaded);
  if (!known.has(newType)) {
    const sample = [...known].sort().slice(0, 12).join("|");
    throw new Error(`bad type: ${newTypeRaw} (known: ${sample}${known.size > 12 ? "|…" : ""})`);
  }
  if (!opts.fast && !registry) {
    throw new Error("switch: registry required unless --fast");
  }

  if (opts.fast) {
    runSwitchFast(loaded, target, newTypeRaw, {
      fresh: opts.fresh,
      resumeId: opts.resumeId,
      reason: opts.reason,
    });
    return;
  }

  if (target === "here" || target === "self") {
    const resolvedHere = resolvePaneTarget("here", loaded);
    if ("error" in resolvedHere) throw new Error(resolvedHere.error);
    const role = resolvedHere.row.role;
    const kind = seatKindFromId(role, loaded.profile.layout?.base.kinds);
    if (kind === "manager") {
      target = role || "manager";
    } else if (kind === "secretary") {
      target = role || "secretary";
    } else if (resolvedHere.row.slot) {
      target = `slot-${resolvedHere.row.slot}`;
    } else if (resolvedHere.row.mini) {
      target = `mini-${resolvedHere.row.mini}`;
    } else if (role) {
      target = role;
    } else {
      throw new Error(
        `switch here: unsupported role ${role || "?"} — pass secretary|manager|slot-N|mini-N`,
      );
    }
  }

  if (target === "manager" && newType === "empty") {
    throw new Error("refused: do not leave manager empty");
  }

  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const { paneId, row } = resolved;
  const savedBefore = seatAgentEntry(loaded, target);
  const kindsMap = kindsForLoaded(loaded);

  // Fast path: one tmux current-command read — no capture-pane, no registry detect.
  let oldType: string;
  let oldDet: { resumeId?: string | null } | null = null;
  let snapBefore: ReturnType<typeof capturePaneSnapshot> = null;
  if (opts.fast) {
    oldType = cheapLiveType(paneId, savedBefore?.type);
  } else {
    snapBefore = capturePaneSnapshot(paneId);
    const oldProv = snapBefore ? registry!.detect(snapBefore) : null;
    oldType = resolveOpenCodeHarnessType({
      detectId: oldProv?.id ?? "empty",
      savedType: savedBefore?.type,
      resumeCmd: savedBefore?.resume_cmd,
      snap: snapBefore,
      kinds: kindsMap,
    });
    oldDet = oldProv && snapBefore ? oldProv.detect(snapBefore) : null;
  }
  const fresh = opts.fresh ?? true;

  let keepRid: string | null = null;
  if (opts.resumeId) {
    keepRid = opts.resumeId;
  } else if (
    !fresh &&
    newType !== "empty" &&
    (oldType === "empty" ||
      liveHarnessSatisfiesWanted(oldType, newType, snapBefore, {
        savedType: savedBefore?.type,
        resumeCmd: savedBefore?.resume_cmd,
        kinds: kindsMap,
      }))
  ) {
    keepRid =
      oldDet?.resumeId ??
      savedBefore?.resume_id ??
      snapBefore?.options?.mesh_oc_session ??
      null;
  }

  const slot = row.slot || (row.role === "manager" ? "manager" : "?");
  const ports =
    row.ports ||
    (row.slot && /^\d+$/.test(row.slot)
      ? portsForSlot(loaded.profile.ports.worker, Number(row.slot))
      : row.role === "manager"
        ? "manager"
        : "-");

  console.log(`switch ${target} slot=${slot} ports=${ports}  ${oldType} -> ${newType}${opts.fast ? " [fast]" : ""}`);
  if (opts.reason) console.log(`reason: ${opts.reason}`);
  console.log(`resume: ${keepRid ?? "(none - fresh)"}`);

  if (
    opts.fast &&
    newType !== "empty" &&
    (oldType === newType ||
      liveHarnessSatisfiesWanted(oldType, newType, null, {
        savedType: savedBefore?.type,
        resumeCmd: savedBefore?.resume_cmd,
        kinds: kindsMap,
      }))
  ) {
    console.log(`already live ${oldType} on ${paneId} — skip`);
    return;
  }

  selectPaneUnfocused(["-e", "-t", paneId]);

  withPaneInputEnabled(paneId, () => {
    if (opts.fast) {
      if (oldType === "empty") return;
      // One interrupt — never stopOpenCodeCli poll loops on --fast.
      tmux(["send-keys", "-t", paneId, "C-c"]);
      sleepMs(50);
      return;
    }
    if (isOpenCodeHarnessType(oldType)) {
      stopOpenCodeCli(paneId, capturePaneSnapshot);
      return;
    }
    if (oldType === "kiro") {
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(300);
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(300);
    }
    tmux(["send-keys", "-t", paneId, "C-c"]);
    sleepMs(350);
    tmux(["send-keys", "-t", paneId, "C-c"]);
    sleepMs(250);
  });

  if (newType === "empty") {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_status", `empty${opts.reason ? ` · ${opts.reason}` : ""}`]);
    withPaneInputEnabled(paneId, () => {
      tmux(["send-keys", "-t", paneId, "clear", "Enter"]);
    });
    console.log(`cleared CLI -> plain terminal on ${paneId}`);
    if (!opts.fast && registry) persistAfterSwitch(loaded, registry);
    return;
  }

  const isSecretaryPane =
    row.role === "secretary" ||
    isSecretaryKind(row.role, loaded.profile.layout?.base.kinds);
  const cmd = resolveSeatLaunchCmd(loaded, row, paneId, newType, keepRid, fresh, oldType);
  if (!cmd) throw new Error(`no launch command for type ${newType}`);
  const paste = () => pasteHarnessLaunchCmd(loaded, paneId, newType, cmd);
  paste();
  if (newType === "kiro" && !opts.fast) {
    const ok = acceptKiroTrustDialog(paneId);
    if (!ok) console.error("WARN: kiro trust dialog not seen — pane may still be starting");
    sleepMs(800);
  }

  const targetLabel =
    row.role === "manager-mini" && row.mini
      ? `mini-${row.mini}`
      : row.role === "worker" && row.slot
        ? `slot-${row.slot}`
        : row.role === "manager"
          ? "manager"
          : isSecretaryPane
            ? row.role || "secretary"
            : row.role && row.role !== "worker"
              ? row.role
              : row.slot
                ? `slot-${row.slot}`
                : target;

  if (opts.fast) {
    // Instant like typing `opencode` — no verify, no summon wait, no scrape-save.
    invalidatePaneContext(loaded, paneId, targetLabel);
    tmux([
      "set-option",
      "-p",
      "-t",
      paneId,
      "@mesh_status",
      `${newType}${opts.reason ? ` · ${opts.reason}` : ""}`,
    ]);
    console.log(`launched[fast]: ${cmd}`);
    return;
  }

  const verified = verifyHarnessAfterPaste(loaded, registry!, paneId, newType, cmd, paste);
  if (!verified.ok) {
    if (isOpenCodeLaunch(newType, cmd) || newType === "agent" || newType === "claude") {
      throw new Error(`switch ${target}: ${verified.reason}`);
    }
    console.error(`WARN: switch ${target}: ${verified.reason}`);
  }

  invalidatePaneContext(loaded, paneId, targetLabel);
  const brief = injectAfterLaunch(loaded, registry!, targetLabel, paneId);
  if (!brief.ok) {
    console.error(`WARN: fresh-summon whoami prompt ${targetLabel}: ${brief.detail}`);
    try {
      const enq = enqueueColdStart(loaded, targetLabel, { force: true });
      if (!enq.skipped) {
        console.log("OK: cold-start queued for inbox FRESH SUMMON / whoami when idle");
      } else {
        console.log("OK: cold-start already queued for this hub (inbox will inject when idle)");
      }
    } catch (e) {
      console.error(`WARN: cold-start enqueue failed: ${(e as Error).message}`);
    }
  } else {
    console.log(`OK: fresh-summon whoami prompt ${targetLabel} ${brief.detail}`);
  }

  if (row.role && row.role !== "worker" && row.role !== "manager-mini") {
    selectPaneUnfocused(["-t", paneId, "-T", row.role]);
  }
  tmux([
    "set-option",
    "-p",
    "-t",
    paneId,
    "@mesh_status",
    `${newType}${opts.reason ? ` · ${opts.reason}` : ""}`,
  ]);
  console.log(`launched: ${cmd}`);
  if (registry) persistAfterSwitch(loaded, registry);
}

function persistAfterSwitch(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  opts: { quiet?: boolean } = {},
): void {
  try {
    const file = saveMeshSession(loaded, registry);
    if (!opts.quiet) console.log(`saved mesh-agents.json after switch (${file})`);
  } catch (e) {
    console.error(`WARN: post-switch save failed: ${(e as Error).message}`);
  }
}
