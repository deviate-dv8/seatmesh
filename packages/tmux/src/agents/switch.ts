import { spawnSync } from "node:child_process";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { portsForSlot } from "@seat-mesh/core";
import { buildLaunchCmd } from "./agents-state.js";
import { withPaneInputEnabled } from "../inject/inject.js";
import { pasteLaunchCmd } from "./launch.js";
import { isOpenCodeLaunch, verifyOpenCodeAfterPaste } from "./launch-verify.js";
import { enqueueColdStart } from "../seats/cold-start-inject.js";
import { invalidatePaneContext } from "../seats/cold-start-state.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { tmux } from "../lib/tmux-run.js";
import { saveMeshSession } from "../session/save-session.js";

const CLI_TYPES = new Set(["agent", "kiro", "claude", "opencode", "empty"]);

function normalizeType(t: string): string {
  const x = t.trim().toLowerCase();
  if (x === "cursor-agent") return "agent";
  return x;
}

function providerIdToHarnessType(id: string): string {
  if (id === "cursor-agent") return "agent";
  return id;
}

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

export interface SwitchOptions {
  fresh?: boolean;
  resumeId?: string;
  reason?: string;
}

export function runSwitch(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  newTypeRaw: string,
  opts: SwitchOptions = {},
): void {
  const session = loaded.sessionName;
  const newType = normalizeType(newTypeRaw);
  if (!CLI_TYPES.has(newType)) {
    throw new Error(`bad type: ${newTypeRaw} (want agent|kiro|claude|opencode|empty)`);
  }

  if (target === "here") {
    const pane = process.env.TMUX_PANE;
    if (!pane) throw new Error("switch here: not in tmux");
    const role = tmux(["display-message", "-t", pane, "-p", "#{@mesh_role}"]).out;
    if (role !== "manager") {
      throw new Error("switch here: only on manager pane (or pass manager|slot)");
    }
    target = "manager";
  }

  if (target === "manager" && newType === "empty") {
    throw new Error("refused: do not leave manager empty");
  }

  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const { paneId, row } = resolved;
  const snapBefore = capturePaneSnapshot(paneId);
  const oldProv = snapBefore ? registry.detect(snapBefore) : null;
  const oldType = oldProv ? providerIdToHarnessType(oldProv.id) : "empty";
  const oldDet = oldProv && snapBefore ? oldProv.detect(snapBefore) : null;

  let keepRid: string | null = null;
  if (opts.resumeId) {
    keepRid = opts.resumeId;
  } else if (!opts.fresh && newType !== "empty" && (newType === oldType || oldType === "empty")) {
    keepRid = oldDet?.resumeId ?? null;
  }

  const slot = row.slot || (row.role === "manager" ? "manager" : "?");
  const ports =
    row.ports ||
    (row.slot && /^\d+$/.test(row.slot)
      ? portsForSlot(loaded.profile.ports.worker, Number(row.slot))
      : row.role === "manager"
        ? "manager"
        : "-");

  console.log(`switch ${target} slot=${slot} ports=${ports}  ${oldType} -> ${newType}`);
  if (opts.reason) console.log(`reason: ${opts.reason}`);
  console.log(`resume: ${keepRid ?? "(none - fresh)"}`);

  tmux(["select-pane", "-e", "-t", paneId]);

  withPaneInputEnabled(paneId, () => {
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
    persistAfterSwitch(loaded, registry);
    return;
  }

  const cmd = buildLaunchCmd(newType, loaded.workspace, keepRid);
  if (!cmd) throw new Error(`no launch command for type ${newType}`);
  pasteLaunchCmd(paneId, cmd);
  if (isOpenCodeLaunch(newType, cmd)) {
    const verified = verifyOpenCodeAfterPaste(loaded, registry, paneId, () =>
      pasteLaunchCmd(paneId, cmd),
    );
    if (!verified.ok) {
      throw new Error(`switch ${target}: ${verified.reason}`);
    }
  } else {
    sleepMs(1500);
  }

  const targetLabel =
    row.role === "manager-mini" && row.mini
      ? `mini-${row.mini}`
      : row.role === "worker" && row.slot
        ? `slot-${row.slot}`
        : row.role === "manager"
            ? "manager"
            : row.role === "secretary"
              ? "secretary"
              : target;

  invalidatePaneContext(loaded, paneId, targetLabel);
  try {
    const cs = enqueueColdStart(loaded, target, {
      force: true,
      mini: row.mini ?? undefined,
    });
    console.log(
      cs.skipped
        ? `cold-start skipped (fingerprint=${cs.fingerprint}) — inbox holds until hub changes`
        : `cold-start enqueued fingerprint=${cs.fingerprint} — inbox held until delivered`,
    );
  } catch (e) {
    console.error(`WARN: cold-start enqueue failed: ${(e as Error).message}`);
  }

  if (row.role === "manager") {
    tmux(["select-pane", "-t", paneId, "-T", "manager"]);
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
  persistAfterSwitch(loaded, registry);
}

function persistAfterSwitch(loaded: LoadedProfile, registry: ProviderRegistry): void {
  try {
    const file = saveMeshSession(loaded, registry);
    console.log(`saved mesh-agents.json after switch (${file})`);
  } catch (e) {
    console.error(`WARN: post-switch save failed: ${(e as Error).message}`);
  }
}
