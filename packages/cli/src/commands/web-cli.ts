import { spawnSync } from "node:child_process";
import { readGlobalRegistry, type LoadedProfile } from "@seat-mesh/core";
import {
  ensureMeshInbox,
  inboxHealthRelaxed,
  meshInboxPort,
  meshInboxStatusLine,
  probeInbox,
  tmuxHasSession,
} from "@seat-mesh/tmux";

/** Default operator hub (packages/web). Override: SEATMESH_WEB_URL */
export function hubBaseUrl(): string {
  const env = process.env.SEATMESH_WEB_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  return "http://127.0.0.1:3190";
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

export function printWebHelp(): void {
  console.log(`web — operator hub (packages/web) parity with CLI

  web status [--json]     hub URL + sessions + daemon health + restart tips
  web open [path]         open hub in browser (default /)
  web url [path]          print hub URL only

Aliases: open-web → web open

Hub default: ${hubBaseUrl()}  (SEATMESH_WEB_URL to override)
Start hub:   npm run web   # from seatmesh repo → :3190
Restart inbox (this mesh):  seatmesh inbox restart
All meshes:  seatmesh sessions

Parity map: docs/patterns/cli-web-parity.md`);
}

function sessionHref(sessionId: string, sub = ""): string {
  const base = hubBaseUrl();
  const p = sub.startsWith("/") ? sub : sub ? `/${sub}` : "";
  return `${base}/sessions/${encodeURIComponent(sessionId)}${p}`;
}

export function printWebStatus(loaded: LoadedProfile, opts?: { json?: boolean }): number {
  const base = hubBaseUrl();
  const hubPort = hubPortFromBase(base);
  const port = meshInboxPort(loaded);
  ensureMeshInbox(loaded, { quiet: true });
  const probe = probeInbox(port);
  const health = inboxHealthRelaxed(port);
  const daemonUp = Boolean(health && health.engine === "@seat-mesh/daemon");
  const hubUp = hubListening(hubPort);

  const reg = readGlobalRegistry();
  const sessions = reg.sessions.length
    ? reg.sessions.map((s) => ({
        id: s.sessionName,
        label: s.label,
        profile: s.profilePath,
        tmuxLive: tmuxHasSession(s.sessionName),
        daemonPort: s.daemonPort,
      }))
    : [
        {
          id: loaded.sessionName,
          label: loaded.profile.name,
          profile: loaded.profileDir,
          tmuxLive: tmuxHasSession(loaded.sessionName),
          daemonPort: port,
        },
      ];

  if (opts?.json) {
    console.log(
      JSON.stringify(
        {
          hubUrl: base,
          hubUp,
          profile: loaded.profile.name,
          session: loaded.sessionName,
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
            hub: "npm run web   # packages/web → :3190",
            inbox: `seatmesh --profile ${loaded.profileDir} inbox restart`,
            session: "seatmesh session attach|up",
          },
          routes: [
            "/",
            "/sessions",
            `/sessions/${loaded.sessionName}`,
            `/sessions/${loaded.sessionName}/ops`,
            `/sessions/${loaded.sessionName}/queues`,
            `/sessions/${loaded.sessionName}/terminals`,
            `/sessions/${loaded.sessionName}/config`,
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
  console.log(`  profile=${loaded.profile.name}  session=${loaded.sessionName}`);
  console.log(`  ${meshInboxStatusLine(loaded, health)}`);
  if (!daemonUp) console.log(`  fix daemon: seatmesh inbox restart`);
  if (!hubUp) console.log(`  fix hub:    npm run web   # from seatmesh checkout → ${base}`);
  console.log(`  open:       seatmesh web open`);
  console.log(`  sessions:   seatmesh sessions`);
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
    console.error(`WARN: nothing listening on hub — start with: npm run web`);
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

export async function runWebCommand(
  loaded: LoadedProfile,
  sub: string | undefined,
  tail: string[],
): Promise<number> {
  const json = tail.includes("--json") || sub === "--json";
  const action = !sub || sub === "--json" ? "help" : sub;
  if (action === "help" || action === "-h" || action === "--help") {
    printWebHelp();
    return 0;
  }
  if (action === "status") return printWebStatus(loaded, { json });
  if (action === "open") {
    return runWebOpen(tail.find((a) => !a.startsWith("-")));
  }
  if (action === "url") {
    runWebUrl(tail.find((a) => !a.startsWith("-")));
    return 0;
  }
  console.error(`usage: web status|open|url|help`);
  return 2;
}
