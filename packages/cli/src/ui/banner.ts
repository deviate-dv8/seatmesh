import boxen from "boxen";
import cfonts from "cfonts";
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
};

const TITLE_FONT = "block";

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

/** Brand header: logo + title + optional centered tagline. */
export function printSeatmeshBanner(opts?: string | BannerOpts): void {
  const { subtitle, tagline: taglineOpt } = resolveBannerOpts(opts);
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
}
