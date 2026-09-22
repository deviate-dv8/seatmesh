import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { readGlobalRegistry, type LoadedProfile, resolveHubBaseUrl } from "@seat-mesh/core";
import {
  ensureMeshInbox,
  inboxHealthRelaxed,
  meshInboxPort,
  meshInboxStatusLine,
  probeInbox,
  tmuxHasSession,
} from "@seat-mesh/tmux";

/** Default operator hub (packages/web). Override: SEATMESH_WEB_URL / SEATMESH_HUB_URL */
export function hubBaseUrl(): string {
  return resolveHubBaseUrl();
}

function hubPortFromBase(base: string): number {
  try {
    const p = Number(new URL(base).port);
    return p || 3190;
  } catch {
    return 3190;
  }
}

function hubListening(port: number): boolean {
  const r = spawnSync(
    "sh",
    [
      "-c",
      `ss -lntp 2>/dev/null | grep -qE ':${port}\\b' || netstat -lntp 2>/dev/null | grep -qE ':${port}\\b'`,
    ],
    { encoding: "utf8" },
  );
  return r.status === 0;
}

function openBrowser(url: string): boolean {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const r = spawnSync(opener, args, { encoding: "utf8", stdio: "ignore" });
  return r.status === 0;
}

function runtimeDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.tmpdir();
  const dir = path.join(home, ".config", "seatmesh");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function webPidPath(port: number): string {
  return path.join(runtimeDir(), `web-${port}.pid`);
}

function webLogPath(port: number): string {
  return path.join(runtimeDir(), `web-${port}.log`);
}

