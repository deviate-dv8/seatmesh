import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isSuperviseContractOn,
  managerColumnIds,
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
import {
  createRegistryForProfile,
  waitForCli,
  waitForComposerReady,
} from "@seat-mesh/providers";
import { guessSecretaryOpenCodeSession } from "@seat-mesh/providers";
import { buildAgentLaunchCmd } from "../agents/agent-builder.js";
import { loadLaunchState, loadMeshAgents, resolveLaunchCmd } from "../agents/agents-state.js";
import { saveMeshAgentsFile } from "../session/save-session.js";
import { enqueuePeer, ensureMeshInbox, inboxHealth, meshInboxPort } from "../comms/inbox-bridge.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import type { MiniCampaignDigest } from "./minis.js";
import { submitPaneOp } from "../ops/pane-ops-client.js";
import { buildMiniCampaignDigest, miniPrompt, miniSpawnAll } from "./minis.js";
import { injectPromptDirect, enqueuePrompt } from "../inject/prompt.js";
import { injectAfterLaunch } from "../seats/cold-start-inject.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { selectPaneUnfocused, withActivePanePreserved } from "../lib/select-pane.js";
import { tmux } from "../lib/tmux-run.js";
import { applyMeshBorderFormat } from "../session/borders.js";

const MESH_WATCH_ID = "mesh-watch-secretary";
const MANAGER_NUDGE_ID = "mesh-manager-nudge";
const MANAGER2_NUDGE_ID = "mesh-manager-2-nudge";
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

function ensureSecretaryBanners(loaded: LoadedProfile, paneId: string): void {
  const layout = loaded.profile.layout;
  if (!layout) return;
  const session = loaded.sessionName;
  applyMeshBorderFormat(session, layout.base.window);
  stampSecretaryMeta(paneId);
}

function clearSecretaryResumeOnDisk(loaded: LoadedProfile): void {
  const rel = loaded.profile.state.meshAgentsJson;
  const mesh = loadMeshAgents(loaded.workspace, rel);
  if (!mesh?.secretary) return;
  saveMeshAgentsFile(loaded.workspace, rel, {
    ...mesh,
    secretary: { ...mesh.secretary, resumeId: null, resumeCmd: null },
    updatedAt: new Date().toISOString(),
  });
}

function resolveSecretaryLaunchCmd(
  loaded: LoadedProfile,
  typ: string,
  paneId?: string,
  fresh = false,
): string | null {
  const state = loadLaunchState(
    loaded.workspace,
    loaded.profile.state.meshAgentsJson,
    loaded.profile.state.agentsJson,
  );
  const harnessType = typ === "cursor-agent" ? "agent" : typ;
  let resumeId: string | null = null;
  if (!fresh) {
    resumeId = state.secretary?.resume_id ?? null;
    if (!resumeId && paneId) {
      const stored = tmux(["display-message", "-t", paneId, "-p", "#{@mesh_oc_session}"]).out;
      if (stored) resumeId = stored;
    }
    if (!resumeId && harnessType === "opencode") {
      resumeId = guessSecretaryOpenCodeSession(loaded.workspace) ?? null;
    }
  } else if (paneId) {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", ""]);
  }
  const secEntry = {
    type: harnessType,
    resume_id: resumeId,
    resume_cmd: fresh ? null : (state.secretary?.resume_cmd ?? null),
  };
  const cmd =
    resolveLaunchCmd(secEntry, loaded.workspace) ??
    buildAgentLaunchCmd(harnessType, loaded.workspace, resumeId);
  if (cmd && paneId && resumeId) {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", resumeId]);
  }
  return cmd;
}

/**
 * Hard-reload secretary: respawn-pane -k -> fresh shell -> CLI -> POV inject.
 * Mirrors harness run_secretary_restart (bypasses pane-op queue).
 */
