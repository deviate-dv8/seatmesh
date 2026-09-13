#!/usr/bin/env node
/** seatmesh inbox daemon — sole pane inject consumer for mesh sessions. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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
} from "@seat-mesh/tmux";
import { configureInboxTypingGate } from "./compose-gate.js";
import { createQueueStore } from "./create-queue-store.js";
import { countPeerPendingGlobal } from "./peer-pending.js";
import { findDupInbox, findDupPeer, type CheckbackRow } from "./jsonl-store.js";
import {
  orchestratorDrainTickAsync,
  type MeshOrchestratorCtx,
} from "./mesh-orchestrator.js";
import { repaintMeshPaneBorder } from "./border-paint.js";
import {
  clearOcLimitBannerForPane,
  maybeEndRateLimitEpisode,
  newConnectivityRecoveryState,
  pollConnectivityRecovery,
} from "./connectivity-recovery.js";
import {
  notifyResumeWave,
  resumeAllOpenCodePanes,
  type ResumeWaveMeta,
} from "./oc-resume.js";
import { armResumeAckWave, pollResumeAcks } from "./oc-resume-ack.js";
import {
  armCcLimitRetryCheckback,
  paneSessionFingerprint,
  parseCcLimitRetryAtMs,
} from "./cc-limit-retry.js";
import {
  drainPaneOpsOnce,
  enqueuePaneOp,
  queueAheadCount,
  type PaneOpsDrainCtx,
} from "./pane-ops-drain.js";
import type { NotifyActRegisterAction, PaneOpKind } from "@seat-mesh/core";
import {
  createNotifyActRegistry,
  executeNotifyAct,
  htmlActPage,
} from "./notify-act.js";
import { htmlDemoYesNoPage, htmlUiHome } from "./notify-act-ui.js";

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
    proxyDownActive: connectivity.proxyDownActive,
    paneOps: paneOpsCtx,
  };

  function refreshOrchConnectivity(): void {
    orchCtx.proxyDownActive = connectivity.proxyDownActive;
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

  function resumeOpenCodePanes(reason = "recovery", meta?: ResumeWaveMeta): void {
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
        const fp = paneSessionFingerprint(registry, snap);
        const at =
          parseCcLimitRetryAtMs(snap.captureTail) ?? Date.now() + 30 * 60_000;
        armCcLimitRetryCheckback(store, paneId, fp, at, log);
      },
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    try {
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
        store.cancelCheckback(id);
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
        const body = JSON.parse(raw || "{}") as Partial<import("./jsonl-store.js").PeerRow>;
        const msg = String(body.msg ?? "").trim();
        const targetPane = String(body.targetPane ?? "").trim();
        const kindRaw = String(body.kind ?? "to-slot");
        const kind: import("./jsonl-store.js").PeerKind =
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
        const dup = findDupPeer(store.readPeer(), { targetPane, msg, kind });
        if (dup) {
          log(`TO-PEER dedupe ${kind} -> ${dup.targetLabel} id=${dup.id.slice(0, 8)}`);
          return json(res, 200, { ok: true, entry: dup, deduped: true });
        }
        const row: import("./jsonl-store.js").PeerRow = {
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
        store.appendPeer(row);
        log(`TO-PEER ${kind} from=slot-${row.fromSlot} -> ${row.targetLabel}`);
        await enqueueAfterAppend("peer", row.id);
        return json(res, 200, { ok: true, entry: row });
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
        const rows: import("./jsonl-store.js").PeerRow[] = [];
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

      if (req.method === "GET" && url.pathname === "/ui") {
        return html(res, 200, htmlUiHome(port));
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
        };
        const actions = Array.isArray(body.actions) ? body.actions : [];
        if (!actions.length) {
          return json(res, 400, { ok: false, error: "actions required" });
        }
        const ttlSec = Number(body.ttlSec ?? 3600);
        const baseUrl = `http://127.0.0.1:${port}`;
        const links = actRegistry.register(actions, ttlSec, baseUrl);
        log(`NOTIFY-ACT register n=${links.length}`);
        return json(res, 200, { ok: true, links });
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
  });

  const snapRefreshMs = Math.min(pollMs, 2000);
  setInterval(scheduleHealthSnapRefresh, snapRefreshMs);
  setInterval(scheduleAutoScrape, Math.min(pollMs, 30_000));
  setInterval(scheduleDrain, pollMs);

  function onResumeAckPane(paneId: string): void {
    if (clearOcLimitBannerForPane(connectivity, paneId)) {
      maybeEndRateLimitEpisode(connectivity);
      repaintMeshPaneBorder(
        registry,
        store,
        paneId,
        {
          proxyDownActive: connectivity.proxyDownActive,
          ocLimitedPaneIds: connectivity.ocLimited,
        },
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
            {
              proxyDownActive: connectivity.proxyDownActive,
              ocLimitedPaneIds: connectivity.ocLimited,
            },
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
