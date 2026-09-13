import { spawnSync } from "node:child_process";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { portsForSlot } from "@seat-mesh/core";
import { buildLaunchCmd } from "./agents-state.js";
import { withPaneInputEnabled } from "../inject/inject.js";
import { pasteLaunchCmd } from "./launch.js";
import { isOpenCodeLaunch, verifyOpenCodeAfterPaste } from "./launch-verify.js";
import { injectAfterLaunch } from "../seats/cold-start-inject.js";
import { invalidatePaneContext } from "../seats/cold-start-state.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { selectPaneUnfocused } from "../lib/select-pane.js";
import { tmux } from "../lib/tmux-run.js";
import { isSecretaryKind, seatKindFromId } from "@seat-mesh/core";
import { resolveSecretaryLaunchCmd } from "../roles/secretary.js";
import { enqueueColdStart } from "../seats/cold-start-inject.js";
import { saveMeshSession } from "../session/save-session.js";

const CLI_TYPES = new Set(["agent", "kiro", "claude", "opencode", "empty"]);

function normalizeType(t: string): string {
  const x = t.trim().toLowerCase();
  if (x === "cursor-agent" || x === "cursor") return "agent";
  if (x === "oc") return "opencode";
  if (x === "cc") return "claude";
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
  /** Default true — switch always starts clean unless --keep-resume or --resume ID. */
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
  const snapBefore = capturePaneSnapshot(paneId);
  const oldProv = snapBefore ? registry.detect(snapBefore) : null;
  const oldType = oldProv ? providerIdToHarnessType(oldProv.id) : "empty";
  const oldDet = oldProv && snapBefore ? oldProv.detect(snapBefore) : null;
  const fresh = opts.fresh ?? true;

  let keepRid: string | null = null;
  if (opts.resumeId) {
    keepRid = opts.resumeId;
  } else if (!fresh && newType !== "empty" && (newType === oldType || oldType === "empty")) {
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

  selectPaneUnfocused(["-e", "-t", paneId]);

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

  const isSecretaryPane =
    row.role === "secretary" ||
    isSecretaryKind(row.role, loaded.profile.layout?.base.kinds);
  const typeChanged = oldType !== newType && oldType !== "empty";
  const cmd = isSecretaryPane
    ? resolveSecretaryLaunchCmd(loaded, newType, paneId, fresh || typeChanged || !keepRid)
    : buildLaunchCmd(newType, loaded.workspace, keepRid);
  if (!cmd) throw new Error(`no launch command for type ${newType}`);
  pasteLaunchCmd(paneId, cmd);
  if (isOpenCodeLaunch(newType, cmd)) {
    const verified = verifyOpenCodeAfterPaste(loaded, registry, paneId, () =>
      pasteLaunchCmd(paneId, cmd),
    );
    if (!verified.ok) {
      throw new Error(`switch ${target}: ${verified.reason}`);
    }
  } else if (newType === "agent") {
    sleepMs(2800);
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
          : isSecretaryPane
            ? row.role || "secretary"
            : row.role && row.role !== "worker"
              ? row.role
              : row.slot
                ? `slot-${row.slot}`
                : target === "self" || target === "here"
                  ? "here"
                  : target;

  invalidatePaneContext(loaded, paneId, targetLabel);
  const brief = injectAfterLaunch(loaded, registry, targetLabel, paneId);
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