export function secretaryRestart(
  loaded: LoadedProfile,
  registry?: ProviderRegistry,
  typArg?: string,
  fresh = false,
): void {
  const reg = registry ?? createRegistryForProfile(loaded.profile);
  const session = loaded.sessionName;
  const workspace = loaded.workspace;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  const resolved = resolvePaneTarget("secretary", loaded);
  if ("error" in resolved) {
    throw new Error(`${resolved.error} - run: ./sm.sh secretary start`);
  }
  const paneId = resolved.paneId;

  const state = loadLaunchState(
    workspace,
    loaded.profile.state.meshAgentsJson,
    loaded.profile.state.agentsJson,
  );
  let typ =
    typArg ??
    state.secretary?.type ??
    state.conventions?.secretary_default_cli ??
    "opencode";
  if (typ === "cursor-agent") typ = "agent";
  if (typ === "empty") {
    throw new Error("refused: secretary restart empty - use secretary stop");
  }

  const cmd = resolveSecretaryLaunchCmd(loaded, typ, paneId, fresh);
  if (!cmd) throw new Error(`no launch cmd for secretary type ${typ}`);

  withActivePanePreserved(paneId, () => {
    tmux(["select-pane", "-e", "-t", paneId]);
  });

  const respawn = tmux(["respawn-pane", "-k", "-c", workspace, "-t", paneId]);
  if (!respawn.ok) {
    console.error("WARN: respawn-pane failed; falling back to Escape/C-c quit");
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(200);
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(200);
    tmux(["send-keys", "-t", paneId, "C-c"]);
    sleepMs(300);
    tmux(["send-keys", "-t", paneId, "C-c"]);
    sleepMs(300);
    tmux(["send-keys", "-t", paneId, "clear", "Enter"]);
    sleepMs(200);
  } else {
    sleepMs(800);
  }

  ensureSecretaryBanners(loaded, paneId);
  tmux(["set-option", "-p", "-t", paneId, "@mesh_status", "restarting"]);
  withActivePanePreserved(paneId, () => {
    tmux(["select-pane", "-e", "-t", paneId]);
  });

  tmux(["send-keys", "-t", paneId, cmd, "Enter"]);
  sleepMs(300);
  tmux(["send-keys", "-t", paneId, "Enter"]);

  const live = waitForCli(reg, paneId, capturePaneSnapshot);
  if (!live) {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_status", "restart-fail"]);
    throw new Error(`secretary restart failed: no live CLI on ${paneId}`);
  }

  const providerId = live.providerId;
  if (!waitForComposerReady(reg, paneId, capturePaneSnapshot, providerId)) {
    const tail = capturePaneSnapshot(paneId)?.captureTail ?? "";
    if (/esc exit shell mode/i.test(tail)) {
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(400);
    }
    if (!waitForComposerReady(reg, paneId, capturePaneSnapshot, providerId)) {
      console.error(
        "WARN: composer not ready on",
        paneId,
        `(${providerId}) - POV inject may fail`,
      );
    }
  }
  sleepMs(500);

  const pov = injectAfterLaunch(loaded, reg, "secretary", paneId);
  if (pov.ok) {
    console.log(`OK: secretary POV ${pov.detail}`);
  } else {
    console.error(`WARN: secretary POV: ${pov.detail}`);
  }

  tmux(["set-option", "-p", "-t", paneId, "@mesh_status", ""]);
  // Do NOT lock pane input here — the operator must still be able to type into
  // secretary directly after a restart (operator-reported: was left stuck locked).

  console.log(`OK: restarted secretary pane=${paneId} (${providerId}): respawn + POV`);
}

