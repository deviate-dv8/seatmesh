import type { LoadedProfile } from "@seat-mesh/core";
import {
  armCoordExpectAfterAssign,
  formatCoordExpect,
  type ProviderRegistry,
} from "@seat-mesh/tmux";

export function coordCommand(
  loaded: LoadedProfile,
  _registry: ProviderRegistry,
  sub: string,
  args: string[],
): void {
  if (sub !== "expect") {
    throw new Error("usage: coord expect <target> <hub> <snippet...>");
  }
  const [target, hub, ...rest] = args;
  if (!target || !hub || rest.length === 0) {
    throw new Error("usage: coord expect <target> <hub> <snippet...>");
  }
  const snippet = rest.join(" ");
  armCoordExpectAfterAssign(loaded, { target, assignText: `${hub} ${snippet}` });
  console.log(`OK: coord-expect armed -> manager pane`);
  console.log(`  expect: ${formatCoordExpect(target, hub, snippet)}`);
}
