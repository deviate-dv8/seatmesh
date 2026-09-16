/** Mark metadata — visual source of truth is SeatmeshMark.vue / seatmesh-mark.svg */

export const SEATMESH_MARK_INK = {
  cols: 64,
  rows: 64,
  bands: 4,
} as const

/** Light green — matches Open Sessions / primary (300→600). */
export const SEATMESH_GREEN_STOPS = ['#86efac', '#4ade80', '#22c55e', '#16a34a'] as const

/** @deprecated use SEATMESH_GREEN_STOPS */
export const SEATMESH_TEAL_STOPS = SEATMESH_GREEN_STOPS

export function sampleGreen(t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const stops = SEATMESH_GREEN_STOPS
  const pos = clamped * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(pos))
  const f = pos - i
  const a = stops[i]!
  const b = stops[i + 1]!
  const parse = (hex: string) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ] as const
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  const r = Math.round(ar + (br - ar) * f)
  const g = Math.round(ag + (bg - ag) * f)
  const bl = Math.round(ab + (bb - ab) * f)
  return `rgb(${r} ${g} ${bl})`
}

/** @deprecated use sampleGreen */
export const sampleTeal = sampleGreen
