import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isSuperviseContractOn,
  managerColumnIds,
  superviseLeadIds,
  meshRuntimePaths,
  runtimePathHint,
  secretaryColumnIds,
  secretaryDigestPrompt,
  secretarySuperviseBrief,
  SUPERVISE_CHECKBACK,
  superviseLockPath,
  type LoadedProfile,
  type ProviderRegistry,
} from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { launchSession } from "../agents/launch.js";
import { runSwitch } from "../agents/switch.js";
import { defaultHarnessTypeForSeat } from "../agents/agent-launch.js";
import { enqueuePeer, ensureMeshInbox, inboxHealth, meshInboxPort } from "../comms/inbox-bridge.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { resolveLiveTmuxSession } from "../lib/live-session.js";
import type { MiniCampaignDigest } from "./minis.js";
import { submitPaneOp } from "../ops/pane-ops-client.js";
import { buildMiniCampaignDigest, miniPrompt, miniSpawnAll } from "./minis.js";
import { injectPromptDirect, enqueuePrompt } from "../inject/prompt.js";
import { selectPaneUnfocused, withActivePanePreserved } from "../lib/select-pane.js";
import { tmux } from "../lib/tmux-run.js";
import { runSuperviseTick } from "../supervise/supervise-tick.js";

const MESH_WATCH_ID = "mesh-watch-secretary";
const MANAGER_NUDGE_ID = "mesh-manager-nudge";
const SECRETARY_SUPERVISE_ID = "mesh-secretary-supervise";

function superviseMarkerPath(loaded: LoadedProfile): string {
  try {
    return superviseLockPath(loaded);
  } catch {
    return path.join(loaded.workspace, ".sm/contracts/locks/supervise/secretary.on");
  }
}

function inboxPort(loaded: LoadedProfile): number {
  return meshInboxPort(loaded);
}

function inboxBase(loaded: LoadedProfile): string {
  return `http://127.0.0.1:${inboxPort(loaded)}`;
}

function parseDurationSeconds(raw: string): number {
  const m = raw.match(/^(\d+)(s|m|h)?$/i);
  if (!m) return 300;
  const n = Number(m[1]);
  const u = (m[2] || "s").toLowerCase();
  if (u === "m") return n * 60;
  if (u === "h") return n * 3600;
  return n;
}

function curlJson(
  method: string,
  url: string,
  body?: unknown,
): Record<string, unknown> | null {
  const args = ["-sS", "-m", "5", "-X", method, url];
  if (body !== undefined) {
    args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  }
  const r = spawnSync("curl", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "{}") as Record<string, unknown>;
  } catch {
    return { raw: r.stdout };
  }
}

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  spawnSync("sleep", [String(ms / 1000)]);
}

function stampSecretaryMeta(paneId: string): void {
  const pairs: Record<string, string> = {
    mesh_role: "secretary",
    mesh_mini: "",
    mesh_slot: "secretary",
    mesh_ports: "secretary",
    mesh_title: "secretary",
    mesh_lead: "",
  };
  for (const [k, v] of Object.entries(pairs)) {
    tmux(["set-option", "-p", "-t", paneId, `@${k}`, v]);
  }
  selectPaneUnfocused(["-t", paneId, "-T", "secretary"]);
}

/** @deprecated use runSwitch(loaded, reg, "secretary", type, { fresh }) */
export function secretaryRestart(
  loaded: LoadedProfile,
  registry?: ProviderRegistry,
  typArg?: string,
  fresh = false,
): void {
  const reg = registry ?? createRegistryForProfile(loaded.profile);
  let typ = typArg ?? defaultHarnessTypeForSeat(loaded, "secretary");
  if (typ === "cursor-agent") typ = "agent";
  if (typ === "empty") {
    throw new Error("refused: secretary restart empty - use secretary stop");
  }
  runSwitch(loaded, reg, "secretary", typ, {
    fresh,
    reason: fresh ? "restart-fresh" : "restart",
  });
}

export function secretaryLaunch(loaded: LoadedProfile): void {
  submitPaneOp(
    loaded,
    "launch",
    { targets: ["secretary"] },
    "secretary start",
    () => launchSession(loaded, { targets: ["secretary"] }),
  );
}

