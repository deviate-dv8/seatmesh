/** Brand blue ramp — logo + title share one positional gradient. */

export const BRAND_BLUE_STOPS: readonly (readonly [number, number, number])[] = [
  [147, 197, 253],
  [96, 165, 250],
  [59, 130, 246],
  [37, 99, 235],
] as const;

export const BRAND_BLUE_HEX = BRAND_BLUE_STOPS.map(
  ([r, g, b]) =>
    `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`,
);

export function terminalStyleEnabled(): boolean {
  if (process.env.NO_COLOR != null) return false;
  if (process.env.FORCE_COLOR != null && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  return Boolean(process.stdout.isTTY);
}

function sampleBrandBlue(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const stops = BRAND_BLUE_STOPS;
  const pos = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `${r};${g};${bl}`;
}

/**
 * Same vertical-first blue gradient on logo ░▒▓█ and cfonts title blocks:
 * light at top of the art, deep blue at the base row.
 */
export function tintBrandBlueGradient(text: string): string {
  if (!terminalStyleEnabled() || !text) return text;
  const lines = text.split("\n");
  const h = lines.length;
  const w = Math.max(0, ...lines.map((line) => line.length));
  return lines
    .map((line, y) => {
      const ty = h <= 1 ? 0 : y / (h - 1);
      return [...line]
        .map((ch, x) => {
          if (ch === " ") return ch;
          const tx = w <= 1 ? 0 : x / (w - 1);
          const t = ty * 0.8 + tx * 0.2;
          return `\x1b[38;2;${sampleBrandBlue(t)}m${ch}\x1b[0m`;
        })
        .join("");
    })
    .join("\n");
}

export function terminalBold(text: string): string {
  if (!terminalStyleEnabled()) return text;
  return `\x1b[1m${text}\x1b[0m`;
}

/** @deprecated use terminalStyleEnabled */
export const logoColorEnabled = terminalStyleEnabled;

/** @deprecated use tintBrandBlueGradient */
export const tintLogoBlue = tintBrandBlueGradient;
export const tintTitleBlueGradient = tintBrandBlueGradient;
