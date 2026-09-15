#!/usr/bin/env node
/** seatmesh inbox daemon — sole pane inject consumer for mesh sessions. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadProfile,
  meshRuntimePaths,
  resolveDaemonPort,
  resolveUxConfig,
} from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import {
  capturePaneSnapshot,
  listMeshMonitorPanes,
  listMeshWorkers,
  listMeshMinis,
  meshSecretaryPane,
  resolveLiveTmuxSession,
  saveMeshSession,
  cursorUsageAutoFallback,
} from "@seat-mesh/tmux";
import { configureInboxTypingGate } from "./inject/compose-gate.js";
import { createQueueStore } from "./store/create-queue-store.js";
import { openAckForPeerRow } from "./ack/ack-open.js";
import { countPeerPendingGlobal } from "./peer/peer-pending.js";
import { findDupInbox, findDupPeer, type CheckbackRow } from "./store/jsonl-store.js";
import {
  orchestratorDrainTickAsync,
  type MeshOrchestratorCtx,
} from "./orchestrator/mesh-orchestrator.js";
import { repaintMeshPaneBorder } from "./border/border-paint.js";
import {
  clearOcLimitBannerForPane,
  maybeEndRateLimitEpisode,
  newConnectivityRecoveryState,
  pollConnectivityRecovery,
} from "./connectivity/connectivity-recovery.js";
import {
  notifyResumeWave,
  resumeAllOpenCodePanes,
  type ResumeWaveMeta,
} from "./connectivity/oc-resume.js";
import { broadcastOcResumeToRemotes } from "./connectivity/oc-resume-broadcast.js";
import { armResumeAckWave, pollResumeAcks } from "./connectivity/oc-resume-ack.js";
import {
  armCcLimitRetryCheckback,
  armCcLimitRetryForAllClaudePanes,
  ccLimitRetryFireAtMs,
  paneSessionFingerprint,
} from "./connectivity/cc-limit-retry.js";
import {
  armAckRedirectBlock,
  applyAckRedirectBlock,
  clearAckRedirectBlocks,
  listAckRedirectBlocks,
} from "./peer/ack-redirect-block.js";
import {
  clearLimitIdleOverride,
  setLimitIdleOverride,
} from "./border/limit-idle-override.js";
import { resetStickyNegativeStatus } from "./border/border-paint.js";
import {
  drainPaneOpsOnce,
  enqueuePaneOp,
  queueAheadCount,
  type PaneOpsDrainCtx,
} from "./inbox/pane-ops-drain.js";
import type { NotifyActRegisterAction, PaneOpKind } from "@seat-mesh/core";
import {
  createNotifyActRegistry,
  executeNotifyAct,
} from "./notify/notify-act.js";
import {
  htmlActPage,
  htmlDecideCardPage,
  htmlDemoYesNoPage,
} from "./notify/notify-act-ui.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(): { profilePath?: string } {
  const out: { profilePath?: string } = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--profile" && argv[i + 1]) out.profilePath = argv[++i];
  }
  return out;
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2) + "\n");
}

function html(res: http.ServerResponse, code: number, body: string): void {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function main(): Promise<void> {
  const { profilePath } = parseArgs();
  const loaded = loadProfile(profilePath);
  const profile = loaded.profile;
  configureInboxTypingGate({ skip: profile.daemon?.skipTypingGate === true });
  const meshLayout = profile.layout;
  if (!meshLayout) {
    console.error("mesh-inbox: profile missing layout");
    process.exit(1);
  }
  const baseWindow = meshLayout.base.window;
  const workersWindow = meshLayout.workers.window;
  const minisWindow = meshLayout.minis.window;

  const session = resolveLiveTmuxSession(loaded);
  const port = resolveDaemonPort(profile, loaded.workspace);
  const pollMs = profile.daemon?.pollMs ?? 4000;
  const autoScrapeMs = profile.state.autoScrapeIntervalMs ?? 600_000;
  let lastAutoScrapeAt = 0;
  const workspace = loaded.workspace;
  const rt = meshRuntimePaths(loaded);
  const stateDir = rt.daemonDir;
  const metaPath = rt.meshInboxMeta;
  const logPath = rt.meshInboxLog;
  fs.mkdirSync(stateDir, { recursive: true });

  function log(line: string): void {
    const row = `${new Date().toISOString()} ${line}\n`;
    fs.appendFileSync(logPath, row);
  }

  const store = createQueueStore(loaded, log);
  const actRegistry = createNotifyActRegistry();
  const registry = createRegistryForProfile(profile);
  const uxResolved = profile.ux !== undefined ? resolveUxConfig(profile.ux) : null;
  const connectivity = newConnectivityRecoveryState();
  const ocLimited = connectivity.ocLimited;
  let pollBusy = false;
  let snapRefreshBusy = false;
  let scrapeBusy = false;
  let paneOpBusy = false;
  let healthSnap = {
    workerPanes: 0,
    miniPanes: 0,
    secretaryPane: null as string | null,
    updatedAt: 0,
  };
  /** Cached queue counts — /health must not parse JSONL on every curl (event-loop wedge). */
  let queueSnap = {
    checkbackActive: 0,
    inboxUnresolved: 0,
    peerUnsent: 0,
    paneOpsPending: 0,
    ackOpen: 0,
    updatedAt: 0,
  };

  function refreshHealthSnap(): void {
    healthSnap = {
      workerPanes: listMeshWorkers(session, workersWindow).length,
      miniPanes: listMeshMinis(session, minisWindow).length,
      secretaryPane: meshSecretaryPane(session, baseWindow),
      updatedAt: Date.now(),
    };
  }

  function refreshQueueSnap(): void {
    queueSnap = {
      checkbackActive: store.readCheckbacks().filter((r) => r.status === "active").length,
      inboxUnresolved: store.readInbox().filter((r) => !r.resolved).length,
      peerUnsent: countPeerPendingGlobal(store),
      paneOpsPending: store.countPaneOpsPending(),
      ackOpen: store.countOpenAcks(),
      updatedAt: Date.now(),
    };
  }

  /** Defer tmux + store reads off the poll/drain path so GET /health can interleave. */
  function scheduleHealthSnapRefresh(): void {
    if (snapRefreshBusy) return;
    snapRefreshBusy = true;
    setImmediate(() => {
      try {
        refreshHealthSnap();
        refreshQueueSnap();
      } catch (e) {
        log(`health snap error ${(e as Error).message}`);
      } finally {
        snapRefreshBusy = false;
      }
    });
  }

  function tmuxHasSessionAsync(sess: string): Promise<boolean> {
    return new Promise((resolve) => {
      const p = spawn("tmux", ["has-session", "-t", sess], { stdio: "ignore" });
      p.on("close", (code) => resolve(code === 0));
      p.on("error", () => resolve(false));
    });
  }

  function scheduleAutoScrape(): void {
    if (scrapeBusy || autoScrapeMs <= 0 || Date.now() - lastAutoScrapeAt < autoScrapeMs) return;
    scrapeBusy = true;
    setImmediate(() => {
      void (async () => {
        try {
          if (await tmuxHasSessionAsync(session)) {
            lastAutoScrapeAt = Date.now();
            saveMeshSession(loaded, registry);
            log("auto-scrape mesh-agents.json");
          }
        } catch (e) {
          log(`auto-scrape error ${(e as Error).message}`);
        } finally {
          scrapeBusy = false;
        }
      })();
    });
  }

  const paneOpsCtx: PaneOpsDrainCtx = {
    loaded,
    registry,
    store,
    log,
    isBusy: () => paneOpBusy,
    setBusy: (v) => {
      paneOpBusy = v;
    },
  };

  const orchCtx: MeshOrchestratorCtx = {
    loaded,
    registry,
    store,
    session,
    baseWindow,
    workersWindow,
    minisWindow,
    log,
    ocLimitedPaneIds: ocLimited,
    connectPaneIds: connectivity.connectPanes,
    proxyDownActive: connectivity.proxyDownActive,
    paneOps: paneOpsCtx,
  };

  function borderConnectivitySnapshot(): {
    proxyDownActive: boolean;
    ocLimitedPaneIds: Set<string>;
    connectPaneIds: Set<string>;
  } {
    return {
      proxyDownActive: connectivity.proxyDownActive,
      ocLimitedPaneIds: connectivity.ocLimited,
      connectPaneIds: connectivity.connectPanes,
    };
  }

  function refreshOrchConnectivity(): void {
    orchCtx.proxyDownActive = connectivity.proxyDownActive;
    orchCtx.connectPaneIds = connectivity.connectPanes;
  }

  function drainPaneOpsChain(): void {
    for (let i = 0; i < 12; i++) {
      if (!drainPaneOpsOnce(paneOpsCtx)) break;
    }
  }

  async function runDrain(): Promise<void> {
    await orchestratorDrainTickAsync(orchCtx);
  }

  let drainCoalesce = false;

  function scheduleDrain(): void {
    runDrainCoalesced();
  }

  /** Without BullMQ, coalesce burst enqueues (room-fanout) so /health stays responsive. */
  function runDrainCoalesced(onDone?: () => void): void {
    if (drainCoalesce) {
      onDone?.();
      return;
    }
    drainCoalesce = true;
    setImmediate(() => {
      void runDrain().finally(() => {
        drainCoalesce = false;
        onDone?.();
      });
    });
  }

  async function enqueueAfterAppend(_kind: "inbox" | "peer", _rowId: string): Promise<void> {
    scheduleDrain();
  }

  function resumeOpenCodePanes(
    reason = "recovery",
    meta?: ResumeWaveMeta,
    opts?: { skipBroadcast?: boolean },
  ): void {
    const panes = listMeshMonitorPanes(
      session,
      baseWindow,
      workersWindow,
      minisWindow,
    ).map((p) => p.paneId);
    const { sent, total, sentPaneIds } = resumeAllOpenCodePanes(panes, registry, log);
    log(`OC-RESUME wave (${reason}) sent=${sent}/${total}`);
    notifyResumeWave(workspace, reason, sent, total, meta);
    if (sent > 0) {
      armResumeAckWave(sentPaneIds, reason);
    }
    if (!opts?.skipBroadcast) {
      broadcastOcResumeToRemotes(loaded, reason, meta, log);
    }
  }

  function pollOcLimitsTick(): void {
    pollConnectivityRecovery({
      loaded,
      registry,
      workspace,
      session,
      baseWindow,
      workersWindow,
      minisWindow,
      state: connectivity,
      log,
      resumeOpenCodePanes,
      onCcLimitRise: (paneId, snap) => {
        const fireAt = ccLimitRetryFireAtMs(snap.captureTail);
        // One CC limited → arm every live Claude pane at the same fire time.
        // Each CB carries that pane's fingerprint; OC/kiro swap cancels that seat only.
        const n = armCcLimitRetryForAllClaudePanes(
          store,
          registry,
          session,
          baseWindow,
          workersWindow,
          minisWindow,
          fireAt,
          log,
          paneId,
        );
        if (!n) {
          const fp = paneSessionFingerprint(registry, snap);
          armCcLimitRetryCheckback(store, paneId, fp, fireAt, log);
        }
      },
      onCursorUsageLimitRise: (paneId) => {
        if (cursorUsageAutoFallback(paneId)) {
          log(`CURSOR-LIMIT auto-fallback /model Auto pane=${paneId}`);
        } else {
          log(`WARN: CURSOR-LIMIT auto-fallback failed pane=${paneId}`);
        }
      },
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    try {
      // Plain Targets UI (static). Decide cards live at /act/card/:id (dynamic).
      if (req.method === "GET" && (url.pathname === "/ui" || url.pathname === "/ui/" || url.pathname.startsWith("/ui/"))) {
        // Live demo under static path — register fresh Yes/No then render blueish page.
        if (url.pathname === "/ui/demo-yesno" || url.pathname === "/ui/demo-yesno/") {
          const baseUrl = `http://127.0.0.1:${port}`;
          const links = actRegistry.register(
            [
              {
                label: "Yes",
                type: "peer",
                params: {
                  target: "secretary",
                  msg: "Dan notify reply: YES",
                  kind: "prompt",
                },
              },
              {
                label: "No",
                type: "peer",
                params: {
                  target: "secretary",
                  msg: "Dan notify reply: NO",
                  kind: "prompt",
                },
              },
            ],
            3600,
            baseUrl,
          );
          log(`NOTIFY-ACT ui demo-yesno n=${links.length}`);
          return html(res, 200, htmlDemoYesNoPage(links, port));
        }
        const uiRoot = path.join(__dirname, "..", "static", "ui");
        let rel = url.pathname === "/ui" || url.pathname === "/ui/" ? "index.html" : url.pathname.slice("/ui/".length);
        rel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
        const file = path.join(uiRoot, rel || "index.html");
        if (!file.startsWith(uiRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("ui not found");
          return;
        }
        const ext = path.extname(file);
        const type =
          ext === ".html"
            ? "text/html; charset=utf-8"
            : ext === ".css"
              ? "text/css; charset=utf-8"
              : ext === ".js"
                ? "text/javascript; charset=utf-8"
                : "application/octet-stream";
        res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
        fs.createReadStream(file).pipe(res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          engine: "@seat-mesh/daemon",
          session,
          port,
          pid: process.pid,
          storage: rt.storageBackend,
          workerPanes: healthSnap.workerPanes,
          miniPanes: healthSnap.miniPanes,
          secretaryPane: healthSnap.secretaryPane,
          ocLimitActive: ocLimited.size,
          proxyDownActive: connectivity.proxyDownActive,
          connectivityRecovery: connectivity.recoveryRunning,
          checkbackActive: queueSnap.checkbackActive,
          inboxUnresolved: queueSnap.inboxUnresolved,
          peerUnsent: queueSnap.peerUnsent,
          paneOpsPending: queueSnap.paneOpsPending,
          ackOpen: queueSnap.ackOpen,
          queueSnapAgeMs: Date.now() - queueSnap.updatedAt,
          healthSnapAgeMs: Date.now() - healthSnap.updatedAt,
          ready: healthSnap.updatedAt > 0 && queueSnap.updatedAt > 0,
          pollBusy,
          snapRefreshBusy,
          scrapeBusy,
          paneOpBusy,
          stateDir,
        });
      }

      if (req.method === "GET" && url.pathname === "/pane-ops") {
        const rows = store.readPaneOps().slice(-40);
        return json(res, 200, { ok: true, rows, pending: store.countPaneOpsPending(), paneOpBusy });
      }

      if (req.method === "POST" && url.pathname === "/pane-ops") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          kind?: PaneOpKind;
          who?: string;
          summary?: string;
          payload?: Record<string, unknown>;
        };
        const kind = body.kind;
        if (!kind) return json(res, 400, { ok: false, error: "kind required" });
        const ahead = queueAheadCount(store);
        const row = enqueuePaneOp(
          store,
          kind,
          String(body.who ?? "unknown"),
          String(body.summary ?? kind),
          body.payload ?? {},
        );
        log(`PANE-OP queued ${row.id.slice(0, 8)} ${kind} who=${row.who} ahead=${ahead}`);
        drainPaneOpsChain();
        const updated = store.readPaneOps().find((r) => r.id === row.id) ?? row;
        return json(res, 200, {
          ok: true,
          entry: updated,
          queueAhead: Math.max(0, ahead),
        });
      }

      if (req.method === "GET" && url.pathname === "/patience") {
        const all = url.searchParams.get("all") === "1";
        let rows = store.readCheckbacks();
        if (!all) rows = rows.filter((r) => r.status === "active");
        return json(res, 200, { entries: rows });
      }

      if (req.method === "GET" && url.pathname === "/targets") {
        const all = url.searchParams.get("all") === "1";
        let rows = store.readTargets();
        if (!all) rows = rows.filter((r) => r.status === "active");
        rows = [...rows].sort((a, b) => a.deadlineAt.localeCompare(b.deadlineAt));
        return json(res, 200, { targets: rows });
      }

      if (req.method === "POST" && url.pathname === "/targets") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          goal?: string;
          deadlineAt?: string;
          triageTo?: string[];
          kind?: string;
          parentId?: string;
        };
        const goal = String(body.goal ?? "").trim();
        const deadlineAt = String(body.deadlineAt ?? "").trim();
        if (!goal) return json(res, 400, { ok: false, error: "goal required" });
        if (!deadlineAt || Number.isNaN(Date.parse(deadlineAt))) {
          return json(res, 400, { ok: false, error: "deadlineAt ISO required" });
        }
        const parentId = String(body.parentId ?? "").trim() || undefined;
        let kind: "scope" | "slice" | undefined =
          body.kind === "scope" || body.kind === "slice" ? body.kind : undefined;
        if (parentId) kind = "slice";
        if (!kind && !parentId) kind = "scope"; // default: whole-goal for leads to break down
        if (parentId) {
          const parent = store.findTarget(parentId);
          if (!parent) return json(res, 400, { ok: false, error: "parent scope not found" });
        }
        if (!parentId) store.cancelActiveTargetsWithGoal(goal);
        const now = new Date().toISOString();
        const row = {
          id: `tgt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          status: "active" as const,
          goal,
          deadlineAt,
          createdAt: now,
          updatedAt: now,
          kind,
          parentId,
          triageTo: Array.isArray(body.triageTo)
            ? body.triageTo.map((s) => String(s).trim()).filter(Boolean)
            : ["manager", "secretary"],
          source: "operator" as const,
        };
        store.upsertTarget(row);
        log(
          `target add id=${row.id} kind=${kind ?? "-"} parent=${parentId?.slice(0, 8) ?? "-"} deadline=${deadlineAt} goal=${goal.slice(0, 60)}`,
        );
        return json(res, 200, { ok: true, id: row.id, target: row });
      }

      const targetAction = /^\/targets\/([^/]+)\/(done|cancel|triage|remind)$/.exec(url.pathname);
      if (req.method === "POST" && targetAction) {
        const id = decodeURIComponent(targetAction[1]!);
        const action = targetAction[2]!;
        const row = store.findTarget(id);
        if (!row) return json(res, 404, { ok: false, error: "not found" });
        if (action === "done") {
          const updated = store.markTargetDone(id);
          log(`target done id=${updated?.id}`);
          return json(res, 200, { ok: true, target: updated });
        }
        if (action === "cancel") {
          const updated = store.cancelTarget(id);
          log(`target cancel id=${updated?.id}`);
          return json(res, 200, { ok: true, target: updated });
        }
        const { fireOneTarget } = await import("./target/target-fire.js");
        if (action === "remind") {
          fireOneTarget(
            { store, loaded, log },
            row,
            { forceToast: true, forceTriage: false },
          );
          return json(res, 200, { ok: true, target: store.findTarget(id) });
        }
        // triage
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { triageTo?: string[] };
        if (Array.isArray(body.triageTo) && body.triageTo.length) {
          row.triageTo = body.triageTo.map((s) => String(s).trim()).filter(Boolean);
        }
        fireOneTarget(
          { store, loaded, log },
          row,
          { forceToast: false, forceTriage: true },
        );
        return json(res, 200, { ok: true, target: store.findTarget(id) });
      }

      if (req.method === "GET" && url.pathname === "/ack") {
        const all = url.searchParams.get("all") === "1";
        const seat = url.searchParams.get("seat")?.trim().toLowerCase();
        let rows = store.readAcks();
        if (!all) rows = rows.filter((r) => !r.ackedAt);
        if (seat) rows = rows.filter((r) => r.seat.trim().toLowerCase() === seat);
        rows.sort((a, b) => a.at.localeCompare(b.at));
        return json(res, 200, { entries: rows, open: store.countOpenAcks() });
      }

      if (req.method === "POST" && url.pathname === "/ack/clear") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { seat?: string };
        const n = store.ackAllAcks(body.seat);
        log(`ack clear-all n=${n} seat=${body.seat ?? "*"}`);
        return json(res, 200, { ok: true, cleared: n });
      }

      // Temp block: after redirect, ACK-class from seat→manager is rewritten to secretary.
      if (req.method === "GET" && url.pathname === "/ack/redirect-block") {
        return json(res, 200, { blocks: listAckRedirectBlocks(store.stateDir) });
      }
      if (req.method === "POST" && url.pathname === "/ack/redirect-block") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          from?: string;
          fromSeat?: string;
          blockTarget?: string;
          rewriteTo?: string;
          ttlMin?: number;
          armedBy?: string;
          reason?: string;
        };
        const fromSeat = String(body.fromSeat ?? body.from ?? "").trim();
        if (!fromSeat) {
          return json(res, 400, { ok: false, error: "fromSeat required (e.g. mini-1)" });
        }
        const block = armAckRedirectBlock(store.stateDir, {
          fromSeat,
          blockTarget: body.blockTarget,
          rewriteTo: body.rewriteTo,
          ttlMs: body.ttlMin != null ? Number(body.ttlMin) * 60_000 : undefined,
          armedBy: body.armedBy ?? "api",
          reason: body.reason,
        });
        log(
          `ack-redirect armed id=${block.id} from=${block.fromSeat} block=${block.blockTarget}→${block.rewriteTo}`,
        );
        return json(res, 200, { ok: true, block });
      }
      if (req.method === "POST" && url.pathname === "/ack/redirect-block/clear") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { id?: string; fromSeat?: string; from?: string };
        const n = clearAckRedirectBlocks(store.stateDir, {
          id: body.id,
          fromSeat: body.fromSeat ?? body.from,
        });
        log(`ack-redirect cleared n=${n}`);
        return json(res, 200, { ok: true, cleared: n });
      }

      // Force limit borders back to idle (visual). Does not cancel cc-limit-retry CBs.
      if (req.method === "POST" && url.pathname === "/limit/idle") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          pane?: string;
          all?: boolean;
          ttlHours?: number;
        };
        const ttlMs = Math.max(1, Number(body.ttlHours ?? 24)) * 60 * 60_000;
        if (body.all || body.pane === "*" || body.pane === "all" || !body.pane) {
          setLimitIdleOverride("*", ttlMs);
          resetStickyNegativeStatus();
          log(`limit-idle override=all ttlHours=${body.ttlHours ?? 24}`);
          return json(res, 200, { ok: true, override: "all", ttlMs });
        }
        const pane = String(body.pane).trim();
        if (!pane.startsWith("%")) {
          return json(res, 400, { ok: false, error: "pane must be tmux pane id like %12" });
        }
        setLimitIdleOverride(pane, ttlMs);
        resetStickyNegativeStatus(pane);
        log(`limit-idle override pane=${pane} ttlHours=${body.ttlHours ?? 24}`);
        return json(res, 200, { ok: true, override: pane, ttlMs });
      }

      if (req.method === "POST" && url.pathname === "/limit/idle/clear") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { pane?: string; all?: boolean };
        if (body.all || !body.pane || body.pane === "*") {
          clearLimitIdleOverride();
          log("limit-idle override cleared (all)");
          return json(res, 200, { ok: true, cleared: "all" });
        }
        clearLimitIdleOverride(String(body.pane).trim());
        log(`limit-idle override cleared pane=${body.pane}`);
        return json(res, 200, { ok: true, cleared: body.pane });
      }

      if (req.method === "POST" && url.pathname === "/ack") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { id?: string; note?: string };
        const id = String(body.id ?? "").trim();
        if (!id) return json(res, 400, { ok: false, error: "id required" });
        const note = String(body.note ?? "").trim();
        if (!note) return json(res, 400, { ok: false, error: "note required" });
        const result = store.ackAck(id, "explicit", note);
        if (!result.ok) return json(res, 404, result);
        log(`ack clear id=${result.row?.id} seat=${result.row?.seat}`);
        return json(res, 200, { ok: true, entry: result.row });
      }

      if (req.method === "POST" && url.pathname === "/patience/cancel-all") {
        const n = store.cancelAllCheckbacks();
        log(`checkback cancel-all n=${n}`);
        return json(res, 200, { ok: true, cancelled: n });
      }

      if (req.method === "POST" && url.pathname === "/patience") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as Partial<CheckbackRow>;
        const now = new Date().toISOString();
        if (body.ownerPane && body.expect) {
          store.cancelCheckbacksForPaneExpect(body.ownerPane, body.expect);
        }
        const row: CheckbackRow = {
          id: String(body.id ?? `cb-${Date.now()}`),
          kind: String(body.kind ?? "checkback"),
          status: "active",
          renewSec: body.renewSec,
          expect: body.expect,
          ownerPane: body.ownerPane,
          expiresAt: body.expiresAt,
          senderLabel: body.senderLabel,
          recipientLabel: body.recipientLabel,
          createdAt: now,
          updatedAt: now,
        };
        store.upsertCheckback(row);
        return json(res, 200, { ok: true, entry: row });
      }

      if (req.method === "POST" && url.pathname === "/patience/ack") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { id?: string; yes?: boolean | string; answer?: string };
        const id = String(body.id ?? "").trim();
        if (!id) return json(res, 400, { ok: false, error: "id required" });
        const yes =
          body.yes === true ||
          body.yes === "true" ||
          String(body.answer ?? "").toLowerCase() === "yes";
        const result = store.ackCheckback(id, yes);
        if (!result.ok) return json(res, 404, result);
        log(`checkback ack id=${result.id} action=${result.action}`);
        return json(res, 200, result);
      }

      const cancelMatch = /^\/patience\/([^/]+)\/cancel$/.exec(url.pathname);
      if (req.method === "POST" && cancelMatch) {
        const id = decodeURIComponent(cancelMatch[1]);
        if (id === "cancel-all") {
          const n = store.cancelAllCheckbacks();
          return json(res, 200, { ok: true, cancelled: n });
        }
        const hit = store.cancelCheckback(id);
        if (!hit) {
          return json(res, 404, { ok: false, cancelled: null, error: `no active checkback matching ${id}` });
        }
        log(`checkback cancel id=${id}`);
        return json(res, 200, { ok: true, cancelled: id });
      }

      const resetMatch = /^\/patience\/([^/]+)\/reset$/.exec(url.pathname);
      if (req.method === "POST" && resetMatch) {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { expiresAt?: string; at?: string };
        const id = decodeURIComponent(resetMatch[1]);
        const expiresAt = String(body.expiresAt || body.at || "").trim();
        const entry = store.resetCheckback(id, expiresAt);
        if (!entry) {
          return json(res, 400, { ok: false, error: "not found or bad expiresAt" });
        }
        log(`checkback reset id=${entry.id} expiresAt=${entry.expiresAt ?? "?"}`);
        return json(res, 200, { ok: true, entry });
      }

      if (req.method === "POST" && url.pathname === "/pane-ops/clear") {
        const n = store.clearPaneOps();
        log(`pane-ops clear n=${n}`);
        return json(res, 200, { ok: true, cleared: n });
      }

      if (req.method === "POST" && url.pathname === "/to-peer") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as Partial<import("./store/jsonl-store.js").PeerRow>;
        const msg = String(body.msg ?? "").trim();
        const targetPane = String(body.targetPane ?? "").trim();
        const kindRaw = String(body.kind ?? "to-slot");
        const kind: import("./store/jsonl-store.js").PeerKind =
          kindRaw === "to-mini" ||
          kindRaw === "prompt" ||
          kindRaw === "remind" ||
          kindRaw === "room"
            ? kindRaw
            : "to-slot";
        if (!msg || !targetPane.startsWith("%")) {
          return json(res, 400, { ok: false, error: "msg and targetPane required" });
        }
        const now = new Date().toISOString();
        const row: import("./store/jsonl-store.js").PeerRow = {
          id: crypto.randomUUID(),
          at: now,
          kind,
          fromSlot: String(body.fromSlot ?? "?"),
          fromPorts: body.fromPorts != null ? String(body.fromPorts) : null,
          roomSlug: body.roomSlug != null ? String(body.roomSlug) : null,
          fromAgent: body.fromAgent != null ? String(body.fromAgent) : null,
          targetPane,
          targetLabel: String(body.targetLabel ?? targetPane),
          msg,
          sent: false,
        };
        const redir = applyAckRedirectBlock(store.stateDir, loaded, row);
        if (redir.redirected) {
          log(
            `TO-PEER ack-redirect ${redir.fromLabel}→${redir.toLabel} from=${row.fromAgent ?? row.fromSlot}`,
          );
        }
        const dup = findDupPeer(store.readPeer(), {
          targetPane: row.targetPane,
          msg: row.msg,
          kind,
        });
        if (dup) {
          log(`TO-PEER dedupe ${kind} -> ${dup.targetLabel} id=${dup.id.slice(0, 8)}`);
          return json(res, 200, {
            ok: true,
            entry: dup,
            deduped: true,
            ackRedirected: redir.redirected || undefined,
          });
        }
        store.appendPeer(row);
        log(`TO-PEER ${kind} from=slot-${row.fromSlot} -> ${row.targetLabel}`);
        openAckForPeerRow(store, row, log);
        await enqueueAfterAppend("peer", row.id);
        return json(res, 200, {
          ok: true,
          entry: row,
          ackRedirected: redir.redirected || undefined,
        });
      }

      if (req.method === "POST" && url.pathname === "/room-fanout") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          msg?: string;
          fromSlot?: string;
          fromPorts?: string | null;
          roomSlug?: string | null;
          fromAgent?: string | null;
          excludePane?: string;
          targets?: { targetPane?: string; targetLabel?: string; msg?: string }[];
        };
        const defaultMsg = String(body.msg ?? "").trim();
        const exclude = String(body.excludePane ?? "").trim();
        const now = new Date().toISOString();
        const rows: import("./store/jsonl-store.js").PeerRow[] = [];
        for (const t of body.targets ?? []) {
          const targetPane = String(t.targetPane ?? "").trim();
          const rowMsg = String(t.msg ?? defaultMsg).trim();
          if (!targetPane.startsWith("%")) continue;
          if (!rowMsg) continue;
          if (exclude && targetPane === exclude) continue;
          if (findDupPeer(store.readPeer(), { targetPane, msg: rowMsg, kind: "room" })) continue;
          rows.push({
            id: crypto.randomUUID(),
            at: now,
            kind: "room",
            fromSlot: String(body.fromSlot ?? "?"),
            fromPorts: body.fromPorts != null ? String(body.fromPorts) : null,
            roomSlug: body.roomSlug != null ? String(body.roomSlug) : null,
            fromAgent: body.fromAgent != null ? String(body.fromAgent) : null,
            targetPane,
            targetLabel: String(t.targetLabel ?? targetPane),
            msg: rowMsg,
            sent: false,
          });
        }
        if (!rows.length) {
          return json(res, 200, { ok: true, enqueued: 0, skipped: (body.targets ?? []).length });
        }
        store.appendPeers(rows);
        log(`ROOM-FANOUT from=${body.fromSlot ?? "?"} targets=${rows.length}`);
        scheduleDrain();
        return json(res, 200, { ok: true, enqueued: rows.length });
      }

      if (req.method === "GET" && url.pathname === "/ui/demo-yesno") {
        const baseUrl = `http://127.0.0.1:${port}`;
        const links = actRegistry.register(
          [
            {
              label: "Yes",
              type: "peer",
              params: {
                target: "secretary",
                msg: "Dan notify reply: YES",
                kind: "prompt",
              },
            },
            {
              label: "No",
              type: "peer",
              params: {
                target: "secretary",
                msg: "Dan notify reply: NO",
                kind: "prompt",
              },
            },
          ],
          3600,
          baseUrl,
        );
        log(`NOTIFY-ACT ui demo-yesno n=${links.length}`);
        return html(res, 200, htmlDemoYesNoPage(links, port));
      }

      if (req.method === "POST" && url.pathname === "/act/register") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          actions?: NotifyActRegisterAction[];
          ttlSec?: number;
          card?: { title?: string; body?: string };
        };
        const actions = Array.isArray(body.actions) ? body.actions : [];
        const hasCard = Boolean(body.card && (body.card.title || body.card.body));
        if (!actions.length && !hasCard) {
          return json(res, 400, { ok: false, error: "actions or card required" });
        }
        const ttlSec = Number(body.ttlSec ?? 3600);
        const baseUrl = `http://127.0.0.1:${port}`;
        const links = actions.length ? actRegistry.register(actions, ttlSec, baseUrl) : [];
        let card = undefined as ReturnType<typeof actRegistry.registerCard> | undefined;
        let infoUrl: string | undefined;
        if (hasCard) {
          card = actRegistry.registerCard(
            {
              title: String(body.card!.title ?? "Info"),
              body: String(body.card!.body ?? ""),
              links,
            },
            ttlSec,
            baseUrl,
          );
          infoUrl = card.infoUrl.trim();
        }
        log(`NOTIFY-ACT register n=${links.length}${card ? ` card=${card.id}` : ""}`);
        return json(res, 200, { ok: true, links, card, infoUrl });
      }

      const cardMatch = /^\/act\/card\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && cardMatch) {
        const card = actRegistry.getCard(cardMatch[1]!);
        if (!card) {
          return html(
            res,
            404,
            htmlActPage("Card expired", "This decision card expired or was never registered.", false),
          );
        }
        return html(res, 200, htmlDecideCardPage(card, port));
      }

      const actMatch = /^\/act\/v1\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && actMatch) {
        const token = actMatch[1]!;
        const row = actRegistry.take(token);
        if (!row) {
          return html(
            res,
            404,
            htmlActPage("Expired or used", "This link was already used or has expired.", false),
          );
        }
        const result = await executeNotifyAct(row, {
          loaded,
          store,
          log,
          onPeerEnqueued: async (peerRow) => {
            openAckForPeerRow(store, peerRow, log);
            await enqueueAfterAppend("peer", peerRow.id);
          },
        });
        const title = result.ok ? row.label : "Action failed";
        return html(res, result.ok ? 200 : 500, htmlActPage(title, result.summary, result.ok));
      }

      if (req.method === "GET" && url.pathname === "/inbox") {
        const all = url.searchParams.get("all") === "1";
        let rows = store.readInbox();
        if (!all) rows = rows.filter((r) => !r.resolved);
        return json(res, 200, { ok: true, entries: rows, count: rows.length });
      }

      if (req.method === "POST" && url.pathname === "/inbox/resolve") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { id?: string; all?: boolean };
        const result = store.resolveInbox({
          id: body.id != null ? String(body.id) : undefined,
          all: body.all === true,
        });
        log(`INBOX resolve count=${result.resolved} ids=${result.ids.map((i) => i.slice(0, 8)).join(",")}`);
        return json(res, 200, { ok: true, ...result });
      }

      if (req.method === "POST" && url.pathname === "/connectivity/oc-resume") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          reason?: string;
          fromIp?: string | null;
          toIp?: string | null;
          source?: string;
        };
        const reason = String(body.reason ?? "remote").trim() || "remote";
        const meta: ResumeWaveMeta = { fromIp: body.fromIp ?? null, toIp: body.toIp ?? null };
        const src = body.source?.trim();
        if (src && src === (loaded.profile.name ?? "")) {
          return json(res, 200, { ok: true, skipped: "same-source" });
        }
        resumeOpenCodePanes(reason, meta, { skipBroadcast: true });
        return json(res, 200, { ok: true, reason, meta });
      }

      if (req.method === "POST" && url.pathname === "/to-master") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          msg?: string;
          message?: string;
          from?: string;
          slot?: string;
          ports?: string;
        };
        const msg = String(body.msg ?? body.message ?? "").trim();
        if (!msg) return json(res, 400, { ok: false, error: "msg required" });
        const slot = body.slot != null ? String(body.slot) : null;
        const dup = findDupInbox(store.readInbox(), { msg, slot });
        if (dup) {
          log(`TO-MASTER dedupe slot=${slot ?? "-"} id=${dup.id.slice(0, 8)}`);
          return json(res, 200, { ok: true, entry: dup, deduped: true });
        }
        const now = new Date().toISOString();
        const row = {
          id: crypto.randomUUID(),
          at: now,
          from: body.from || "worker",
          slot,
          ports: body.ports || null,
          msg,
          sent: false,
          resolved: false,
          read: false,
        };
        store.appendInbox(row);
        log(`TO-MASTER from=${row.from} slot=${row.slot ?? "-"} :: ${msg}`);
        await enqueueAfterAppend("inbox", row.id);
        return json(res, 200, { ok: true, entry: row });
      }

      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    log(`listen error ${err.code ?? "?"} ${err.message}`);
    console.error(`mesh-inbox: listen failed ${err.message}`);
    process.exit(1);
  });

  server.listen(port, "127.0.0.1", () => {
    if (process.env.MESH_INBOX_SUPERVISED !== "1") {
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            pid: process.pid,
            port,
            session,
            storage: rt.storageBackend,
            sqlitePath: rt.sqlitePath,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
      );
    }
    log(`listening :${port} session=${session} storage=${rt.storageBackend}`);
    console.log(
      `mesh-inbox: listening http://127.0.0.1:${port} session=${session} storage=${rt.storageBackend}`,
    );
    scheduleHealthSnapRefresh();
    // First scrape ASAP so resume ids land before a quick kill/reattach.
    setTimeout(scheduleAutoScrape, 2_000);
  });

  const snapRefreshMs = Math.min(pollMs, 2000);
  setInterval(scheduleHealthSnapRefresh, snapRefreshMs);
  setInterval(scheduleAutoScrape, Math.min(pollMs, 15_000));
  setInterval(scheduleDrain, pollMs);

  function onResumeAckPane(paneId: string): void {
    if (clearOcLimitBannerForPane(connectivity, paneId)) {
      maybeEndRateLimitEpisode(connectivity);
      repaintMeshPaneBorder(
        registry,
        store,
        paneId,
        borderConnectivitySnapshot(),
        false,
        "",
        stateDir,
        uxResolved,
        loaded,
      );
      log(`OC-RESUME ack removed OC-LIMIT banner ${paneId}`);
      if (connectivity.ocLimited.size === 0) {
        const sec = meshSecretaryPane(session, baseWindow);
        if (sec) {
          repaintMeshPaneBorder(
            registry,
            store,
            sec,
            borderConnectivitySnapshot(),
            true,
            "secretary",
            stateDir,
            uxResolved,
            loaded,
          );
        }
      }
    }
  }

  setInterval(() => {
    if (pollBusy) return;
    pollBusy = true;
    setImmediate(() => {
      try {
        pollOcLimitsTick();
      } catch (e) {
        log(`connectivity poll error ${(e as Error).message}`);
      } finally {
        pollBusy = false;
      }
    });
    setImmediate(() => {
      try {
        pollResumeAcks(registry, workspace, log, onResumeAckPane);
        refreshOrchConnectivity();
      } catch (e) {
        log(`resume ack poll error ${(e as Error).message}`);
      }
    });
  }, pollMs);

  process.on("SIGTERM", () => {
    try {
      const alive = spawnSync("tmux", ["has-session", "-t", session], {
        stdio: "ignore",
      }).status === 0;
      if (alive) {
        saveMeshSession(loaded, registry);
        log("shutdown scrape mesh-agents.json");
      }
    } catch (e) {
      log(`shutdown scrape error ${(e as Error).message}`);
    }
    if ("close" in store && typeof store.close === "function") {
      store.close();
    }
    process.exit(0);
  });
}

void main().catch((e) => {
  console.error(`mesh-inbox fatal: ${(e as Error).message}`);
  process.exit(1);
});