function readPid(port: number): number | null {
  try {
    const raw = fs.readFileSync(webPidPath(port), "utf8").trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writePid(port: number, pid: number): void {
  fs.writeFileSync(webPidPath(port), `${pid}\n`, "utf8");
}

function clearPid(port: number): void {
  try {
    fs.unlinkSync(webPidPath(port));
  } catch {
    /* */
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate packages/web (@seat-mesh/web). Not published to npm — needs a seatmesh checkout.
 * Order: SEATMESH_WEB_ROOT → walk cwd → CLI monorepo neighbor → SEATMESH_ROOT/packages/web
 */
export function resolveWebRoot(): string | null {
  const envRoot = process.env.SEATMESH_WEB_ROOT?.trim();
  if (envRoot && isWebPackage(envRoot)) return path.resolve(envRoot);

  const seatmeshRoot = process.env.SEATMESH_ROOT?.trim();
  if (seatmeshRoot) {
    const cand = path.join(seatmeshRoot, "packages", "web");
    if (isWebPackage(cand)) return cand;
  }

  // Walk up from cwd
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const cand = path.join(dir, "packages", "web");
    if (isWebPackage(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // packages/cli/dist/... → packages/web
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fromCli = path.resolve(here, "..", "..", "..", "web");
    if (isWebPackage(fromCli)) return fromCli;
    const fromCliAlt = path.resolve(here, "..", "..", "web");
    if (isWebPackage(fromCliAlt)) return fromCliAlt;
  } catch {
    /* */
  }

  return null;
}

function isWebPackage(dir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      name?: string;
    };
    return pkg.name === "@seat-mesh/web" && fs.existsSync(path.join(dir, "bin"));
  } catch {
    return false;
  }
}

function killPortListeners(port: number): number {
  const r = spawnSync(
    "sh",
    [
      "-c",
      `ss -lntp 2>/dev/null | sed -n 's/.*:${port}\\b.*pid=\\([0-9][0-9]*\\).*/\\1/p' | sort -u`,
    ],
    { encoding: "utf8" },
  );
  const pids = (r.stdout || "")
    .split(/\s+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  let killed = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      killed += 1;
    } catch {
      /* */
    }
  }
  return killed;
}

export function printWebHelp(): void {
  const root = resolveWebRoot();
  console.log(`web — operator hub (packages/web) on :3190

  web status [--json]     hub URL + up/pid + sessions + daemon tips
  web up [--open]         start hub (detached) from seatmesh checkout
  web down                stop hub (pidfile + port listeners)
  web restart [--open]    down then up
  web open [path]         open hub in browser (default /)
  web url [path]          print hub URL only

Aliases: open-web → web open

Hub default: ${hubBaseUrl()}  (SEATMESH_WEB_URL to override)
Web root:    ${root ?? "(not found — clone seatmesh; or set SEATMESH_WEB_ROOT)"}
Pid/log:     ~/.config/seatmesh/web-<port>.{pid,log}

Requires a seatmesh git checkout (@seat-mesh/web is private — not on npm).
From repo: npx seatmesh web up   ·   or: npm run web

Docs: docs/cli/web.md · docs/patterns/cli-web-parity.md`);
}

function sessionHref(sessionId: string, sub = ""): string {
  const base = hubBaseUrl();
  const p = sub.startsWith("/") ? sub : sub ? `/${sub}` : "";
  return `${base}/sessions/${encodeURIComponent(sessionId)}${p}`;
}

/**
 * `loaded` is optional (TODO: `web` works from anywhere, not just inside a
 * `.sm/` workspace — it's a host-level view over the global session registry,
 * same spirit as `seatmesh host`, not tied to any one project). When null,
 * this-project-specific fields (daemon health, session shortcuts) are skipped
 * entirely rather than guessed — the global registry's session list still
 * shows every registered mesh either way.
 */
export function printWebStatus(loaded: LoadedProfile | null, opts?: { json?: boolean }): number {
  const base = hubBaseUrl();
  const hubPort = hubPortFromBase(base);
  const port = loaded ? meshInboxPort(loaded) : null;
  let probe: ReturnType<typeof probeInbox> | null = null;
  let health: ReturnType<typeof inboxHealthRelaxed> | null = null;
  let daemonUp = false;
  if (loaded && port != null) {
    ensureMeshInbox(loaded, { quiet: true });
    probe = probeInbox(port);
    health = inboxHealthRelaxed(port);
    daemonUp = Boolean(health && health.engine === "@seat-mesh/daemon");
  }
  const hubUp = hubListening(hubPort);
  const pid = readPid(hubPort);
  const pidAlive = pid != null && processAlive(pid);
  const webRoot = resolveWebRoot();

  const reg = readGlobalRegistry();
  const sessions = reg.sessions.length
    ? reg.sessions.map((s) => ({
        id: s.sessionName,
        label: s.label,
        profile: s.profilePath,
        tmuxLive: tmuxHasSession(s.sessionName),
        daemonPort: s.daemonPort,
      }))
    : loaded
      ? [
          {
            id: loaded.sessionName,
            label: loaded.profile.name,
            profile: loaded.profileDir,
            tmuxLive: tmuxHasSession(loaded.sessionName),
            daemonPort: port ?? 0,
          },
        ]
      : [];

  if (opts?.json) {
    console.log(
      JSON.stringify(
        {
          hubUrl: base,
          hubUp,
          hubPid: pidAlive ? pid : null,
          webRoot,
          profile: loaded?.profile.name ?? null,
          session: loaded?.sessionName ?? null,
          daemonPort: port,
          daemonUp,
          probe,
          health: health
            ? {
                peerUnsent: health.peerUnsent,
                inboxUnresolved: health.inboxUnresolved,
                checkbackActive: health.checkbackActive,
              }
            : null,
          sessions,
          restart: {
            hub: "npx seatmesh web restart   # or: web up / web down",
            inbox: loaded
              ? `seatmesh --profile ${loaded.profileDir} inbox restart`
              : "cd <project> && seatmesh inbox restart",
            session: "seatmesh session attach|up",
          },
          routes: [
            "/",
            "/sessions",
            ...(loaded
              ? [
                  `/sessions/${loaded.sessionName}`,
                  `/sessions/${loaded.sessionName}/ops`,
                  `/sessions/${loaded.sessionName}/queues`,
                  `/sessions/${loaded.sessionName}/terminals`,
                  `/sessions/${loaded.sessionName}/config`,
                ]
              : []),
            "/notifications",
            "/tools",
            "/mds",
          ],
        },
        null,
        2,
      ),
    );
    return daemonUp || hubUp ? 0 : 1;
  }

  console.log(`web status  hub=${base}  up=${hubUp ? "yes" : "no"}`);
  if (pidAlive) console.log(`  pid=${pid}  log=${webLogPath(hubPort)}`);
  else if (hubUp) console.log(`  pid=(unknown — listening but no pidfile)`);
  console.log(`  webRoot=${webRoot ?? "(missing — set SEATMESH_WEB_ROOT or run from seatmesh checkout)"}`);
  if (loaded) {
    console.log(`  profile=${loaded.profile.name}  session=${loaded.sessionName}`);
    console.log(`  ${meshInboxStatusLine(loaded, health)}`);
    if (!daemonUp) console.log(`  fix daemon: seatmesh inbox restart`);
  } else {
    console.log(`  (no project in cwd — this-mesh daemon status skipped; showing registry + hub only)`);
  }
  if (!hubUp) console.log(`  fix hub:    npx seatmesh web up`);
  console.log(`  open:       seatmesh web open`);
  console.log(`  sessions:   seatmesh sessions`);
  if (loaded) {
    console.log("");
    console.log("hub routes (this session):");
    console.log(`  dashboard     ${base}/`);
    console.log(`  session       ${sessionHref(loaded.sessionName)}`);
    console.log(`  ops/restart   ${sessionHref(loaded.sessionName, "/ops")}`);
    console.log(`  queues        ${sessionHref(loaded.sessionName, "/queues")}`);
    console.log(`  terminals     ${sessionHref(loaded.sessionName, "/terminals")}`);
    console.log(`  config        ${sessionHref(loaded.sessionName, "/config")}`);
    console.log(`  notifications ${base}/notifications`);
    console.log(`  tools         ${base}/tools`);
    console.log(`  mds           ${base}/mds`);
  } else {
    console.log("");
    console.log(`hub routes: ${base}/  ·  ${base}/sessions  ·  ${base}/notifications  ·  ${base}/tools  ·  ${base}/mds`);
  }
  if (sessions.length) {
    console.log("");
    console.log(`registered sessions (${sessions.length}):`);
    for (const s of sessions.slice(0, 12)) {
      const live = s.tmuxLive ? "tmux=up" : "tmux=down";
      console.log(`  ${s.id}\t${s.label}\t${live}\t:${s.daemonPort}\t${sessionHref(s.id)}`);
    }
  }
  return daemonUp || hubUp ? 0 : 1;
}

export function runWebOpen(pathArg?: string): number {
  const base = hubBaseUrl();
  const p = (pathArg ?? "/").trim() || "/";
  const url = p.startsWith("http") ? p : `${base}${p.startsWith("/") ? p : `/${p}`}`;
  console.log(`hub=${url}`);
  if (!hubListening(hubPortFromBase(base)) && !p.startsWith("http")) {
    console.error(`WARN: nothing listening on hub — start with: npx seatmesh web up`);
  }
  if (!openBrowser(url)) {
    console.error(`FAIL: could not open browser — open manually: ${url}`);
    return 1;
  }
  console.log(`OK: opened ${url}`);
  return 0;
}

export function runWebUrl(pathArg?: string): void {
  const base = hubBaseUrl();
  const p = (pathArg ?? "/").trim() || "/";
  const url = p.startsWith("http") ? p : `${base}${p.startsWith("/") ? p : `/${p}`}`;
  console.log(url);
}

export function runWebDown(): number {
  const port = hubPortFromBase(hubBaseUrl());
  const pid = readPid(port);
  let killed = 0;
  if (pid != null && processAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
      killed += 1;
    } catch {
      /* */
    }
  }
  killed += killPortListeners(port);
  // brief wait then SIGKILL leftovers
  spawnSync("sleep", ["0.4"]);
  if (pid != null && processAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* */
    }
  }
  killPortListeners(port);
  clearPid(port);
  const still = hubListening(port);
  if (still) {
    console.error(`FAIL: still listening on :${port} after down`);
    return 1;
  }
  console.log(`OK: web down :${port} killed≈${killed}`);
  return 0;
}

