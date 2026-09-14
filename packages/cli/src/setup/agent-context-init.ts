import path from "node:path";
import {
  SM_DIR,
  dotSmDirFromConfig,
  findDotSmConfig,
  type LoadedProfile,
} from "@seat-mesh/core";
import {
  enqueueColdStart,
  ensureMeshInbox,
  labelMeshSession,
  liveMeshSession,
  printAgentContext,
  runWhoami,
  validateAllRoleIndexes,
} from "@seat-mesh/tmux";
import { ensureAgentsCliDoc, ensureMissingRoleTemplates, runInit } from "./init.js";

export function runAgentContextInit(
  loaded: LoadedProfile,
  opts: { coldStartInject?: boolean } = {},
): number {
  const workspace = loaded.workspace;
  const cfg = findDotSmConfig(workspace);
  if (!cfg) {
    runInit({ workspace });
  } else {
    ensureMissingRoleTemplates(dotSmDirFromConfig(cfg));
  }

  const smDir = cfg ? dotSmDirFromConfig(cfg) : path.join(workspace, SM_DIR);
  const agentsDoc = ensureAgentsCliDoc(smDir, { workspace, forceRefresh: true });
  if (agentsDoc.created.length || agentsDoc.refreshed.length) {
    console.log(
      `OK: AGENTS.md ${[...agentsDoc.created, ...agentsDoc.refreshed].map((p) => path.relative(workspace, p) || p).join(", ")}`,
    );
  }

  const validation = validateAllRoleIndexes(loaded);
  let allOk = validation.ok;
  for (const fail of validation.failures) {
    console.error(
      `WARN: role=${fail.kind} missing paths:\n${fail.missing.map((m) => `  - ${m}`).join("\n")}`,
    );
  }

  console.log("--- agent context init ---");
  console.log("1. Read every path under read_first (in order) for your role.");
  console.log("2. Run seatmesh agent whoami - hub + open TASKS inline.");
  console.log("3. Workers: stamp seat FOCUS; minis: seatmesh agent mini done when slice done.");
  console.log("4. Run seatmesh agent for scoped can/cannot on this pane.");
  console.log("fix_missing=edit .sm/roles/*.yaml or add files under workspace root");

  ensureMeshInbox(loaded, { quiet: true });
  console.log("OK: inbox daemon ensured");

  const w = runWhoami(loaded);
  if (w.inTmux && w.session) {
    labelMeshSession(loaded, liveMeshSession(loaded));
    console.log("OK: labels refreshed (tmux session)");
  }

  if (opts.coldStartInject) {
    const r = enqueueColdStart(loaded, "here", { mini: null, force: false });
    console.log(
      r.skipped
        ? `OK: cold-start inject skipped (idempotent) fingerprint=${r.fingerprint}`
        : `OK: cold-start inject enqueued fingerprint=${r.fingerprint}`,
    );
  }

  console.log("");
  const paneOk = printAgentContext(loaded);
  return allOk && paneOk === 0 ? 0 : 1;
}
