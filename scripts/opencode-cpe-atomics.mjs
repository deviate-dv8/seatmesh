#!/usr/bin/env node
/**
 * OC-proxy atomics (outside mesh-inbox):
 *   record  — snapshot ses_* from cmdline / @mesh_oc_session / mesh-agents
 *   kill    — kill CPE-proxied opencode for listed panes → plain terminal
 *   revive  — paste opencode-cpe.sh --session … then direct CONTINUE inject
 *   roundtrip — record → kill → revive (atomic 3 then 4)
 *
 * Usage:
 *   ./scripts/opencode-cpe-atomics.sh              # all meshes: record→kill→revive→CONTINUE
 *   node scripts/opencode-cpe-atomics.mjs record pia secretary
 *   node scripts/opencode-cpe-atomics.mjs roundtrip pia secretary
 *   node scripts/opencode-cpe-atomics.mjs roundtrip pia all-opencode-cpe
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { loadProfile } from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import {
  capturePaneSnapshot,
  injectToPane,
  isOpenCodeCpeResumeCmd,
  listMeshMonitorPanes,
  loadLaunchState,
  prepareOpenCodeForPaste,
  resolveLaunchCmd,
  resolveLiveTmuxSession,
  seatAgentEntry,
  withPaneInputEnabled,
} from "@seat-mesh/tmux";

const PORT = process.env.CPE_PROXY_PORT || "18887";
/** Must match scripts/opencode-cpe-atomics.sh + daemon DEFAULT_SES_STAMP. */
const STAMP =
  process.env.OC_PROXY_SES_STAMP || "/tmp/seatmesh-opencode-cpe-sessions.json";
const LEGACY_STAMP = "/tmp/seatmesh-oc-proxy-sessions.json";
const LOCK = process.env.OC_PROXY_ATOMICS_LOCK || "/tmp/seatmesh-oc-atomics.lock";
const CONTINUE =
  "CONTINUE after CPE revive — finish open TASKS. Stay on CPE OpenCode (opencode-cpe / :18887). Do not wait for operator.";

function resolveStampPath(preferred = STAMP) {
  if (fs.existsSync(preferred)) return preferred;
  if (preferred !== LEGACY_STAMP && fs.existsSync(LEGACY_STAMP)) return LEGACY_STAMP;
  return preferred;
}

/** Selector: all CPE seats (canonical + legacy name). */
function isAllCpeWhich(which) {
  return which === "all-opencode-cpe" || which === "all-oc-proxy" || which === "all-ocproxy";
}

const PROFILES = {
  pia: "/home/dan/Desktop/Work/pia/.sm",
  zsign: "/home/dan/Desktop/Work/zsign/.sm",
  seatmesh: "/home/dan/Desktop/Projects/seatmesh/.sm",
};

function sleepSec(sec) {
  // Sync sleep without a child process — spawnSync("sleep") dies under SIGTERM/process-group kill
  // and left atomics mid-wait with a stale lock.
  const ms = Math.max(0, Math.round(Number(sec) * 1000));
  if (ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin fallback */
    }
  }
}

function tmux(args) {
  return spawnSync("tmux", args, { encoding: "utf8" });
}

/**
 * After OC dies, SGR mouse / focus / bracketed-paste modes often stay on.
 * Mouse reports then land in zsh as `35;76;32M` → `zsh: command not found: 8M35`.
 * Reset modes + clear the line before any launch paste.
 */
function resetPaneShell(paneId) {
  tmux(["send-keys", "-t", paneId, "C-c"]);
  tmux(["send-keys", "-t", paneId, "C-c"]);
  sleepSec(0.12);
  // Literal printf — disables mouse (1000/2/3/6), focus (1004), bracketed paste (2004).
  tmux([
    "send-keys",
    "-t",
    paneId,
    "-l",
    "printf '\\033[?1000l\\033[?1002l\\033[?1003l\\033[?1006l\\033[?1004l\\033[?2004l' 2>/dev/null; stty sane 2>/dev/null; printf '\\r\\033[2K'",
  ]);
  tmux(["send-keys", "-t", paneId, "Enter"]);
  sleepSec(0.12);
  tmux(["send-keys", "-t", paneId, "C-u"]);
}

