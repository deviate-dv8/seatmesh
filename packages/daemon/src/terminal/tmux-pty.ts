/**
 * Operator browser terminals — list panes, capture, and interactive tmux attach (WS + node-pty).
 * Peer text to agents still goes through POST /to-peer (inject), not raw send-keys from hub forms.
 *
 * Attach is opt-in and backpressured: a live tmux client on the inbox process can starve
 * health/drain if the browser floods or the pane is chatty.
 */
import { spawnSync } from "node:child_process";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import * as pty from "node-pty";
import type { LoadedProfile } from "@seat-mesh/core";
import {
  capturePaneSnapshot,
  listMeshMonitorPanes,
  paneMetaForPane,
} from "@seat-mesh/tmux";
import { paneBelongsToLoadedMesh } from "../checkback/checkback-scope.js";

export type PaneListRow = {
  paneId: string;
  label: string;
  role: string;
  slot: string;
  mini: string;
  ports: string;
  window: string;
  command: string;
};

/** Light list — no full capture-pane per row (that blocked the inbox event loop). */
export function listOperatorPanes(
  loaded: LoadedProfile,
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
  logsWindow?: string,
): PaneListRow[] {
  const rows: PaneListRow[] = [];
  const seen = new Set<string>();

  const push = (paneId: string, label: string, window: string, command = "") => {
    if (!paneId?.startsWith("%") || seen.has(paneId)) return;
    if (!paneBelongsToLoadedMesh(loaded, paneId)) return;
    seen.add(paneId);
    const meta = paneMetaForPane(paneId);
    rows.push({
      paneId,
      label,
      role: meta?.role ?? "",
      slot: meta?.slot ?? "",
      mini: meta?.mini ?? "",
      ports: meta?.ports ?? "",
      window,
      command,
    });
  };

  for (const p of listMeshMonitorPanes(session, baseWindow, workersWindow, minisWindow)) {
    push(p.paneId, p.label, baseWindow);
  }

  if (logsWindow) {
    const r = spawnSync(
      "tmux",
      [
        "list-panes",
        "-t",
        `${session}:${logsWindow}`,
        "-F",
        "#{pane_id}\t#{pane_title}\t#{pane_current_command}\t#{window_name}",
      ],
      { encoding: "utf8" },
    );
    if (r.status === 0 && r.stdout) {
      for (const line of r.stdout.split("\n")) {
        const [id, title, cmd, win] = line.split("\t");
        if (!id?.startsWith("%")) continue;
        push(id, (title?.trim() || `logs:${cmd || id}`).slice(0, 48), win || logsWindow, cmd || "");
      }
    }
  }

  return rows;
}

export function captureOperatorPane(loaded: LoadedProfile, paneId: string) {
  if (!paneId.startsWith("%") || !paneBelongsToLoadedMesh(loaded, paneId)) {
    return null;
  }
  return capturePaneSnapshot(paneId);
}

type AttachOpts = {
  session: string;
  cols: number;
  rows: number;
  window?: string;
  pane?: string;
};

const MAX_WS_BUFFER = 512 * 1024;
const MAX_ATTACH_CLIENTS = 1;
let activeAttachCount = 0;

/**
 * WebSocket /ws/tmux — read-only `tmux attach` for this mesh session.
 * Query: cols, rows, window (optional), pane (optional %id — select before attach).
 * Only one attach at a time; drops output when the browser falls behind.
 */
export function attachTmuxWebSocket(
  server: HttpServer,
  session: string,
  log: (line: string) => void,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = req.headers.host || "127.0.0.1";
    const url = new URL(req.url || "/", `http://${host}`);
    if (url.pathname !== "/ws/tmux") {
      // Leave the socket alone for other handlers; do not destroy.
      return;
    }
    const paneRaw = url.searchParams.get("pane")?.trim() || "";
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleTmuxClient(
        ws,
        {
          session,
          cols: Math.max(40, Math.min(300, Number(url.searchParams.get("cols") || 120) || 120)),
          rows: Math.max(10, Math.min(100, Number(url.searchParams.get("rows") || 36) || 36)),
          window: url.searchParams.get("window")?.trim() || undefined,
          pane: paneRaw.startsWith("%") ? paneRaw : undefined,
        },
        log,
      );
    });
  });
}

function handleTmuxClient(ws: WebSocket, opts: AttachOpts, log: (line: string) => void): void {
  if (activeAttachCount >= MAX_ATTACH_CLIENTS) {
    ws.send("\r\n[seatmesh] attach busy — disconnect the other hub terminal first\r\n");
    ws.close();
    return;
  }

  const target = opts.window ? `${opts.session}:${opts.window}` : opts.session;
  // Land on the chosen pane (if any), then read-only attach so hub keys cannot drive agents.
  const args = opts.pane
    ? ["-u", "select-pane", "-t", opts.pane, ";", "attach-session", "-r", "-t", target]
    : ["-u", "attach-session", "-r", "-t", target];

  let term: pty.IPty;
  try {
    term = pty.spawn("tmux", args, {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: process.env.HOME || process.cwd(),
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      } as Record<string, string>,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`tmux-pty spawn failed: ${msg}`);
    try {
      ws.send(`\r\n[seatmesh] PTY spawn failed: ${msg}\r\n`);
    } catch {
      /* ignore */
    }
    ws.close();
    return;
  }

  activeAttachCount += 1;
  log(
    `tmux-pty open target=${target} pane=${opts.pane ?? "-"} cols=${opts.cols} rows=${opts.rows} clients=${activeAttachCount}`,
  );

  let dropped = 0;
  term.onData((data) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > MAX_WS_BUFFER) {
      dropped += 1;
      if (dropped % 50 === 1) {
        try {
          ws.send(`\r\n\x1b[33m[seatmesh] output throttled (browser behind; dropped ${dropped})\x1b[0m\r\n`);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    try {
      ws.send(data);
    } catch {
      /* ignore */
    }
  });

  ws.on("message", (raw) => {
    const data = typeof raw === "string" ? raw : Buffer.from(raw as Buffer).toString("utf8");
    if (data.startsWith("{") && data.includes('"type"')) {
      try {
        const msg = JSON.parse(data) as { type?: string; cols?: number; rows?: number };
        if (msg.type === "resize" && msg.cols && msg.rows) {
          term.resize(
            Math.max(40, Math.min(300, msg.cols)),
            Math.max(10, Math.min(100, msg.rows)),
          );
          return;
        }
      } catch {
        /* terminal input */
      }
    }
    // Read-only attach (-r): ignore keystrokes so hub cannot raw-drive panes.
  });

  const cleanup = () => {
    try {
      term.kill();
    } catch {
      /* ignore */
    }
    if (activeAttachCount > 0) activeAttachCount -= 1;
  };

  ws.on("close", () => {
    cleanup();
    log(`tmux-pty close target=${target} clients=${activeAttachCount}`);
  });
  ws.on("error", () => cleanup());
  term.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close();
  });
}
