import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  entryFromLoaded,
  findGlobalSession,
  globalRegistryPath,
  loadProfile,
  profilePaths,
  readGlobalRegistry,
  sessionLabel,
  upsertGlobalSession,
  forgetGlobalSession,
  type GlobalSessionEntry,
} from "@seat-mesh/core";
import {
  listTmuxSessionNames,
  sessionAttach,
  sessionProfilePath,
  sessionWorkspaceId,
  sessionWorkspacePath,
  tmuxHasSession,
} from "@seat-mesh/tmux";
import * as clack from "@clack/prompts";
import { printSeatmeshBanner } from "../ui/banner.js";

export interface SessionRow extends GlobalSessionEntry {
  tmuxLive: boolean;
  source: "registry" | "discovered";
  /** Configured remotes.* alias on the *current* profile that points at this mesh (if any). */
  peerAlias?: string | null;
  /** Inbox HTTP /health when probed. */
  daemonUp?: boolean | null;
}

function basenameWorkspace(workspace: string): string {
  return path.basename(workspace) || workspace;
}

/** Compact path for picker (home → ~). */
export function displayDir(p: string): string {
  const abs = path.resolve(p || "");
  if (!abs || abs === ".") return p || "?";
  const home = os.homedir();
  if (abs === home) return "~";
  if (abs.startsWith(`${home}${path.sep}`)) return `~${abs.slice(home.length)}`;
  return abs;
}

function discoverFromTmux(known: Set<string>): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const tmuxName of listTmuxSessionNames()) {
    const profilePath = sessionProfilePath(tmuxName);
    const workspaceId = sessionWorkspaceId(tmuxName);
    if (!profilePath || !workspaceId) continue;
    const key = profilePath;
    if (known.has(key) || known.has(workspaceId)) continue;
    if (!fs.existsSync(profilePath)) continue;
    try {
      const loaded = loadProfile(profilePath);
      const entry = entryFromLoaded(loaded);
      rows.push({
        ...entry,
        label: sessionLabel(loaded),
        sessionName: tmuxName,
        daemonPort: profilePaths(loaded).daemonPort,
        tmuxLive: true,
        source: "discovered",
      });
      known.add(key);
      known.add(workspaceId);
    } catch {
      const workspace = sessionWorkspacePath(tmuxName) ?? "";
      rows.push({
        id: workspaceId,
        label: basenameWorkspace(workspace || profilePath),
        profilePath,
        workspace,
        workspaceId,
        sessionName: tmuxName,
        daemonPort: 0,
        lastSeen: new Date().toISOString(),
        tmuxLive: true,
        source: "discovered",
      });
      known.add(key);
      known.add(workspaceId);
    }
  }
  return rows;
}

export function listSessionRows(): SessionRow[] {
  const reg = readGlobalRegistry();
  const known = new Set<string>();
  const rows: SessionRow[] = reg.sessions.map((s) => {
    known.add(s.profilePath);
    known.add(s.id);
    const live = tmuxHasSession(s.sessionName);
    return { ...s, tmuxLive: live, source: "registry" as const };
  });
  rows.push(...discoverFromTmux(known));
  rows.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
  return rows;
}

function formatRow(row: SessionRow): string {
  const state = row.tmuxLive ? "live" : "stopped";
  return `${row.label} · ${row.sessionName} · ${state}`;
}

export function printSessionList(rows: SessionRow[]): void {
  if (!rows.length) {
    console.log("No seatmesh sessions yet.");
    console.log(`Registry: ${globalRegistryPath()}`);
    console.log("Run  npx seatmesh init  in a project, then  session up");
    return;
  }
  for (const row of rows) {
    const tag = row.source === "discovered" ? "discovered" : row.id;
    console.log(`${row.tmuxLive ? "●" : "○"}  ${formatRow(row)}  [${tag}]`);
    console.log(`    dir  ${displayDir(row.workspace)}`);
    console.log(`    sm   ${displayDir(row.profilePath)}`);
    if (row.daemonPort) console.log(`    port ${row.daemonPort}`);
    if (row.peerAlias) console.log(`    peer @${row.peerAlias}:<seat>`);
    if (row.daemonUp != null) console.log(`    daemon ${row.daemonUp ? "up" : "down"}`);
  }
}

/** Join remotes + optional /health for agent discovery (`agent sessions`). */
export async function enrichSessionRowsForAgent(
  rows: SessionRow[],
  loaded: ReturnType<typeof loadProfile>,
  opts: { probeDaemon?: boolean } = {},
): Promise<SessionRow[]> {
  const remotes = loaded.profile.remotes ?? {};
  const byProfile = new Map<string, string>();
  for (const [alias, cfg] of Object.entries(remotes)) {
    const p = path.resolve(cfg.profile);
    byProfile.set(p, alias);
    try {
      byProfile.set(path.resolve(loadProfile(cfg.profile).profilePath), alias);
    } catch {
      /* ignore bad remote */
    }
  }

  const out: SessionRow[] = [];
  for (const row of rows) {
    const peerAlias =
      byProfile.get(path.resolve(row.profilePath)) ??
      byProfile.get(path.resolve(row.workspace, ".sm")) ??
      null;
    let daemonUp: boolean | null = null;
    if (opts.probeDaemon !== false && row.daemonPort > 0) {
      daemonUp = await probeDaemonHealth(row.daemonPort);
    }
    out.push({ ...row, peerAlias, daemonUp });
  }
  return out;
}