export function secretaryMeshWatch(
  loaded: LoadedProfile,
  sub: "on" | "off" | "status",
  interval = "10m",
): void {
  ensureMeshInbox(loaded, { quiet: true });
  const health = inboxHealth(inboxPort(loaded));
  if (!health) {
    throw new Error("inbox DOWN — run: seatmesh --profile .sm reload (or inbox restart)");
  }

  const base = inboxBase(loaded);
  if (sub === "off") {
    curlJson("POST", `${base}/patience/${encodeURIComponent(MESH_WATCH_ID)}/cancel`);
    console.log("OK: secretary mesh-watch OFF");
    return;
  }

  if (sub === "status") {
    console.log(`mesh-watch: ${secretaryMeshWatchStatusQuiet(loaded)}`);
    return;
  }

  const resolved = resolvePaneTarget("secretary", loaded);
  if ("error" in resolved) {
    throw new Error(`${resolved.error} — run: seatmesh --profile .sm agent secretary start`);
  }

  const secs = parseDurationSeconds(interval);
  const expires = new Date(Date.now() + secs * 1000).toISOString();
  curlJson("POST", `${base}/patience/${encodeURIComponent(MESH_WATCH_ID)}/cancel`);
  const body = {
    id: MESH_WATCH_ID,
    kind: "mesh-watch",
    renewSec: secs,
    expect: SUPERVISE_CHECKBACK.meshWatchExpect,
    ownerPane: resolved.paneId,
    expiresAt: expires,
    senderLabel: "inbox",
    recipientLabel: "secretary",
  };
  const created = curlJson("POST", `${base}/patience`, body);
  console.log(`OK: secretary mesh-watch ON renew=${interval} pane=${resolved.paneId}`);
  if (created) console.log(JSON.stringify(created, null, 2));
}

/** Arm via daemon HTTP — never write CHECKBACK.jsonl directly (sqlite split-brain). */
function armPatience(
  loaded: LoadedProfile,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  ensureMeshInbox(loaded);
  const created = curlJson("POST", `${inboxBase(loaded)}/patience`, {
    ...body,
    workspaceId: body.workspaceId ?? loaded.workspaceId,
    sessionName: body.sessionName ?? resolveLiveTmuxSession(loaded),
    ownerLabel: body.ownerLabel ?? body.recipientLabel,
  });
  if (!created || created.ok === false) {
    throw new Error(
      `patience arm failed for ${String(body.id ?? "?")} — is mesh-inbox up? (${inboxPort(loaded)})`,
    );
  }
  return created;
}

function cancelPatience(loaded: LoadedProfile, id: string): void {
  ensureMeshInbox(loaded);
  curlJson("POST", `${inboxBase(loaded)}/patience/${encodeURIComponent(id)}/cancel`);
}

