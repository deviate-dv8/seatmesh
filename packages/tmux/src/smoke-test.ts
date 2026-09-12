import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { meshRuntimePaths, type LoadedProfile } from "@seat-mesh/core";
import { createRegistryForProfile, formatOpenCodeResumeCommand } from "@seat-mesh/providers";
import { snapshotConnectivity } from "@seat-mesh/connectivity";
import { inboxHealth, meshInboxPort } from "./comms/inbox-bridge.js";
import { resolvePaneTarget } from "./lib/resolve-pane.js";
import { capturePaneSnapshot, listSessionPanes } from "./lib/snapshot.js";
import { verifyMeshSession } from "./session/verify.js";
import { tmuxHasSession } from "./lib/tmux-run.js";
import { listWindowPaneIds } from "./session/window-panes.js";
import { buildColdStartBrief } from "./seats/cold-start.js";
import { gateQueuePath } from "./seats/seat-paths.js";
import { ensureSeatFiles } from "./seats/seat-init.js";
import { runWhoami } from "./agents/whoami.js";

export interface SmokeResult {
  name: string;
  pass: boolean;
  detail: string;
}

function row(name: string, pass: boolean, detail: string): SmokeResult {
  return { name, pass, detail };
}

function testOcLimitRegex(): SmokeResult {
  const samples = [
    { text: "rate limit exceeded", want: true },
    { text: "Cannot connect to API", want: true },
    { text: "Working on task", want: false },
  ];
  const ocLimit = /rate limit|usage limit|limit reached|too many requests/i;
  const ocConn = /cannot connect to api|unable to connect/i;
  for (const s of samples) {
    const hit = ocLimit.test(s.text) || ocConn.test(s.text);
    if (hit !== s.want) {
      return row("oc-limit-regex", false, `mismatch on "${s.text}"`);
    }
  }
  return row("oc-limit-regex", true, "limit/connect patterns OK");
}

function testProviderScan(loaded: LoadedProfile): SmokeResult {
  const reg = createRegistryForProfile(loaded.profile);
  const session = loaded.sessionName;
  const panes = listSessionPanes(session);
  if (!panes.length) return row("providers-scan", false, "no panes");
  let live = 0;
  let limits = 0;
  for (const paneId of panes) {
    const snap = capturePaneSnapshot(paneId);
    if (!snap) continue;
    const prov = reg.detect(snap);
    if (!prov) continue;
    live++;
    const st = prov.composerState(snap);
    if (st.phase === "limit") limits++;
  }
  return row(
    "providers-scan",
    live > 0,
    `${live} live CLI panes, ${limits} limit/connect signals`,
  );
}

function testPaneTargets(loaded: LoadedProfile): SmokeResult {
  const session = loaded.sessionName;
  const targets = [
    "manager",
    "secretary",
    ...Array.from({ length: loaded.profile.session.workerCount }, (_, i) => String(i + 1)),
    ...Array.from({ length: loaded.profile.session.miniMax }, (_, i) => `mini-${i + 1}`),
  ];
  const missing: string[] = [];
  for (const t of targets) {
    const r = resolvePaneTarget(t, loaded);
    if ("error" in r) missing.push(`${t}:${r.error}`);
  }
  return row(
    "pane-targets",
    missing.length === 0,
    missing.length ? missing.slice(0, 4).join("; ") : `resolved ${targets.length} targets`,
  );
}

function testMeshInbox(loaded: LoadedProfile): SmokeResult {
  const port = meshInboxPort(loaded);
  const h = inboxHealth(port);
  if (!h) return row("mesh-inbox", false, "mesh-inbox DOWN — ./sm.sh reload or ./sm.sh inbox");
  if (h.engine !== "seat-mesh-daemon") {
    return row(
      "mesh-inbox",
      false,
      `port :${port} is not seat-mesh-daemon (engine=${String(h.engine ?? "?")})`,
    );
  }
  const session = String(h.session ?? "");
  const want = loaded.sessionName;
  if (session !== want) {
    return row("mesh-inbox", false, `session=${session} want ${want}`);
  }
  const workerN = Number(h.workerPanes ?? 0);
  const miniN = Number(h.miniPanes ?? 0);
  const ok =
    workerN === loaded.profile.session.workerCount &&
    miniN === loaded.profile.session.miniMax;
  return row(
    "mesh-inbox",
    ok,
    `:${port} workers=${workerN} minis=${miniN} ocLimit=${h.ocLimitActive ?? 0} secretary=${String(h.secretaryPane ?? "none")}`,
  );
}