async function probeDaemonHealth(port: number): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 800);
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ac.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Agent-safe list only — never attach/forget/register/pick. */
export async function printAgentSessionsList(
  loaded: ReturnType<typeof loadProfile>,
  opts: { json?: boolean } = {},
): Promise<void> {
  const rows = await enrichSessionRowsForAgent(listSessionRows(), loaded);
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          here: {
            name: loaded.profile.name,
            workspace: loaded.workspace,
            session: loaded.sessionName,
            remotes: Object.keys(loaded.profile.remotes ?? {}),
          },
          registry: globalRegistryPath(),
          sessions: rows,
          peer_hint: 'seatmesh agent peer @<alias>:<seat> "<msg>"',
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log("--- sessions (cross-mesh) ---");
  console.log(`here=${loaded.profile.name} session=${loaded.sessionName}`);
  const remoteKeys = Object.keys(loaded.profile.remotes ?? {});
  console.log(
    remoteKeys.length
      ? `remotes_configured=${remoteKeys.map((a) => `@${a}`).join(",")}`
      : "remotes_configured=(none — add mesh.config.yaml remotes.<alias>.profile)",
  );
  printSessionList(rows);
  console.log('peer=@<alias>:<seat>  e.g. peer @pia:secretary "FYI …"');
  console.log("operator_only=sessions attach|forget|register|pick (not via agent)");
}

export async function pickSessionRow(rows: SessionRow[]): Promise<SessionRow | null> {
  if (!rows.length) return null;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return rows[0] ?? null;
  }

  const selected = await clack.select({
    message: "Select a seatmesh session",
    options: rows.map((row) => ({
      value: row.profilePath,
      label: `${row.label} · ${row.sessionName} · ${row.tmuxLive ? "live" : "stopped"}`,
      hint: displayDir(row.workspace),
    })),
  });

  if (clack.isCancel(selected)) return null;
  return rows.find((r) => r.profilePath === selected) ?? null;
}

export async function attachSessionProfile(profilePath: string): Promise<void> {
  const loaded = loadProfile(profilePath);
  // Registry update must not delay tmux attach.
  void upsertGlobalSession(loaded);
  sessionAttach(loaded);
}

export async function runSessionsCommand(
  sub: string | undefined,
  tail: string[],
  profileArg?: string,
): Promise<number> {
  const json = tail.includes("--json");
  const rows = listSessionRows();

  if (sub === "list" || (sub === undefined && !process.stdin.isTTY)) {
    if (json) {
      console.log(JSON.stringify({ registry: globalRegistryPath(), sessions: rows }, null, 2));
    } else {
      printSeatmeshBanner("sessions");
      printSessionList(rows);
    }
    return 0;
  }

  if (sub === "register") {
    const loaded = loadProfile(profileArg);
    const entry = await upsertGlobalSession(loaded);
    if (!entry) {
      console.error("only project .sm/ profiles are registered (not bundled minimal)");
      return 1;
    }
    console.log(`OK: registered ${entry.label} (${entry.id})`);
    console.log(`  registry: ${globalRegistryPath()}`);
    return 0;
  }

  if (sub === "forget") {
    const target = tail.filter((a) => !a.startsWith("-"))[0];
    if (!target) {
      console.error("usage: sessions forget <id|profilePath|workspace>");
      return 2;
    }
    const ok = await forgetGlobalSession(target);
    console.log(ok ? `OK: removed ${target}` : `not found: ${target}`);
    return ok ? 0 : 1;
  }

  if (sub === "attach") {
    const target = tail.filter((a) => !a.startsWith("-"))[0];
    if (!target) {
      console.error("usage: sessions attach <id|profilePath>");
      return 2;
    }
    const reg = readGlobalRegistry();
    const entry = findGlobalSession(reg, target);
    const profilePath = entry?.profilePath ?? target;
    if (!fs.existsSync(profilePath)) {
      console.error(`profile not found: ${profilePath}`);
      return 1;
    }
    await attachSessionProfile(profilePath);
    return 0;
  }

  if (sub === "pick" || sub === undefined) {
    printSeatmeshBanner("sessions");
    if (!rows.length) {
      printSessionList(rows);
      return 1;
    }
    const row = await pickSessionRow(rows);
    if (!row) {
      clack.cancel("No session selected");
      return 1;
    }
    clack.log.info(`Attach ${row.label} (${row.sessionName})`);
    await attachSessionProfile(row.profilePath);
    return 0;
  }

  console.error("usage: sessions [pick|list|attach|forget] [--json]");
  return 2;
}