/** Operator-assigned: secretary + daemon keep manager moving without operator "continue". */
export function secretarySupervise(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  sub: "on" | "off" | "status" | "run",
  interval = "10m",
  runOpts?: { dryRun?: boolean; postStatus?: boolean },
): void {
  const workspace = loaded.workspace;
  const session = loaded.sessionName;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  if (sub === "run") {
    const tick = runSuperviseTick(loaded, {
      session,
      baseWindow: layout.base.window,
      registry,
      dryRun: runOpts?.dryRun,
      postStatus: runOpts?.postStatus,
    });
    console.log(`STATUS: ${tick.statusLine}`);
    for (const lead of tick.leads) {
      const delta =
        lead.prior === null ? "new" : lead.prior === lead.now ? "same" : `${lead.prior} -> ${lead.now}`;
      console.log(`  ${lead.id}: mark=${lead.mark} open=${lead.open} (${delta})`);
    }
    if (tick.materialChange) console.log("diff: material change detected");
    else if (tick.priorText.trim()) console.log("diff: unchanged since last tick");
    if (tick.wroteLedger) console.log(`OK: SUPERVISE-LAST written -> ${tick.lastPath}`);
    if (tick.roomStatusPosted) console.log("OK: room STATUS posted (managers, kind=status)");
    else if (!tick.wroteLedger) console.log("dry-run: no SUPERVISE-LAST write, no room post");
    return;
  }

  const mgrIds = superviseLeadIds(loaded);
  const secIds = secretaryColumnIds(layout);
  const secResolved = resolvePaneTarget(secIds[0] ?? "secretary", loaded);
  const mgrResolved = resolvePaneTarget(mgrIds[0] ?? "manager", loaded);
  const extraMgrs = mgrIds.slice(1).map((id) => ({ id, resolved: resolvePaneTarget(id, loaded) }));
  if ("error" in secResolved) {
    throw new Error(`${secResolved.error} — run: seatmesh --profile .sm agent secretary restart`);
  }
  if ("error" in mgrResolved) {
    throw new Error(`${mgrResolved.error} — manager pane missing`);
  }
  for (const extra of extraMgrs) {
    if ("error" in extra.resolved) {
      throw new Error(`${extra.resolved.error} — ${extra.id} pane missing`);
    }
  }
  const extraPanes = extraMgrs.map((e) => ({
    id: e.id,
    paneId: (e.resolved as { paneId: string }).paneId,
  }));

  const marker = superviseMarkerPath(loaded);

  if (sub === "off") {
    cancelPatience(loaded, MANAGER_NUDGE_ID);
    for (const extra of extraPanes) {
      cancelPatience(loaded, `mesh-${extra.id}-nudge`);
    }
    cancelPatience(loaded, SECRETARY_SUPERVISE_ID);
    cancelPatience(loaded, MESH_WATCH_ID);
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
    console.log(
      `OK: secretary supervise OFF (manager + ${extraPanes.map((e) => e.id).join("+") || "no-extra"} nudge + supervise loop cancelled)`,
    );
    return;
  }

  if (sub === "status") {
    const on = fs.existsSync(marker);
    console.log(`supervise: ${on ? "ON" : "OFF"}`);
    if (on) {
      try {
        const meta = JSON.parse(fs.readFileSync(marker, "utf8")) as {
          since?: string;
          interval?: string;
          managerPane?: string;
          extraManagerPanes?: Array<{ id: string; paneId: string }>;
          secretaryPane?: string;
        };
        if (meta.since) console.log(`  since: ${meta.since}`);
        if (meta.interval) console.log(`  interval: ${meta.interval}`);
        if (meta.managerPane) console.log(`  manager: ${meta.managerPane}`);
        for (const extra of meta.extraManagerPanes ?? []) {
          console.log(`  ${extra.id}: ${extra.paneId}`);
        }
        if (meta.secretaryPane) console.log(`  secretary: ${meta.secretaryPane}`);
      } catch {
        /* ignore */
      }
    }
    secretaryStatus(loaded);
    return;
  }

  const secs = parseDurationSeconds(interval);
  const expires = new Date(Date.now() + secs * 1000).toISOString();

  cancelPatience(loaded, MANAGER_NUDGE_ID);
  for (const extra of extraPanes) {
    cancelPatience(loaded, `mesh-${extra.id}-nudge`);
  }
  cancelPatience(loaded, SECRETARY_SUPERVISE_ID);

  // Primary manager is the hub — no daemon CONTINUE nudge (was spamming the pane).
  for (const extra of extraPanes) {
    armPatience(loaded, {
      id: `mesh-${extra.id}-nudge`,
      kind: "coord-nudge",
      renewSec: secs,
      expect: `${extra.id} idle — complete open TASKS.md checkboxes`,
      ownerPane: extra.paneId,
      expiresAt: expires,
      senderLabel: "secretary",
      recipientLabel: extra.id,
    });
  }
  const secBody = {
    id: SECRETARY_SUPERVISE_ID,
    kind: "secretary-supervise",
    renewSec: secs,
    expect: SUPERVISE_CHECKBACK.secretarySuperviseExpect,
    ownerPane: secResolved.paneId,
    expiresAt: expires,
    senderLabel: "daemon",
    recipientLabel: secIds[0] ?? "secretary",
  };

  armPatience(loaded, secBody);
  cancelPatience(loaded, MESH_WATCH_ID);

  let skipBrief = false;
  if (fs.existsSync(marker)) {
    try {
      const prev = JSON.parse(fs.readFileSync(marker, "utf8")) as { interval?: string };
      skipBrief = prev.interval === interval;
    } catch {
      skipBrief = false;
    }
  }

  if (!skipBrief) {
    const brief = secretarySuperviseBrief({
      managerPane: mgrResolved.paneId,
      extraPanes,
      interval,
    });

    try {
      const sent = enqueuePrompt(loaded, "secretary", brief, {
        prefix: "",
      });
      console.log(`OK: secretary supervise brief token=${sent.token ?? "-"} via=${sent.via ?? "?"}`);
    } catch (e) {
      const enq = enqueuePeer(loaded, {
        kind: "prompt",
        msg: brief,
        targetPane: secResolved.paneId,
        targetLabel: "secretary",
        fromSlot: "manager",
      });
      if (!enq?.ok) {
        console.error(
          `WARN: secretary brief failed (${(e as Error).message}) — nudges still armed; daemon tick posts to secretary only`,
        );
      }
    }
  } else {
    console.log("OK: supervise re-arm only (same interval) — skipped duplicate brief inject");
  }

  fs.writeFileSync(
    marker,
    JSON.stringify(
      {
        since: new Date().toISOString(),
        interval,
        managerPane: mgrResolved.paneId,
        extraManagerPanes: extraPanes,
        secretaryPane: secResolved.paneId,
      },
      null,
      2,
    ) + "\n",
  );

  const extraLabel = extraPanes.map((e) => `${e.id}=${e.paneId}`).join(" ") || "none";
  console.log(
    `OK: secretary supervise ON interval=${interval} manager=${mgrResolved.paneId} extras=${extraLabel} secretary=${secResolved.paneId}`,
  );
  console.log(`  supervisees: ${mgrIds.join(" + ")} (not workers, not minis)`);
  console.log("  mesh-watch: OFF (stale mini DIGEST does not run)");
  console.log("  extra-manager nudge only (no daemon nudge to primary manager)");
  console.log("  secretary-supervise: poll lead TASKS each tick");
  console.log("  off: seatmesh secretary supervise off");
}

