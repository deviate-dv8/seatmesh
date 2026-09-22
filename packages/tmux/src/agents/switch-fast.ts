/**
 * Instant paste path — typing `opencode` in the pane.
 * Minimal deps — no providers, no launch-verify, no cold-start inject.
 * Leaf imports only (never @seat-mesh/core barrel).
 */
import { spawnSync } from "node:child_process";
import type { LoadedProfile } from "@seat-mesh/core/profile";
import { seatKindFromId } from "@seat-mesh/core/seat-kind";
import { assertPaneInLiveSession, resolvePaneTarget } from "../lib/resolve-pane.js";
import { resolveLiveTmuxSession } from "../lib/live-session.js";
import { tmux } from "../lib/tmux-run.js";
import { ensureMeshAgentsRecord, patchMeshAgentsForPane, persistPatched } from "./set-tag.js";

const LAUNCH_PREFIX = "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor";

/** Local — avoid runners.js → kinds.js → zod. */
function normalizeAgentKind(raw: string): string {
  const x = raw.trim().toLowerCase().replace(/_/g, "-");
  if (x === "cursor-agent" || x === "cursor") return "agent";
  if (x === "cc") return "claude";
  if (x === "oc" || x === "opencode-main") return "opencode";
  if (x === "ocproxy" || x === "oc-proxy") return "opencode-cpe";
  return x;
}

function portsForSlot(formula: string, slot: number): string {
  return formula.replace(/\{n\}/g, String(slot));
}

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

/** Fast inject: unlock if needed, no focus restore dance (saves ~100ms/call). */
function withFastInject(paneId: string, fn: () => void): void {
  const wasOff =
    tmux(["display-message", "-t", paneId, "-p", "#{pane_input_off}"]).out === "1";
  if (wasOff) tmux(["select-pane", "-e", "-t", paneId]);
  try {
    fn();
  } finally {
    if (wasOff) tmux(["select-pane", "-d", "-t", paneId]);
  }
}

function paneCurrentCommand(paneId: string): string {
  return tmux(["display-message", "-t", paneId, "-p", "#{pane_current_command}"]).out.trim();
}

function isPlainShellCmd(cmd: string): boolean {
  return /^(zsh|bash|sh|fish|dash)$/i.test(cmd);
}

function cheapLiveType(paneId: string): string {
  const cmd = paneCurrentCommand(paneId);
  if (isPlainShellCmd(cmd) || !cmd) return "empty";
  if (/opencode-cpe|opencode/i.test(cmd)) return /cpe/i.test(cmd) ? "opencode-cpe" : "opencode";
  if (/^(agent|cursor-agent)$/i.test(cmd) || /cursor-agent/i.test(cmd)) return "agent";
  if (/^claude$/i.test(cmd)) return "claude";
  if (/kiro/i.test(cmd)) return "kiro";
  return "empty";
}

/** Built-in launch one-liners — no kinds JSON / providers resolve. */
export function fastLaunchCmd(
  type: string,
  workspace: string,
  resumeId?: string | null,
): string | null {
  const t = normalizeAgentKind(type);
  const q = (s: string) => (/^[a-zA-Z0-9_./=-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\"'\"'")}'`);
  const cd = `cd ${q(workspace)} &&`;
  switch (t) {
    case "opencode":
      return resumeId
        ? `${cd} ${LAUNCH_PREFIX} opencode --session ${q(resumeId)}`
        : `${cd} ${LAUNCH_PREFIX} opencode --auto`;
    case "opencode-cpe": {
      const sh = `${workspace}/scripts/opencode-cpe.sh`;
      return resumeId
        ? `${cd} ${LAUNCH_PREFIX} ${q(sh)} --session ${q(resumeId)}`
        : `${cd} ${LAUNCH_PREFIX} ${q(sh)} --auto`;
    }
    case "agent":
    case "cursor-agent":
      return resumeId
        ? `${cd} agent --resume ${q(resumeId)}`
        : `${cd} agent`;
    case "claude":
      return resumeId
        ? `${cd} claude --resume ${q(resumeId)}`
        : `${cd} claude`;
    case "kiro":
      return resumeId
        ? `${cd} kiro-cli chat --resume-id ${q(resumeId)} --trust-all-tools`
        : `${cd} kiro-cli chat --trust-all-tools`;
    case "empty":
      return null;
    default:
      throw new Error(`fast spawn: unknown type ${type} (use full switch --slow for custom kinds)`);
  }
}

