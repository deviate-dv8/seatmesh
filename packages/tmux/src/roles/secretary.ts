import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isSuperviseContractOn,
  meshRuntimePaths,
  runtimePathHint,
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
import { loadLaunchState, resolveLaunchCmd } from "../agents/agents-state.js";
import { enqueuePeer, ensureMeshInbox, inboxHealth, meshInboxPort } from "../comms/inbox-bridge.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import type { MiniCampaignDigest } from "./minis.js";
import { submitPaneOp } from "../ops/pane-ops-client.js";
import { buildMiniCampaignDigest, miniPrompt, miniSpawnAll } from "./minis.js";
import { meshManagerPane } from "../lib/pane-meta.js";
import { injectPromptDirect } from "../inject/prompt.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { tmux } from "../lib/tmux-run.js";
import { applyMeshBorderFormat } from "../session/borders.js";
import { listWindowPaneIds } from "../session/window-panes.js";

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

function secretaryContextSnippet(workspace: string, loaded: LoadedProfile): string {
  const focusPath = path.join(workspace, "tasks/agent-seats/manager/FOCUS.md");
  let ctx = "";
  if (fs.existsSync(focusPath)) {
    const text = fs.readFileSync(focusPath, "utf8");
    const nowBlock = text.match(/^## NOW\n([\s\S]*?)(?=\n## |\s*$)/m);
    ctx = (nowBlock?.[1] ?? "")
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .slice(0, 8)
      .map((l) => l.replace(/^- /, "").trim())
      .join("; ");
  }
  const nightOn = fs.existsSync(
    path.join(workspace, "tasks/agent-seats/manager/night.on"),
  );
  const nightBit = nightOn ? " night=ON" : "";
  let nMinis = 0;
  const layout = loaded.profile.layout;
  if (layout) {
    nMinis = listWindowPaneIds(loaded.sessionName, layout.minis.window).length;
  }
  const miniMax = loaded.profile.session.miniMax;
  return `CONTEXT: ${ctx.slice(0, 380)}${nightBit} minis=${nMinis}/${miniMax}. OC: CPE scripts/opencode-cpe.sh :18887; ./sm.sh whoami for mesh seat.`;
}

function secretaryPovBriefing(
  workspace: string,
  loaded: LoadedProfile,
  typ: string,
): string {
  const ctx = secretaryContextSnippet(workspace, loaded);
  const pov =
    "you are SECRETARY (NOT mini/master/worker). Run ./sm.sh whoami - must show you_are=SECRETARY; read_first=roles/secretary.yaml read_first. Job: absorb worker ACK/stand-by/mcp-synced/FYI; bulk digest to master (not bit-by-bit); notify operator ~10% via workspace notify script when they must check. Default: spawn 1 mini, wait done, fold digest. May: trivial inbox; seats/contexts/mini list/health; mini spawn tester|code-reviewer|helper when safe; mesh-watch on. Must NOT: prompt/switch workers; merge; board moves; rubber-stamp product MINI-DONE; steal prove toasts.";
  let b: string;
  if (typ === "opencode") {
    b = `You are SECRETARY. ${ctx} ${pov} Standing by - transform noise.`;
  } else {
    b = `[agent-manager-secretary] POV: ${ctx} ${pov} Standing by - do not chat operator as primary.`;
  }
  if (b.length > 900) b = `${b.slice(0, 900)}…`;
  return b;
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
  tmux(["select-pane", "-t", paneId, "-T", "secretary"]);
}

function ensureSecretaryBanners(loaded: LoadedProfile, paneId: string): void {
  const layout = loaded.profile.layout;
  if (!layout) return;
  const session = loaded.sessionName;
  applyMeshBorderFormat(session, layout.base.window);
  stampSecretaryMeta(paneId);
}

function resolveSecretaryLaunchCmd(
  loaded: LoadedProfile,
  typ: string,
  paneId?: string,
): string | null {
  const state = loadLaunchState(
    loaded.workspace,
    loaded.profile.state.meshAgentsJson,
    loaded.profile.state.agentsJson,
  );
  const harnessType = typ === "cursor-agent" ? "agent" : typ;
  let resumeId = state.secretary?.resume_id ?? null;
  if (!resumeId && paneId) {
    const stored = tmux(["display-message", "-t", paneId, "-p", "#{@mesh_oc_session}"]).out;
    if (stored) resumeId = stored;
  }
  if (!resumeId && harnessType === "opencode") {
    resumeId = guessSecretaryOpenCodeSession(loaded.workspace) ?? null;
  }
  const secEntry = {
    type: harnessType,
    resume_id: resumeId,
    resume_cmd: state.secretary?.resume_cmd ?? null,
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

  const masterPane = meshManagerPane(session, layout.base.window);
  const cmd = resolveSecretaryLaunchCmd(loaded, typ, paneId);
  if (!cmd) throw new Error(`no launch cmd for secretary type ${typ}`);

  tmux(["select-pane", "-e", "-t", paneId]);

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
  tmux(["select-pane", "-e", "-t", paneId]);

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
    console.error(
      "WARN: composer not ready on",
      paneId,
      `(${providerId}) - POV inject may fail`,
    );
  }
  sleepMs(500);

  const povTyp = providerId === "opencode" ? "opencode" : typ;
  const msg = secretaryPovBriefing(workspace, loaded, povTyp);
  injectPromptDirect(loaded, reg, paneId, msg, { prefix: "" });
  sleepMs(2000);

  const tail = capturePaneSnapshot(paneId)?.captureTail ?? "";
  if (!/SECRETARY|You are SECRETARY|CONTEXT:/i.test(tail)) {
    console.error(
      "WARN: secretary POV inject uncertain - retry: ./sm.sh secretary restart",
    );
  }

  tmux(["set-option", "-p", "-t", paneId, "@mesh_status", ""]);
  tmux(["select-pane", "-d", "-t", paneId]);
  if (masterPane) tmux(["select-pane", "-t", masterPane]);

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
  interval = "5m",
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
    const r = spawnSync(
      "curl",
      ["-sS", `${base}/patience?all=1`],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error("patience list failed");
    const lines = (r.stdout || "").split("\n").filter((l) => l.includes(MESH_WATCH_ID));
    if (!lines.length) {
      console.log("mesh-watch: OFF");
      return;
    }
    console.log(lines.join("\n"));
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
    expect: "mesh MINI-DONE / health change / STALE thought-only minis",
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
  interval = "5m",
): void {
  const workspace = loaded.workspace;
  const session = loaded.sessionName;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  const secResolved = resolvePaneTarget("secretary", loaded);
  const mgrResolved = resolvePaneTarget("manager", loaded);
  if ("error" in secResolved) {
    throw new Error(`${secResolved.error} — run: ./sm.sh secretary restart`);
  }
  if ("error" in mgrResolved) {
    throw new Error(`${mgrResolved.error} — manager pane missing`);
  }

  const marker = superviseMarkerPath(loaded);

  if (sub === "off") {
    cancelPatience(loaded, MANAGER_NUDGE_ID);
    cancelPatience(loaded, SECRETARY_SUPERVISE_ID);
    cancelPatience(loaded, MESH_WATCH_ID);
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
    console.log("OK: secretary supervise OFF (manager-nudge + supervise loop cancelled)");
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
          secretaryPane?: string;
        };
        if (meta.since) console.log(`  since: ${meta.since}`);
        if (meta.interval) console.log(`  interval: ${meta.interval}`);
        if (meta.managerPane) console.log(`  manager: ${meta.managerPane}`);
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
  cancelPatience(loaded, SECRETARY_SUPERVISE_ID);

  const mgrBody = {
    id: MANAGER_NUDGE_ID,
    kind: "manager-nudge",
    renewSec: secs,
    expect: "manager idle - continue authorized seat-mesh work",
    ownerPane: mgrResolved.paneId,
    expiresAt: expires,
    senderLabel: "secretary",
    recipientLabel: "manager",
  };
  const secBody = {
    id: SECRETARY_SUPERVISE_ID,
    kind: "secretary-supervise",
    renewSec: secs,
    expect: "supervise manager continuity",
    ownerPane: secResolved.paneId,
    expiresAt: expires,
    senderLabel: "daemon",
    recipientLabel: "secretary",
  };

  armPatience(loaded, mgrBody);
  armPatience(loaded, secBody);

  armPatienceLocal(loaded, {
    id: MESH_WATCH_ID,
    kind: "mesh-watch",
    renewSec: secs,
    expect: "mesh MINI-DONE / health change / STALE thought-only minis",
    ownerPane: secResolved.paneId,
    expiresAt: expires,
    senderLabel: "inbox",
    recipientLabel: "secretary",
  });

  const brief = `SUPERVISION (operator assigned): You supervise MASTER (manager pane ${mgrResolved.paneId}). Keep master moving without operator saying continue. Daemon manager-nudge is ON (idle master gets CONTINUE every ${interval}). Your loop on each SUPERVISE tick: ./sm.sh contexts; read seats/manager/FOCUS.md; if master idle and work remains, ./sm.sh to-master "CONTINUE: <one-line next step>". mesh-watch ON for minis. Bulk digest only — no ACK spam. Do not ping operator for routine continue.`;

  const enq = enqueuePeer(loaded, {
    kind: "prompt",
    msg: brief,
    targetPane: secResolved.paneId,
    targetLabel: "secretary",
    fromSlot: "manager",
  });
  if (!enq?.ok) {
    try {
      injectPromptDirect(loaded, registry, "secretary", brief, { prefix: "" });
    } catch (e) {
      console.error(
        `WARN: secretary brief queued failed (${(e as Error).message}) — checkbacks armed; daemon will inject when idle`,
      );
    }
  }

  fs.writeFileSync(
    marker,
    JSON.stringify(
      {
        since: new Date().toISOString(),
        interval,
        managerPane: mgrResolved.paneId,
        secretaryPane: secResolved.paneId,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(
    `OK: secretary supervise ON interval=${interval} manager=${mgrResolved.paneId} secretary=${secResolved.paneId}`,
  );
  console.log("  supervisee: MANAGER ONLY (not worker slot-1..8, not mini-1..8)");
  console.log("  mini campaign room: tasks/chat-rooms/supervise (separate contract)");
  console.log("  manager-nudge: daemon CONTINUE when master idle");
  console.log("  secretary-supervise: secretary polls manager each tick");
  console.log("  off: ./sm.sh secretary supervise off");
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
    const session = loaded.sessionName;
    const base = loaded.profile.layout?.base.window;
    const mgrPane = base ? meshManagerPane(session, base) : null;
    if (mgrPane) {
      injectPromptDirect(
        loaded,
        registry,
        "manager",
        `SECRETARY-DIGEST (mechanical — do not trust chat "all done"):\n${digest.text}`,
        { manager: true },
      );
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
  return (r.stdout || "").includes(MESH_WATCH_ID) ? "ON" : "OFF";
}
