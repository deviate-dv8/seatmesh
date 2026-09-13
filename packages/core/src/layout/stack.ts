import type { BaseColumn, MeshLayout } from "../schema/layout.js";
import { managerColumnIds } from "../schema/seat-kind.js";

/** Manager-kind columns from layout (any ids; not a manager-N enum). */
export function effectiveManagerStack(layout: MeshLayout): BaseColumn[] {
  return managerColumnIds(layout);
}

export function stackIncludes(layout: MeshLayout, role: BaseColumn): boolean {
  return effectiveManagerStack(layout).includes(role);
}
