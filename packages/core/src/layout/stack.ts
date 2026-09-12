import type { BaseColumn, MeshLayout } from "../schema/layout.js";

/** Manager coord columns from layout (manager + optional manager-2). */
export function effectiveManagerStack(layout: MeshLayout): BaseColumn[] {
  return layout.base.columns.filter((c) => c === "manager" || c === "manager-2");
}

export function stackIncludes(layout: MeshLayout, role: BaseColumn): boolean {
  return effectiveManagerStack(layout).includes(role);
}