export function secretaryLaunch(loaded: LoadedProfile): void {
  const reg = createRegistryForProfile(loaded.profile);
  submitPaneOp(
    loaded,
    "launch",
    { targets: ["secretary"] },
    "secretary start",
    () => secretaryRestart(loaded, reg),
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
    throw new Error("inbox DOWN — run: ./sm.sh reload (or inbox restart)");
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
    throw new Error(`${resolved.error} — run: ./sm.sh secretary start`);
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

interface CheckbackRowLocal {
  id: string;
  kind: string;
  status: "active" | "cancelled";
  renewSec?: number;
  expect?: string;
  ownerPane?: string;
  expiresAt?: string;
  senderLabel?: string;
  recipientLabel?: string;
  createdAt: string;
  updatedAt: string;
}

function checkbackPath(loaded: LoadedProfile): string {
  return meshRuntimePaths(loaded).checkbackJsonl;
}

function readCheckbacksLocal(loaded: LoadedProfile): CheckbackRowLocal[] {
  const p = checkbackPath(loaded);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CheckbackRowLocal);
}

function writeCheckbacksLocal(loaded: LoadedProfile, rows: CheckbackRowLocal[]): void {
  const p = checkbackPath(loaded);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

function upsertCheckbackLocal(loaded: LoadedProfile, row: CheckbackRowLocal): void {
  const rows = readCheckbacksLocal(loaded).filter((r) => r.id !== row.id);
  rows.push(row);
  writeCheckbacksLocal(loaded, rows);
}

function cancelCheckbackLocal(loaded: LoadedProfile, id: string): void {
  const now = new Date().toISOString();
  const rows = readCheckbacksLocal(loaded);
  let hit = false;
  for (const r of rows) {
    if (r.id === id || r.id.startsWith(id)) {
      r.status = "cancelled";
      r.updatedAt = now;
      hit = true;
    }
  }
  if (hit) writeCheckbacksLocal(loaded, rows);
}

function armPatienceLocal(
  loaded: LoadedProfile,
  body: Omit<CheckbackRowLocal, "createdAt" | "updatedAt" | "status">,
): void {
  const now = new Date().toISOString();
  upsertCheckbackLocal(loaded, {
    ...body,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

function armPatience(
  loaded: LoadedProfile,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  const row = body as Omit<CheckbackRowLocal, "createdAt" | "updatedAt" | "status">;
  armPatienceLocal(loaded, row);
  return { ok: true, entry: row };
}

function cancelPatience(loaded: LoadedProfile, id: string): void {
  cancelCheckbackLocal(loaded, id);
}

/** Operator-assigned: secretary + daemon keep manager moving without operator "continue". */
export function secretarySupervise(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  sub: "on" | "off" | "status",
  interval = "10m",
): void {
  const workspace = loaded.workspace;
  const session = loaded.sessionName;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  const mgrIds = managerColumnIds(layout);
  const secIds = secretaryColumnIds(layout);
  const secResolved = resolvePaneTarget(secIds[0] ?? "secretary", loaded);
  const mgrResolved = resolvePaneTarget(mgrIds[0] ?? "manager", loaded);
  const extraMgrs = mgrIds.slice(1).map((id) => ({ id, resolved: resolvePaneTarget(id, loaded) }));
  if ("error" in secResolved) {
    throw new Error(`${secResolved.error} — run: ./sm.sh secretary restart`);
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
    cancelPatience(loaded, MANAGER2_NUDGE_ID);
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
          manager2Pane?: string;
          secretaryPane?: string;
        };
        if (meta.since) console.log(`  since: ${meta.since}`);
        if (meta.interval) console.log(`  interval: ${meta.interval}`);
        if (meta.managerPane) console.log(`  manager: ${meta.managerPane}`);
        if (meta.manager2Pane) console.log(`  manager-2: ${meta.manager2Pane}`);
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
  cancelPatience(loaded, MANAGER2_NUDGE_ID);
  for (const extra of extraPanes) {
    cancelPatience(loaded, `mesh-${extra.id}-nudge`);
  }
  cancelPatience(loaded, SECRETARY_SUPERVISE_ID);

  // Primary manager is the hub — no daemon CONTINUE nudge (was spamming the pane).
  for (const extra of extraPanes) {
    armPatience(loaded, {
      id: extra.id === "manager-2" ? MANAGER2_NUDGE_ID : `mesh-${extra.id}-nudge`,
      kind: extra.id === "manager-2" ? "manager-2-nudge" : "coord-nudge",
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
      manager2Pane: extraPanes[0]?.paneId ?? "",
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
        manager2Pane: extraPanes[0]?.paneId,
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
    console.log("  fix: ./sm.sh secretary start");
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
          `STALE: still open. File ./sm.sh mini done ${id} PASS|FAIL: <evidence> when finished — supervisor will not accept chat-only done.`,
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
        `  collect: ${runtimePathHint(loaded.workspace, meshRuntimePaths(loaded).miniDone)} + ./sm.sh mini list`,
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