export function secretaryStatus(loaded: LoadedProfile): void {
  const resolved = resolvePaneTarget("secretary", loaded);
  if ("error" in resolved) {
    console.log("secretary: NOT RUNNING");
    console.log(`  ${resolved.error}`);
    console.log("  fix: seatmesh --profile .sm agent secretary start");
    return;
  }
  console.log(`secretary: pane=${resolved.paneId}`);
  const superviseOn =
    isSuperviseContractOn(loaded) || fs.existsSync(superviseMarkerPath(loaded));
  console.log(`  supervise: ${superviseOn ? "ON" : "OFF"}`);
  const watch = secretaryMeshWatchStatusQuiet(loaded);
  console.log(`  mesh-watch: ${watch}`);
  const health = inboxHealth(inboxPort(loaded));
  console.log(`  inbox: ${health ? "up" : "DOWN"}`);
}

/** Mechanical digest from minis.json + MINI-DONE — not OC prose. */
export function secretaryCollect(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  opts: { sendManager?: boolean; nudgeOpen?: boolean } = {},
): MiniCampaignDigest {
  const digest = buildMiniCampaignDigest(loaded);
  console.log(digest.text);

  if (opts.sendManager) {
    const digestMsg = secretaryDigestPrompt(digest.text);
    for (const role of managerColumnIds(loaded.profile.layout)) {
      try {
        injectPromptDirect(loaded, registry, role, digestMsg, {
          manager: true,
          confirmSent: false,
        });
      } catch (e) {
        console.error(`digest to ${role} failed: ${(e as Error).message}`);
      }
    }
  }

  if (opts.nudgeOpen && digest.openIds.length) {
    for (const id of digest.openIds) {
      try {
        miniPrompt(
          loaded,
          registry,
          id,
          `STALE: still open. File seatmesh --profile .sm agent mini done ${id} PASS|FAIL: <evidence> when finished — supervisor will not accept chat-only done.`,
        );
      } catch (e) {
        console.error(`nudge mini-${id} failed: ${(e as Error).message}`);
      }
    }
  }

  return digest;
}

/** Secretary dispatches all minis from mini-manifest.json under data.root. */
export function secretaryDispatch(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
): void {
  submitPaneOp(
    loaded,
    "secretary-dispatch",
    { watchInterval: "5m" },
    "secretary dispatch (minis + mesh-watch)",
    () => {
      ensureMeshInbox(loaded, { quiet: true });
      miniSpawnAll(loaded, registry);
      secretaryMeshWatch(loaded, "on", "5m");
      console.log("OK: secretary dispatched minis + mesh-watch ON 5m");
      console.log(
        `  collect: ${runtimePathHint(loaded.workspace, meshRuntimePaths(loaded).miniDone)} + seatmesh --profile .sm agent mini list`,
      );
    },
  );
}

function secretaryMeshWatchStatusQuiet(loaded: LoadedProfile): string {
  const health = inboxHealth(inboxPort(loaded));
  if (!health) return "inbox DOWN";
  const r = spawnSync("curl", ["-sS", `${inboxBase(loaded)}/patience?all=1`], {
    encoding: "utf8",
  });
  if (r.status !== 0) return "?";
  try {
    const parsed = JSON.parse(r.stdout || "{}") as {
      entries?: Array<{ id?: string; status?: string }>;
    };
    const on = (parsed.entries ?? []).some(
      (e) => e.id === MESH_WATCH_ID && e.status === "active",
    );
    return on ? "ON" : "OFF";
  } catch {
    return "?";
  }
}