function testInboxSupervisor(loaded: LoadedProfile): SmokeResult {
  if (loaded.profile.daemon?.watch === false) {
    return row("inbox-supervisor", true, "watch disabled in profile");
  }
  const metaPath = meshRuntimePaths(loaded).meshInboxMeta;
  if (!fs.existsSync(metaPath)) {
    return row("inbox-supervisor", false, "mesh-inbox.json missing");
  }
  let meta: { supervisorPid?: number; watch?: boolean; hmr?: boolean };
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as typeof meta;
  } catch {
    return row("inbox-supervisor", false, "mesh-inbox.json unreadable");
  }
  const sup = meta.supervisorPid ?? 0;
  const alive =
    sup > 0 &&
    spawnSync("kill", ["-0", String(sup)], { stdio: "ignore" }).status === 0;
  return row(
    "inbox-supervisor",
    alive && meta.watch === true,
    alive
      ? `supervisorPid=${sup} watch=${String(meta.watch)} hmr=${String(meta.hmr)}`
      : `supervisor not running (pid=${sup || "?"})`,
  );
}

function testSecretaryPane(loaded: LoadedProfile): SmokeResult {
  const r = resolvePaneTarget("secretary", loaded);
  if ("error" in r) {
    return row("secretary-pane", false, r.error);
  }
  const snap = capturePaneSnapshot(r.paneId);
  const hasCli = Boolean(snap && createRegistryForProfile(loaded.profile).detect(snap));
  return row(
    "secretary-pane",
    hasCli,
    hasCli ? `live CLI on ${r.paneId}` : `pane ${r.paneId} is plain shell — ./sm.sh secretary start`,
  );
}

async function testProxy(loaded: LoadedProfile): Promise<SmokeResult> {
  const snap = await snapshotConnectivity(loaded.profile);
  const listen = snap.proxyListen;
  return row(
    "proxy-cpe",
    listen,
    listen
      ? `proxy :${snap.proxyPort} up carrier=${snap.carrierIp ?? "?"}`
      : "CPE proxy not listening — OC limits will not recover",
  );
}

function testWifiProbe(loaded: LoadedProfile): SmokeResult {
  const script = `${loaded.workspace}/scripts/cpe-wifi-probe.sh`;
  const r = spawnSync("bash", [script, "--check"], {
    encoding: "utf8",
    cwd: loaded.workspace,
    timeout: 15_000,
  });
  const detail = (r.stdout || r.stderr || "").trim().split("\n").pop() ?? `exit ${r.status ?? 1}`;
  return row("wifi-cpe-probe", r.status === 0, detail);
}

function testOcSessionIds(loaded: LoadedProfile): SmokeResult {
  const reg = createRegistryForProfile(loaded.profile);
  const session = loaded.sessionName;
  const panes = listSessionPanes(session);
  let ocTotal = 0;
  let badStored = 0;
  let unresolved = 0;
  const sesRe = /^ses_[A-Za-z0-9]+$/;
  for (const paneId of panes) {
    const snap = capturePaneSnapshot(paneId);
    if (!snap) continue;
    const prov = reg.detect(snap);
    if (prov?.id !== "opencode") continue;
    ocTotal++;
    const stored = snap.options.mesh_oc_session?.trim() ?? "";
    if (stored && !sesRe.test(stored)) badStored++;
    if (!formatOpenCodeResumeCommand(snap)) unresolved++;
  }
  const pass = ocTotal > 0 && badStored === 0 && unresolved === 0;
  return row(
    "oc-session-ids",
    pass,
    ocTotal
      ? `${ocTotal} panes, bad_stored=${badStored}, no_resume_cmd=${unresolved}`
      : "no opencode panes (skip)",
  );
}

