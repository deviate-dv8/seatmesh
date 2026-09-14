import boxen from "boxen";
import cfonts from "cfonts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderLogoMark } from "./logo-art.js";
import { terminalStyleEnabled, tintBrandBlueGradient } from "./logo-color.js";

export const SEATMESH_TAGLINE = "tmux multi-agent workbench";

type CfontsOut = { string: string };

type CfontsOpts = {
  font: string;
  align?: "left" | "center" | "right";
  letterSpacing?: number;
  lineHeight?: number;
  maxLength?: string;
  gradient?: string[] | false;
  transitionGradient?: boolean;
  colors?: string[];
  env?: "node" | "browser";
};

export type BannerOpts = {
  subtitle?: string;
  /** Shown centered under the title block (default text: SEATMESH_TAGLINE). */
  tagline?: boolean | string;
  /** Print even if this terminal already saw the logo. */
  force?: boolean;
};

const TITLE_FONT = "block";

/** Stamp TTL — new login / long-lived pts still get a fresh logo occasionally. */
const BANNER_STAMP_TTL_MS = 12 * 60 * 60 * 1000;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderCfonts(text: string, opts: CfontsOpts): string {
  const out = cfonts.render(text, {
    align: "left",
    letterSpacing: 1,
    lineHeight: 1,
    maxLength: "0",
    env: "node",
    background: "transparent",
    spaceless: true,
    ...opts,
  }) as CfontsOut | false;
  if (!out) return text;
  return out.string.trimEnd();
}

function visibleWidth(line: string): number {
  return stripAnsi(line).length;
}

function blockWidth(block: string): number {
  if (!block) return 0;
  return Math.max(0, ...block.split("\n").map(visibleWidth));
}

function centerBlock(block: string, width: number): string {
  if (!block) return "";
  const lines = block.split("\n");
  const blockW = blockWidth(block);
  const left = Math.max(0, Math.floor((width - blockW) / 2));
  const prefix = " ".repeat(left);
  return lines.map((line) => prefix + line).join("\n");
}

function centerPlain(text: string, width: number): string {
  const left = Math.max(0, Math.floor((width - text.length) / 2));
  return `${" ".repeat(left)}${text}`;
}

function dim(text: string): string {
  if (!terminalStyleEnabled()) return text;
  return `\x1b[2m${text}\x1b[0m`;
}

function frameSubtitle(subtitle: string): string {
  return boxen(subtitle, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 1, bottom: 0, left: 0, right: 0 },
    borderStyle: "round",
    dimBorder: true,
  });
}

function renderTitleRaw(): string {
  return renderCfonts("seatmesh", {
    font: TITLE_FONT,
    lineHeight: 0,
    gradient: false,
    colors: terminalStyleEnabled() ? ["white"] : [],
  });
}

function resolveBannerOpts(opts?: string | BannerOpts): BannerOpts {
  if (typeof opts === "string") return { subtitle: opts };
  return opts ?? {};
}

function bannerCacheDir(): string {
  if (process.env.SEATMESH_BANNER_CACHE_DIR?.trim()) {
    return process.env.SEATMESH_BANNER_CACHE_DIR.trim();
  }
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "seatmesh", "banner-once");
}

/** Stable id for this terminal: tmux pane, else tty device. */
export function terminalBannerKey(): string {
  const pane = process.env.TMUX_PANE?.trim();
  if (pane) return `tmux:${pane}`;
  const r = spawnSync("tty", { encoding: "utf8" });
  const tty = (r.stdout ?? "").trim();
  if (r.status === 0 && tty && tty !== "not a tty") return `tty:${tty}`;
  // Non-interactive / piped — treat as always-plain (no logo spam in scripts).
  return "";
}

function bannerStampPath(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._+-]/g, "_");
  return path.join(bannerCacheDir(), `${safe}.stamp`);
}

/**
 * First call in this terminal → true (and marks shown). Later calls → false.
 * SEATMESH_BANNER=1 force show; =0 force skip. Empty key (no tty) → false.
 */
export function consumeTerminalBannerSlot(): boolean {
  const force = process.env.SEATMESH_BANNER?.trim();
  if (force === "0" || force === "false" || force === "off") return false;
  if (force === "1" || force === "true" || force === "always") return true;

  const key = terminalBannerKey();
  if (!key) return false;

  const stamp = bannerStampPath(key);
  try {
    const st = fs.statSync(stamp);
    if (Date.now() - st.mtimeMs < BANNER_STAMP_TTL_MS) return false;
  } catch {
    /* missing — first show */
  }
  try {
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, `${new Date().toISOString()}\n`);
  } catch {
    /* still show once even if stamp fails */
  }
  return true;
}

/** Whether this invocation should print the brand logo (once per terminal). */
export function shouldPrintSeatmeshBanner(force = false): boolean {
  if (force) return true;
  return consumeTerminalBannerSlot();
}

/**
 * Brand header: logo + title + optional centered tagline.
 * Once per terminal (TTY / tmux pane) unless `force` or SEATMESH_BANNER=1.
 * Returns true if the logo was printed.
 */
export function printSeatmeshBanner(opts?: string | BannerOpts): boolean {
  const resolved = resolveBannerOpts(opts);
  if (!shouldPrintSeatmeshBanner(Boolean(resolved.force))) return false;

  const { subtitle, tagline: taglineOpt } = resolved;
  const tagline =
    taglineOpt === true
      ? SEATMESH_TAGLINE
      : typeof taglineOpt === "string"
        ? taglineOpt
        : undefined;

  const logoRaw = renderLogoMark();
  const titleRaw = stripAnsi(renderTitleRaw());
  const titleWidth = blockWidth(titleRaw);

  let logoOut = "";
  let titleOut = titleRaw;

  if (terminalStyleEnabled()) {
    const stack = logoRaw ? `${logoRaw}\n\n${titleRaw}` : titleRaw;
    const colored = tintBrandBlueGradient(stack);
    const lines = colored.split("\n");
    if (logoRaw) {
      const logoLines = logoRaw.split("\n").length;
      logoOut = centerBlock(lines.slice(0, logoLines).join("\n"), titleWidth);
      titleOut = lines.slice(logoLines + 1).join("\n");
    } else {
      titleOut = colored;
    }
  } else if (logoRaw) {
    logoOut = centerBlock(logoRaw, titleWidth);
  }

  if (logoOut) {
    console.log(logoOut);
    console.log("");
  }
  console.log(titleOut);
  if (tagline) {
    console.log(dim(centerPlain(tagline, titleWidth)));
  }
  if (subtitle) console.log(frameSubtitle(subtitle));
  console.log("");
  return true;
}