export function runWebUp(opts?: { open?: boolean }): number {
  const base = hubBaseUrl();
  const port = hubPortFromBase(base);
  if (hubListening(port)) {
    const pid = readPid(port);
    console.log(
      `OK: web already up :${port}${pid && processAlive(pid) ? ` pid=${pid}` : ""} hub=${base}`,
    );
    if (opts?.open) runWebOpen("/");
    return 0;
  }

  const root = resolveWebRoot();
  if (!root) {
    console.error(
      "FAIL: packages/web not found — @seat-mesh/web is private (not on npm).\n" +
        "  Clone seatmesh, cd into it, then: npx seatmesh web up\n" +
        "  Or set SEATMESH_WEB_ROOT=/path/to/seatmesh/packages/web",
    );
    return 1;
  }

  const logPath = webLogPath(port);
  const logFd = fs.openSync(logPath, "a");
  fs.writeSync(logFd, `\n=== web up ${new Date().toISOString()} port=${port} root=${root} ===\n`);

  const child = spawn("npm", ["run", "dev"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_URL: base,
    },
  });
  fs.closeSync(logFd);
  if (!child.pid) {
    console.error("FAIL: could not spawn npm run dev for packages/web");
    return 1;
  }
  child.unref();
  writePid(port, child.pid);

  // Wait until listening (ace/vite can take a few seconds)
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 25_000) {
    if (hubListening(port)) {
      up = true;
      break;
    }
    if (!processAlive(child.pid)) break;
    spawnSync("sleep", ["0.4"]);
  }

  if (!up) {
    console.error(`FAIL: web did not listen on :${port} within 25s — see ${logPath}`);
    return 1;
  }
  console.log(`OK: web up :${port} pid=${child.pid} hub=${base}`);
  console.log(`  root=${root}`);
  console.log(`  log=${logPath}`);
  if (opts?.open) runWebOpen("/");
  return 0;
}

export function runWebRestart(opts?: { open?: boolean }): number {
  runWebDown();
  spawnSync("sleep", ["0.5"]);
  return runWebUp(opts);
}

export async function runWebCommand(
  loaded: LoadedProfile | null,
  sub: string | undefined,
  tail: string[],
): Promise<number> {
  const json = tail.includes("--json") || sub === "--json";
  const openFlag = tail.includes("--open");
  const action = !sub || sub === "--json" ? "help" : sub;
  if (action === "help" || action === "-h" || action === "--help") {
    printWebHelp();
    return 0;
  }
  if (action === "status") return printWebStatus(loaded, { json });
  if (action === "up" || action === "start") return runWebUp({ open: openFlag });
  if (action === "down" || action === "stop") return runWebDown();
  if (action === "restart") return runWebRestart({ open: openFlag });
  if (action === "open") {
    return runWebOpen(tail.find((a) => !a.startsWith("-")));
  }
  if (action === "url") {
    runWebUrl(tail.find((a) => !a.startsWith("-")));
    return 0;
  }
  console.error(`usage: web status|up|down|restart|open|url|help`);
  return 2;
}
