/**
 * Merge-only new mesh.config.yaml keys on `seatmesh update`.
 * Never overwrites user-set values. Marks new keys with `# added by seatmesh update`.
 */
import fs from "node:fs";
import YAML from "yaml";
import type { LoadedProfile } from "@seat-mesh/core";

export interface MeshConfigMergeResult {
  /** Human-readable keys that were (or would be) added. */
  added: string[];
  profilePath: string;
  wrote: boolean;
}

function seqStrings(seq: YAML.YAMLSeq): string[] {
  return seq.items.map((n) => String(YAML.isScalar(n) ? n.value : n));
}

function annotateAddedKeys(yamlText: string, keys: string[]): string {
  let out = yamlText;
  if (keys.includes("layout.base.humanCoTyped")) {
    out = out.replace(
      /^([ \t]*humanCoTyped:)/m,
      "    # added by seatmesh update\n$1",
    );
  }
  if (keys.includes("layout.logs")) {
    out = out.replace(/^([ \t]*logs:)/m, "  # added by seatmesh update\n$1");
  }
  if (keys.includes("todos")) {
    out = out.replace(/^todos:/m, "# added by seatmesh update\ntodos:");
  }
  if (keys.includes("ppa")) {
    out = out.replace(/^ppa:/m, "# added by seatmesh update\nppa:");
  }
  if (keys.includes("acks")) {
    out = out.replace(/^acks:/m, "# added by seatmesh update\nacks:");
  }
  if (keys.includes("targets")) {
    out = out.replace(/^targets:/m, "# added by seatmesh update\ntargets:");
  }
  return out;
}

/**
 * Insert missing layout/policy keys into an older profile.
 * Never overwrites existing values.
 */
export function mergeMeshConfigOnUpdate(
  loaded: LoadedProfile,
  dryRun = false,
): MeshConfigMergeResult {
  const profilePath = loaded.profilePath;
  const added: string[] = [];
  if (!fs.existsSync(profilePath)) {
    return { added, profilePath, wrote: false };
  }

  const raw = fs.readFileSync(profilePath, "utf8");
  const doc = YAML.parseDocument(raw);

  if (doc.getIn(["layout"]) == null) {
    return { added, profilePath, wrote: false };
  }

  if (doc.getIn(["layout", "base", "humanCoTyped"]) == null) {
    const columnsNode = doc.getIn(["layout", "base", "columns"]);
    const columns = YAML.isSeq(columnsNode) ? seqStrings(columnsNode) : ["manager", "secretary"];
    const preferred = ["manager", "secretary"].filter((c) => columns.includes(c));
    const value = preferred.length > 0 ? preferred : columns.slice(0, 1);
    doc.setIn(["layout", "base", "humanCoTyped"], value);
    added.push("layout.base.humanCoTyped");
  }

  if (doc.getIn(["layout", "logs"]) == null) {
    doc.setIn(["layout", "logs"], {
      window: "logs",
      index: 9,
      enabled: true,
    });
    added.push("layout.logs");
  }

  if (doc.getIn(["todos"]) == null) {
    doc.setIn(["todos"], {
      reportTo: "manager",
      checkback: {
        duration: "20m",
        renew: "10m",
        min: "20m",
      },
    });
    added.push("todos");
  } else if (doc.getIn(["todos", "checkback", "min"]) == null) {
    doc.setIn(["todos", "checkback", "min"], "20m");
    added.push("todos.checkback.min");
  }

  if (doc.getIn(["chatRooms", "checkback", "maxFires"]) == null) {
    doc.setIn(["chatRooms", "checkback", "maxFires"], 3);
    added.push("chatRooms.checkback.maxFires");
  }

  if (doc.getIn(["chatRooms", "thinNotify"]) == null) {
    doc.setIn(["chatRooms", "thinNotify"], { minInterval: "5m" });
    added.push("chatRooms.thinNotify");
  }

  if (doc.getIn(["ppa"]) == null) {
    doc.setIn(["ppa"], { idleSlackSec: 120 });
    added.push("ppa");
  }

  if (doc.getIn(["acks"]) == null) {
    doc.setIn(["acks"], {
      redirect: {
        ttlMin: 45,
        rewriteTo: "secretary",
        block: "*managers",
      },
    });
    added.push("acks");
  }

  if (doc.getIn(["targets"]) == null) {
    doc.setIn(["targets"], { triageTo: ["manager", "secretary"] });
    added.push("targets");
  }

  if (added.length === 0) {
    return { added, profilePath, wrote: false };
  }

  if (!dryRun) {
    fs.writeFileSync(profilePath, annotateAddedKeys(doc.toString(), added));
  }

  return { added, profilePath, wrote: !dryRun };
}