function pasteLaunchLine(paneId: string, cmd: string): void {
  withFastInject(paneId, () => {
    const loaded = spawnSync("tmux", ["load-buffer", "-b", "sm-fast-launch", "-"], {
      input: `${cmd}\n`,
      encoding: "utf8",
    });
    if (loaded.status === 0) {
      tmux(["paste-buffer", "-b", "sm-fast-launch", "-t", paneId, "-d"]);
    } else {
      tmux(["send-keys", "-t", paneId, "-l", cmd]);
      tmux(["send-keys", "-t", paneId, "Enter"]);
    }
  });
}

export interface SwitchFastOptions {
  fresh?: boolean;
  resumeId?: string;
  reason?: string;
  /** Persist type=empty into mesh-agents after kill-to-shell. */
  persistEmpty?: boolean;
}

/** Paste CLI into pane immediately. Prefer `spawn` / `switch --fast`. */
export function runSwitchFast(
  loaded: LoadedProfile,
  target: string,
  newTypeRaw: string,
  opts: SwitchFastOptions = {},
): void {
  const newType = normalizeAgentKind(newTypeRaw);
  if (target === "here" || target === "self") {
    const resolvedHere = resolvePaneTarget("here", loaded);
    if ("error" in resolvedHere) throw new Error(resolvedHere.error);
    const role = resolvedHere.row.role;
    const kind = seatKindFromId(role, loaded.profile.layout?.base.kinds);
    if (kind === "manager") target = role || "manager";
    else if (kind === "secretary") target = role || "secretary";
    else if (resolvedHere.row.slot) target = `slot-${resolvedHere.row.slot}`;
    else if (resolvedHere.row.mini) target = `mini-${resolvedHere.row.mini}`;
    else if (role) target = role;
    else throw new Error(`switch here: unsupported role ${role || "?"}`);
  }

  if (target === "manager" && newType === "empty") {
    throw new Error("refused: do not leave manager empty");
  }

  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);
  const { paneId, row } = resolved;
  assertPaneInLiveSession(row, loaded);
  const live = resolveLiveTmuxSession(loaded);
  const paneSession = tmux(["display-message", "-t", paneId, "-p", "#{session_name}"]).out.trim();
  if (paneSession && paneSession !== live) {
    throw new Error(
      `refused: pane ${paneId} live session is '${paneSession}', expected '${live}'`,
    );
  }
  const oldType = cheapLiveType(paneId);
  const fresh = opts.fresh ?? true;
  const keepRid = opts.resumeId ?? (!fresh ? null : null);

  const slot = row.slot || (row.role === "manager" ? "manager" : "?");
  const ports =
    row.ports ||
    (row.slot && /^\d+$/.test(row.slot)
      ? portsForSlot(loaded.profile.ports.worker, Number(row.slot))
      : row.role === "manager"
        ? "manager"
        : "-");

  console.log(`switch ${target} slot=${slot} ports=${ports}  ${oldType} -> ${newType} [fast]`);
  if (opts.reason) console.log(`reason: ${opts.reason}`);
  console.log(`resume: ${keepRid ?? "(none - fresh)"}`);

  if (newType !== "empty" && oldType === newType) {
    console.log(`already live ${oldType} on ${paneId} — skip`);
    return;
  }

  if (newType === "empty") {
    if (oldType !== "empty") {
      tmux(["respawn-pane", "-k", "-c", loaded.workspace, "-t", paneId]);
    }
    tmux([
      "set-option",
      "-p",
      "-t",
      paneId,
      "@mesh_status",
      `empty${opts.reason ? ` · ${opts.reason}` : ""}`,
    ]);
    if (opts.persistEmpty) {
      try {
        const mesh = ensureMeshAgentsRecord(loaded);
        const next = patchMeshAgentsForPane(mesh, row, loaded, {
          type: "empty",
          resumeId: null,
        });
        const file = persistPatched(loaded, next);
        console.log(`cleared CLI -> plain terminal on ${paneId} (saved ${file})`);
      } catch (e) {
        console.log(`cleared CLI -> plain terminal on ${paneId}`);
        console.error(`WARN: persist empty failed: ${(e as Error).message}`);
      }
    } else {
      console.log(`cleared CLI -> plain terminal on ${paneId}`);
    }
    return;
  }

  // Replace live CLI via respawn (C-c often ignored by agent/claude).
  if (oldType !== "empty") {
    tmux(["respawn-pane", "-k", "-c", loaded.workspace, "-t", paneId]);
    sleepMs(25);
  }

  const cmd = fastLaunchCmd(newType, loaded.workspace, keepRid);
  if (!cmd) throw new Error(`no launch command for type ${newType}`);
  pasteLaunchLine(paneId, cmd);

  tmux([
    "set-option",
    "-p",
    "-t",
    paneId,
    "@mesh_status",
    `${newType}${opts.reason ? ` · ${opts.reason}` : ""}`,
  ]);
  console.log(`launched[fast]: ${cmd}`);
}