function testOcAgents(loaded: LoadedProfile): SmokeResult {
  const reg = createRegistryForProfile(loaded.profile);
  const session = loaded.sessionName;
  const panes = listSessionPanes(session);
  let ocTotal = 0;
  let connectErr = 0;
  let limit = 0;
  let ok = 0;
  const ocLimit = /rate limit|usage limit|limit reached|too many requests/i;
  const ocConn = /cannot connect to api|unable to connect|socket connection was closed/i;
  for (const paneId of panes) {
    const snap = capturePaneSnapshot(paneId);
    if (!snap) continue;
    const prov = reg.detect(snap);
    if (prov?.id !== "opencode") continue;
    ocTotal++;
    const tail = snap.captureTail;
    if (ocLimit.test(tail)) limit++;
    else if (ocConn.test(tail)) connectErr++;
    else ok++;
  }
  const pass = ocTotal > 0 && connectErr === 0;
  return row(
    "oc-agents",
    pass,
    ocTotal
      ? `${ok} ok, ${connectErr} connect_err, ${limit} limit (${ocTotal} opencode panes)`
      : "no opencode panes in session",
  );
}

function testColdStartHub(loaded: LoadedProfile): SmokeResult {
  const init = ensureSeatFiles(loaded);
  const gq = gateQueuePath(loaded);
  if (!fs.existsSync(gq)) {
    return row("cold-start-hub", false, "GATE-QUEUE.md missing after ensureSeatFiles");
  }
  const miniDir = path.join(
    loaded.workspace,
    loaded.profile.seats.root,
    (loaded.profile.seats.dirs?.mini ?? "mini-{n}").replace("{n}", "1"),
  );
  if (!fs.existsSync(path.join(miniDir, "FOCUS.md"))) {
    return row("cold-start-hub", false, `mini-1 FOCUS missing (${miniDir})`);
  }
  const brief = buildColdStartBrief(loaded, runWhoami(loaded, "slot-1"));
  const ok =
    brief.includes("GATE-QUEUE") &&
    brief.includes("OPEN TASKS") &&
    brief.includes("NO chat reply");
  return row(
    "cold-start-hub",
    ok,
    ok
      ? `ensure created=${init.created.length}; brief=${brief.length} chars`
      : "buildColdStartBrief missing required sections",
  );
}

export async function runMeshSmoke(loaded: LoadedProfile): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  if (!tmuxHasSession(loaded.sessionName)) {
    results.push(row("session", false, `session ${loaded.sessionName} missing`));
    return results;
  }
  results.push(row("session", true, loaded.sessionName));

  const verify = verifyMeshSession(loaded);
  results.push(
    row(
      "layout",
      !verify.some((v) => v.level === "error"),
      verify.length ? verify.map((v) => v.message).join("; ") : "OK",
    ),
  );

  results.push(testOcLimitRegex());
  results.push(testPaneTargets(loaded));
  results.push(testColdStartHub(loaded));
  results.push(testProviderScan(loaded));
  results.push(testMeshInbox(loaded));
  results.push(testInboxSupervisor(loaded));
  results.push(testSecretaryPane(loaded));
  if (loaded.profile.connectivity?.enabled) {
    results.push(testWifiProbe(loaded));
  }
  results.push(await testProxy(loaded));
  results.push(testOcAgents(loaded));
  results.push(testOcSessionIds(loaded));
  return results;
}

export function printSmokeResults(results: SmokeResult[]): boolean {
  let fail = 0;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name} — ${r.detail}`);
    if (!r.pass) fail++;
  }
  console.log(`--- smoke: ${results.length - fail}/${results.length} passed`);
  return fail === 0;
}