/** Exclusive pidfile — overlapping revives double-paste and cause the CSI race.
 *  Stale if pid is dead OR lock older than LOCK_TTL_MS (crash / hard-kill). */
const LOCK_TTL_MS = Number(process.env.OC_PROXY_ATOMICS_LOCK_TTL_MS || 20 * 60 * 1000);

function clearAtomicsLockIfOurs(pid = process.pid) {
  try {
    if (!fs.existsSync(LOCK)) return;
    const cur = fs.readFileSync(LOCK, "utf8").trim();
    if (cur === String(pid)) fs.unlinkSync(LOCK);
  } catch {
    /* */
  }
}

function withAtomicsLock(fn) {
  try {
    if (fs.existsSync(LOCK)) {
      const prev = fs.readFileSync(LOCK, "utf8").trim();
      const ageMs = Date.now() - fs.statSync(LOCK).mtimeMs;
      let alive = false;
      if (prev && /^\d+$/.test(prev)) {
        try {
          process.kill(Number(prev), 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      if (alive && ageMs < LOCK_TTL_MS) {
        console.error(
          `atomics already running pid=${prev} age=${Math.round(ageMs / 1000)}s — abort (avoid double-paste race)`,
        );
        process.exit(75);
      }
      console.error(
        `atomics clearing stale lock pid=${prev || "?"} age=${Math.round(ageMs / 1000)}s alive=${alive}`,
      );
      try {
        fs.unlinkSync(LOCK);
      } catch {
        /* */
      }
    }
    fs.writeFileSync(LOCK, String(process.pid));
  } catch (e) {
    console.error(`lock failed: ${e.message}`);
    process.exit(1);
  }
  // Hard-kill / process.exit safety — unlock even if body skips finally.
  const onExit = () => clearAtomicsLockIfOurs();
  process.once("exit", onExit);
  process.once("SIGINT", () => {
    clearAtomicsLockIfOurs();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    clearAtomicsLockIfOurs();
    process.exit(143);
  });
  let code = 0;
  try {
    const ret = fn();
    if (typeof ret === "number") code = ret;
  } catch (e) {
    console.error(`atomics lock body failed: ${e?.message || e}`);
    code = 1;
  } finally {
    clearAtomicsLockIfOurs();
  }
  return code;
}

function wantOcProxy(entry) {
  if (!entry) return false;
  const t = String(entry.type ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  // Config may still say oc-proxy; mesh-agents may already say opencode-cpe.
  if (t === "opencode-cpe" || t === "oc-proxy" || t === "ocproxy") return true;
  return isOpenCodeCpeResumeCmd(entry.resume_cmd);
}

function paneSes(paneId, entry) {
  const tag = tmux(["show-options", "-p", "-t", paneId, "-v", "@mesh_oc_session"]).stdout?.trim();
  if (tag?.startsWith("ses_")) return { ses: tag, source: "tag" };
  const snap = capturePaneSnapshot(paneId);
  const m = snap?.captureTail?.match(/Continue\s+opencode\s+-s\s+(ses_[A-Za-z0-9]+)/i)
    || snap?.captureTail?.match(/--session\s+(ses_[A-Za-z0-9]+)/);
  if (m?.[1]) return { ses: m[1], source: "scrollback" };
  if (entry?.resume_id?.startsWith("ses_")) return { ses: entry.resume_id, source: "mesh-agents" };
  return { ses: null, source: "none" };
}

function listTargets(meshKey, which) {
  const loaded = loadProfile(PROFILES[meshKey]);
  const session = resolveLiveTmuxSession(loaded);
  const layout = loaded.profile.layout;
  const state = loadLaunchState(loaded);
  const panes = listMeshMonitorPanes(
    session,
    layout.base.window,
    layout.workers?.window ?? "workers",
    layout.minis?.window ?? "minis",
  );
  const out = [];
  for (const p of panes) {
    const entry = seatAgentEntry(loaded, p.label, state);
    if (isAllCpeWhich(which)) {
      if (!wantOcProxy(entry)) continue;
    } else if (p.label !== which && p.label !== `slot-${which}`) {
      continue;
    }
    const { ses, source } = paneSes(p.paneId, entry);
    out.push({
      mesh: meshKey,
      profile: PROFILES[meshKey],
      workspace: loaded.workspace,
      label: p.label,
      paneId: p.paneId,
      ses,
      source,
      resume_cmd: entry?.resume_cmd ?? null,
      type: entry?.type ?? null,
    });
  }
  return { loaded, out };
}

function cmdFor(loaded, row) {
  return (
    resolveLaunchCmd(
      {
        // Prefer stamped type (oc-proxy or opencode-cpe); both normalize to CPE launch.
        type: row.type || "opencode-cpe",
        resume_id: row.ses,
        resume_cmd: row.resume_cmd,
      },
      loaded.workspace,
      loaded,
    ) ||
    `cd ${loaded.workspace} && env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor ${loaded.workspace}/scripts/opencode-cpe.sh --session ${row.ses}`
  );
}

function record(meshKey, which) {
  const { out } = listTargets(meshKey, which);
  const payload = {
    at: new Date().toISOString(),
    mesh: meshKey,
    which,
    seats: out,
  };
  fs.writeFileSync(STAMP, JSON.stringify(payload, null, 2));
  console.log(`RECORD ${out.length} → ${STAMP}`);
  for (const s of out) console.log(`  ${s.label} ${s.paneId} ses=${s.ses ?? "?"} via=${s.source}`);
  return payload;
}

function killCpeOpencodeForPanes(rows) {
  // Pane-scoped: kill OC whose --session matches stamped ses.
  // After type→opencode-cpe migration, do NOT require 18887 in environ —
  // bare OC labeled opencode-cpe must still die so revive can paste the wrapper.
  const wantSes = new Set(rows.map((r) => r.ses).filter(Boolean));
  const wantWorkspaces = new Set(rows.map((r) => r.workspace).filter(Boolean));
  let killed = 0;
  const pids = (spawnSync("pgrep", ["-f", "[o]pencode"], { encoding: "utf8" }).stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const pid of pids) {
    let env = "";
    let cmd = "";
    try {
      env = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
      cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    } catch {
      continue;
    }
    const ses = (cmd.match(/ses_[A-Za-z0-9]+/) || [])[0];
    const sesMatch = ses && wantSes.has(ses);
    const proxied = env.includes(PORT) || env.includes(`:${PORT}`);
    const inWorkspace = [...wantWorkspaces].some((w) => cmd.includes(w));
    // Prefer ses match. If stamp has ses list, require it. Proxy env optional.
    if (wantSes.size > 0) {
      if (!sesMatch) continue;
    } else if (!proxied && !inWorkspace) {
      continue;
    }
    try {
      process.kill(Number(pid), "SIGTERM");
      killed += 1;
      console.log(`KILL pid=${pid} ses=${ses ?? "?"} proxied=${proxied}`);
    } catch {
      /* */
    }
  }
  sleepSec(1);
  for (const r of rows) {
    resetPaneShell(r.paneId);
    const cmdNow = tmux([
      "display-message",
      "-t",
      r.paneId,
      "-p",
      "#{pane_current_command}",
    ]).stdout.trim();
    console.log(`SHELL ${r.label} ${r.paneId} cmd=${cmdNow}`);
  }
  console.log(`killed_cpe≈${killed} (scoped to ${wantSes.size} ses)`);
}

function revive(meshKey, which, stampPath = STAMP) {
  const stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
  const loaded = loadProfile(PROFILES[meshKey]);
  const reg = createRegistryForProfile(loaded.profile);
  let n = 0;
  for (const row of stamp.seats) {
    if (row.mesh !== meshKey) continue;
    if (!isAllCpeWhich(which) && row.label !== which) continue;
    if (!row.ses) {
      console.log(`SKIP ${row.label}: no ses in stamp`);
      continue;
    }
    const cmd = cmdFor(loaded, row);
    if (!/opencode-cpe\.sh/.test(cmd)) {
      console.log(`FAIL ${row.label}: not cpe wrapper`);
      continue;
    }
    resetPaneShell(row.paneId);
    tmux(["send-keys", "-t", row.paneId, "-l", cmd]);
    tmux(["send-keys", "-t", row.paneId, "Enter"]);
    tmux(["set-option", "-p", "-t", row.paneId, "@mesh_oc_session", row.ses]);
    console.log(`REVIVE ${row.label} ${row.paneId} ses=${row.ses}`);
    n += 1;
    sleepSec(0.25);
  }
  // wait for composers then direct CONTINUE (no inbox)
  sleepSec(
    Number(
      process.env.OC_CPE_CONTINUE_WAIT_SEC ||
        process.env.OC_PROXY_CONTINUE_WAIT_SEC ||
        6,
    ),
  );
  for (const row of stamp.seats) {
    if (row.mesh !== meshKey) continue;
    if (!isAllCpeWhich(which) && row.label !== which) continue;
    const snap = capturePaneSnapshot(row.paneId);
    if (!snap) continue;
    const prov = reg.detect(snap);
    if (!prov || prov.id !== "opencode") {
      console.log(`CONTINUE miss ${row.label}: not opencode yet`);
      continue;
    }
    withPaneInputEnabled(row.paneId, () => {
      prepareOpenCodeForPaste(row.paneId, capturePaneSnapshot);
      injectToPane(row.paneId, CONTINUE, prov.injectPlan(snap), prov.id, snap.captureTail, snap.captureTailAnsi);
    });
    console.log(`CONTINUE direct ${row.label} ${row.paneId}`);
  }
  console.log(`REVIVED=${n}`);
}

/**
 * --revive-from-stamp <path>: child process for oc-limit-v2.
 * Must NOT block mesh-inbox. Uses the same paste path as revive() (proven).
 * Groups by mesh so each seat uses its own profile / opencode-cpe.sh.
 * Ends with a verify+retry pass so pia/zsign cannot silently stay dead.
 */
function reviveFromStamp(stampPath) {
  if (!stampPath || !fs.existsSync(stampPath)) {
    console.error(`--revive-from-stamp: file not found: ${stampPath}`);
    return 1;
  }
  const data = JSON.parse(fs.readFileSync(stampPath, "utf8"));
  const seats = data.seats || [];
  const byMesh = {};
  for (const s of seats) {
    (byMesh[s.mesh] ||= []).push(s);
  }
  console.log(
    `revive-from-stamp seats=${seats.length} meshes=${Object.entries(byMesh)
      .map(([m, a]) => `${m}:${a.length}`)
      .join(" ")} fromIp=${data.fromIp} toIp=${data.toIp}`,
  );

  const loadedByMesh = new Map();
  function loadedOf(mesh) {
    if (loadedByMesh.has(mesh)) return loadedByMesh.get(mesh);
    const profileDir = PROFILES[mesh] || seats.find((s) => s.mesh === mesh)?.profileDir;
    if (!profileDir) return null;
    const loaded = loadProfile(profileDir);
    loadedByMesh.set(mesh, loaded);
    return loaded;
  }

  function pasteRevive(row) {
    if (!row.ses) {
      console.log(`SKIP ${row.mesh}/${row.label}: no ses`);
      return false;
    }
    const loaded = loadedOf(row.mesh);
    if (!loaded) {
      console.log(`FAIL ${row.mesh}/${row.label}: unknown mesh`);
      return false;
    }
    const cmd = cmdFor(loaded, row);
    if (!/opencode-cpe\.sh/.test(cmd)) {
      console.log(`FAIL ${row.mesh}/${row.label}: not cpe wrapper`);
      return false;
    }
    const cmdNow = tmux([
      "display-message",
      "-p",
      "-t",
      row.paneId,
      "#{pane_current_command}",
    ]).stdout?.trim();
    // Already live CPE-proven OC — do NOT C-c / re-paste.
    // Mesh type / resume_cmd saying opencode-cpe is NOT enough (bare OC after type migration).
    const cpeProven = (() => {
      if (!row.ses || !/opencode/i.test(cmdNow || "")) return false;
      try {
        const pids = (spawnSync("pgrep", ["-f", "[o]pencode"], { encoding: "utf8" }).stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean);
        for (const pid of pids) {
          const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
          if (!cmdline.includes(row.ses)) continue;
          const env = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
          if (env.includes(PORT) || env.includes(`:${PORT}`) || /opencode-cpe\.sh/i.test(cmdline)) {
            return true;
          }
        }
      } catch {
        /* */
      }
      return false;
    })();
    if (/opencode/i.test(cmdNow || "") && cpeProven) {
      tmux(["set-option", "-p", "-t", row.paneId, "@mesh_oc_session", row.ses]);
      console.log(`ALREADY ${row.mesh}/${row.label} ${row.paneId} cmd=${cmdNow} cpe-proven`);
      return true;
    }
    if (/opencode/i.test(cmdNow || "") && !cpeProven) {
      console.log(
        `REWRAP ${row.mesh}/${row.label} ${row.paneId}: live opencode but not CPE-proven (type=${row.type})`,
      );
    }
    // Reset mouse/focus modes first — OC leave leaves SGR reports that poison zsh.
    resetPaneShell(row.paneId);
    tmux(["send-keys", "-t", row.paneId, "-l", cmd]);
    tmux(["send-keys", "-t", row.paneId, "Enter"]);
    tmux(["set-option", "-p", "-t", row.paneId, "@mesh_oc_session", row.ses]);
    console.log(`REVIVE ${row.mesh}/${row.label} ${row.paneId} ses=${row.ses}`);
    // Stagger launches — parallel Bun/OC --version + boot OOMs under swap pressure.
    sleepSec(Number(process.env.OC_CPE_REVIVE_STAGGER_SEC || 2));
    return true;
  }

  const launched = [];
  const freshlyRevived = [];
  for (const row of seats) {
    const before = tmux([
      "display-message",
      "-p",
      "-t",
      row.paneId,
      "#{pane_current_command}",
    ]).stdout?.trim();
    const wasLive = /opencode/i.test(before || "");
    if (pasteRevive(row)) {
      launched.push(row);
      if (!wasLive) freshlyRevived.push(row);
    }
  }
  console.log(
    `REVIVED_PASS1=${launched.length}/${seats.length} fresh=${freshlyRevived.length}`,
  );

  // On IP-change revive-from-stamp: CONTINUE all launched (incl. ALREADY-live) so
  // panes pick up the new carrier. Fresh-only was leaving live OC stuck on old IP.
  const continueRows =
    process.env.OC_PROXY_CONTINUE_ALREADY === "0" ? freshlyRevived : launched;

  // Wait for composers, then CONTINUE.
  sleepSec(Number(process.env.OC_PROXY_CONTINUE_WAIT_SEC || 6));
  let continued = 0;
  const dead = [];
  for (const row of continueRows) {
    try {
      const snap = capturePaneSnapshot(row.paneId);
      const loaded = loadedOf(row.mesh);
      if (!snap || !loaded) {
        dead.push(row);
        console.log(`CONTINUE miss ${row.mesh}/${row.label}: no snap`);
        continue;
      }
      const prov = createRegistryForProfile(loaded.profile).detect(snap);
      const cmdNow = tmux([
        "display-message",
        "-p",
        "-t",
        row.paneId,
        "#{pane_current_command}",
      ]).stdout?.trim();
      if (!prov || prov.id !== "opencode") {
        dead.push(row);
        console.log(`VERIFY dead ${row.mesh}/${row.label} cmd=${cmdNow || "?"}`);
        continue;
      }
      withPaneInputEnabled(row.paneId, () => {
        prepareOpenCodeForPaste(row.paneId, capturePaneSnapshot);
        injectToPane(
          row.paneId,
          CONTINUE,
          prov.injectPlan(snap),
          prov.id,
          snap.captureTail,
          snap.captureTailAnsi,
        );
      });
      continued += 1;
      console.log(`CONTINUE ${row.mesh}/${row.label} ${row.paneId}`);
    } catch (e) {
      dead.push(row);
      console.log(`CONTINUE err ${row.mesh}/${row.label}: ${e.message}`);
    }
  }

  // Retry dead panes once — this is what previously left pia/zsign half-down.
  if (dead.length) {
    console.log(`RETRY dead=${dead.length}`);
    for (const row of dead) pasteRevive(row);
    sleepSec(Number(process.env.OC_PROXY_RETRY_WAIT_SEC || 8));
    for (const row of dead) {
      const snap = capturePaneSnapshot(row.paneId);
      const loaded = loadedOf(row.mesh);
      if (!snap || !loaded) continue;
      const prov = createRegistryForProfile(loaded.profile).detect(snap);
      if (!prov || prov.id !== "opencode") {
        console.log(`RETRY FAIL ${row.mesh}/${row.label}`);
        continue;
      }
      withPaneInputEnabled(row.paneId, () => {
        prepareOpenCodeForPaste(row.paneId, capturePaneSnapshot);
        injectToPane(row.paneId, CONTINUE, prov.injectPlan(snap), prov.id, snap.captureTail, snap.captureTailAnsi);
      });
      continued += 1;
      console.log(`RETRY CONTINUE ${row.mesh}/${row.label}`);
    }
  }

  // Final per-mesh tally (operator-visible proof).
  const tally = {};
  for (const row of seats) {
    const cmdNow = tmux(["display-message", "-p", "-t", row.paneId, "#{pane_current_command}"]).stdout?.trim();
    const live = /opencode/i.test(cmdNow || "");
    const t = (tally[row.mesh] ||= { live: 0, dead: 0 });
    if (live) t.live += 1;
    else t.dead += 1;
  }
  const summary = Object.entries(tally)
    .map(([m, t]) => `${m}=${t.live}up/${t.dead}down`)
    .join(" ");
  console.log(`DONE continued=${continued} ${summary}`);
  try {
    fs.fsyncSync(1);
  } catch {
    /* */
  }
  const anyDown = Object.values(tally).some((t) => t.dead > 0);
  // Return code — do NOT process.exit here (skips withAtomicsLock unlock).
  return anyDown ? 1 : 0;
}

if (process.argv[2] === "--revive-from-stamp") {
  const code = withAtomicsLock(() => reviveFromStamp(process.argv[3]));
  process.exit(typeof code === "number" ? code : 0);
} else {
const [action, meshKey = "pia", which = "secretary"] = process.argv.slice(2);
if (!PROFILES[meshKey]) {
  console.error(
    `usage: record|kill|revive|roundtrip <pia|zsign|seatmesh> <secretary|all-opencode-cpe|all-oc-proxy|slot-N>`,
  );
  process.exit(2);
}

if (action === "record") {
  record(meshKey, which);
} else if (action === "kill") {
  const stampPath = resolveStampPath();
  const stamp = fs.existsSync(stampPath)
    ? JSON.parse(fs.readFileSync(stampPath, "utf8"))
    : record(meshKey, which);
  const rows = stamp.seats.filter(
    (s) => s.mesh === meshKey && (isAllCpeWhich(which) || s.label === which),
  );
  killCpeOpencodeForPanes(rows);
} else if (action === "revive") {
  revive(meshKey, which, resolveStampPath());
} else if (action === "roundtrip") {
  record(meshKey, which);
  const stamp = JSON.parse(fs.readFileSync(STAMP, "utf8"));
  const rows = stamp.seats.filter(
    (s) => s.mesh === meshKey && (isAllCpeWhich(which) || s.label === which),
  );
  killCpeOpencodeForPanes(rows);
  sleepSec(2);
  revive(meshKey, which);
} else {
  console.error("action: record|kill|revive|roundtrip");
  process.exit(2);
}
}
