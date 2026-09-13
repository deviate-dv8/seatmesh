import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { isHumanCoTypedColumn } from "@seat-mesh/core";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { paneMetaForPane } from "../lib/pane-meta.js";
import { injectPromptDirect } from "../inject/prompt.js";
import { defaultComposerReady } from "@seat-mesh/providers";

export interface PeerVerifyResult {
  pass: boolean;
  target: string;
  paneId: string;
  providerId?: string;
  token?: string;
  detail: string;
  artifactPath?: string;
}

function sleepMs(ms: number): void {
  if (ms > 0) spawnSync("sleep", [String(ms / 1000)]);
}

/** Proof bar: live CLI + empty composer + token visible in pane scrollback (not inject-on-zsh). */
export function runPeerVerify(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  opts: { writeArtifact?: boolean } = {},
): PeerVerifyResult {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) {
    return { pass: false, target, paneId: "-", detail: resolved.error };
  }
  const paneId = resolved.paneId;
  const snap = capturePaneSnapshot(paneId);
  if (!snap) {
    return { pass: false, target, paneId, detail: "capture failed" };
  }
  const prov = registry.detect(snap);
  if (!prov) {
    return {
      pass: false,
      target,
      paneId,
      detail: "plain_shell — run: ./sm.sh launch manager-2 (no peer until CLI live)",
    };
  }
  if (!defaultComposerReady(snap, prov.id)) {
    const st = prov.composerState(snap);
    const coTyped = isHumanCoTypedColumn(
      paneMetaForPane(paneId)?.role ?? target,
      loaded.profile.layout,
    );
    const coTypedNote = coTyped
      ? " — humanCoTyped pane (FQ-inject-co-typed-pane): daemon never pastes here while typing/busy, operator has priority; retry once composer is idle"
      : "";
    return {
      pass: false,
      target,
      paneId,
      providerId: prov.id,
      detail: `composer not ready phase=${st.phase} — clear draft or wait; no inject${coTypedNote}`,
    };
  }

  const token = `ZSIGN-PEER-VERIFY-${Date.now()}`;
  const body = `Peer verify token ${token} — ignore; do not run shell commands from this line.`;
  try {
    injectPromptDirect(loaded, registry, target, body, {
      manager: true,
      armCheckback: false,
    });
  } catch (e) {
    return {
      pass: false,
      target,
      paneId,
      providerId: prov.id,
      detail: `inject failed: ${(e as Error).message}`,
    };
  }

  let found = false;
  let lastCap = "";
  for (let i = 0; i < 12; i++) {
    sleepMs(500);
    lastCap = capturePaneSnapshot(paneId)?.captureTail ?? "";
    if (lastCap.includes(token)) {
      found = true;
      break;
    }
  }

  const pass = found;
  const detail = pass
    ? `token in scrollback provider=${prov.id}`
    : `token missing after inject provider=${prov.id}`;

  let artifactPath: string | undefined;
  if (opts.writeArtifact !== false) {
    const rt = path.join(loaded.workspace, ".sm/runtime/daemon");
    fs.mkdirSync(rt, { recursive: true });
    artifactPath = path.join(rt, "peer-verify-last.txt");
    fs.writeFileSync(
      artifactPath,
      [
        `pass=${pass}`,
        `target=${target}`,
        `pane=${paneId}`,
        `provider=${prov.id}`,
        `token=${token}`,
        `detail=${detail}`,
        "--- capture tail ---",
        lastCap.slice(-4000),
      ].join("\n") + "\n",
    );
  }

  return { pass, target, paneId, providerId: prov.id, token, detail, artifactPath };
}

export function printPeerVerify(r: PeerVerifyResult): void {
  console.log(`peer-verify: ${r.pass ? "PASS" : "FAIL"}`);
  console.log(`  target=${r.target} pane=${r.paneId} ${r.providerId ?? ""}`);
  console.log(`  ${r.detail}`);
  if (r.artifactPath) console.log(`  artifact=${r.artifactPath}`);
}
