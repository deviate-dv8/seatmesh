/**
 * Seat kinds are closed. Column / instance ids are open strings from the profile.
 * Consumer column ids are config, not engine enum members.
 */

export const SEAT_KINDS = ["manager", "secretary", "worker", "mini"] as const;
export type SeatKind = (typeof SEAT_KINDS)[number];

/** Stable column id from the profile (`manager`, `lead-west`, …). */
export const COLUMN_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

export type ColumnKinds = Record<string, SeatKind>;

export function isSeatKind(v: string): v is SeatKind {
  return (SEAT_KINDS as readonly string[]).includes(v);
}

/** Compact `nameN` <-> hyphen `name-N` (any prefix + digits). */
export function expandColumnAlias(raw: string): string[] {
  const t = raw.trim().toLowerCase();
  if (!t) return [];
  const out = new Set<string>([t]);
  if (t === "master") out.add("manager");
  if (t === "mgr") out.add("manager");
  if (t === "sec") out.add("secretary");
  const compact = t.match(/^([a-z]+)(\d+)$/);
  if (compact) out.add(`${compact[1]}-${compact[2]}`);
  const hyphen = t.match(/^([a-z]+)-(\d+)$/);
  if (hyphen) out.add(`${hyphen[1]}${hyphen[2]}`);
  return [...out];
}

/**
 * Kind for a pane role / column id.
 * Profile `layout.base.kinds` wins; else prefix: secretary-* / mini-* / slot-* / worker-*;
 * any other base column id is manager-class (so N leads need no enum).
 */
export function seatKindFromId(id: string, kinds?: ColumnKinds | null): SeatKind {
  const raw = id.trim().toLowerCase();
  if (!raw) return "worker";
  if (kinds?.[raw] && isSeatKind(kinds[raw])) return kinds[raw];
  for (const alias of expandColumnAlias(raw)) {
    if (kinds?.[alias] && isSeatKind(kinds[alias])) return kinds[alias];
  }
  if (raw === "master") return "manager";
  if (raw === "manager-mini" || raw === "mini" || raw.startsWith("mini-")) return "mini";
  if (raw === "worker" || raw.startsWith("slot-") || raw.startsWith("worker-")) {
    return "worker";
  }
  if (raw === "secretary" || raw.startsWith("secretary-")) return "secretary";
  if (raw === "manager" || raw.startsWith("manager-")) return "manager";
  return "manager";
}

export function isManagerKind(id: string, kinds?: ColumnKinds | null): boolean {
  return seatKindFromId(id, kinds) === "manager";
}

export function isSecretaryKind(id: string, kinds?: ColumnKinds | null): boolean {
  return seatKindFromId(id, kinds) === "secretary";
}

export function isCoordKind(id: string, kinds?: ColumnKinds | null): boolean {
  const k = seatKindFromId(id, kinds);
  return k === "manager" || k === "secretary";
}

export function defaultCliForKind(kind: SeatKind): string {
  return kind === "secretary" ? "opencode" : "agent";
}

export interface LayoutColumnsInput {
  base?: {
    columns?: string[];
    kinds?: ColumnKinds;
    humanCoTyped?: string[];
  };
}

export function baseColumnIds(layout?: LayoutColumnsInput | null): string[] {
  const cols = layout?.base?.columns;
  return cols?.length ? [...cols] : ["manager", "secretary"];
}

export function managerColumnIds(layout?: LayoutColumnsInput | null): string[] {
  const kinds = layout?.base?.kinds;
  return baseColumnIds(layout).filter((c) => isManagerKind(c, kinds));
}

export function secretaryColumnIds(layout?: LayoutColumnsInput | null): string[] {
  const kinds = layout?.base?.kinds;
  return baseColumnIds(layout).filter((c) => isSecretaryKind(c, kinds));
}

export function primaryManagerColumn(layout?: LayoutColumnsInput | null): string {
  return managerColumnIds(layout)[0] ?? "manager";
}

export function primarySecretaryColumn(layout?: LayoutColumnsInput | null): string {
  return secretaryColumnIds(layout)[0] ?? "secretary";
}

/**
 * Base columns where a human directly co-types in the same pane as the CLI
 * (FQ-inject-co-typed-pane). Profile `layout.base.humanCoTyped` wins; unset
 * defaults to `[]` — set `layout.base.humanCoTyped` in the consumer profile.
 */
export function humanCoTypedColumnIds(layout?: LayoutColumnsInput | null): string[] {
  const explicit = layout?.base?.humanCoTyped;
  return explicit?.length ? [...explicit] : [];
}

export function isHumanCoTypedColumn(id: string, layout?: LayoutColumnsInput | null): boolean {
  const raw = id.trim().toLowerCase();
  return humanCoTypedColumnIds(layout).some((c) => c.trim().toLowerCase() === raw);
}

export function seatDirSegment(
  dirs: Record<string, string> | undefined,
  columnId: string,
): string {
  return dirs?.[columnId] ?? columnId;
}
