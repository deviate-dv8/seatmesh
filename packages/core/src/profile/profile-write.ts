/**
 * Safe mesh.config.yaml write for hub / CLI:
 * backup → validate full profile with MeshProfileSchema → atomic rename.
 * Patches via YAML Document so comments/unknown keys survive.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { MeshProfileSchema } from "../schema/profile.js";

export type ProfileFormPatch = {
  name?: string;
  session?: {
    name?: string;
    workerCount?: number;
    miniMax?: number;
  };
  daemon?: {
    port?: number;
    pollMs?: number;
    autoStart?: boolean;
  };
  ports?: {
    worker?: string;
  };
  layout?: {
    workers?: {
      grid?: string;
      slots?: number;
      enabled?: boolean;
    };
    minis?: {
      grid?: string;
      max?: number;
      enabled?: boolean;
    };
    logs?: {
      enabled?: boolean;
    };
  };
};

export type WriteProfileResult = {
  profilePath: string;
  backupPath: string;
  ok: true;
};

function setIfDefined(doc: YAML.Document, pathKeys: (string | number)[], value: unknown): void {
  if (value === undefined) return;
  doc.setIn(pathKeys, value);
}

/** Apply hub form fields onto an existing YAML document (preserves comments). */
export function applyProfileFormPatch(doc: YAML.Document, patch: ProfileFormPatch): void {
  setIfDefined(doc, ["name"], patch.name);
  if (patch.session) {
    setIfDefined(doc, ["session", "name"], patch.session.name);
    setIfDefined(doc, ["session", "workerCount"], patch.session.workerCount);
    setIfDefined(doc, ["session", "miniMax"], patch.session.miniMax);
  }
  if (patch.daemon) {
    setIfDefined(doc, ["daemon", "port"], patch.daemon.port);
    setIfDefined(doc, ["daemon", "pollMs"], patch.daemon.pollMs);
    setIfDefined(doc, ["daemon", "autoStart"], patch.daemon.autoStart);
  }
  if (patch.ports) {
    setIfDefined(doc, ["ports", "worker"], patch.ports.worker);
  }
  if (patch.layout?.workers) {
    setIfDefined(doc, ["layout", "workers", "grid"], patch.layout.workers.grid);
    setIfDefined(doc, ["layout", "workers", "slots"], patch.layout.workers.slots);
    setIfDefined(doc, ["layout", "workers", "enabled"], patch.layout.workers.enabled);
  }
  if (patch.layout?.minis) {
    setIfDefined(doc, ["layout", "minis", "grid"], patch.layout.minis.grid);
    setIfDefined(doc, ["layout", "minis", "max"], patch.layout.minis.max);
    setIfDefined(doc, ["layout", "minis", "enabled"], patch.layout.minis.enabled);
  }
  if (patch.layout?.logs) {
    setIfDefined(doc, ["layout", "logs", "enabled"], patch.layout.logs.enabled);
  }
}

/**
 * Validate + backup + atomic write. Throws on zod failure or IO error.
 */
export function writeProfileFormPatch(
  profilePath: string,
  patch: ProfileFormPatch,
): WriteProfileResult {
  if (!fs.existsSync(profilePath)) {
    throw new Error(`profile not found: ${profilePath}`);
  }
  const raw = fs.readFileSync(profilePath, "utf8");
  const doc = YAML.parseDocument(raw);
  applyProfileFormPatch(doc, patch);

  const nextJs = doc.toJSON() as unknown;
  const parsed = MeshProfileSchema.safeParse(nextJs);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`config invalid: ${msg}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${profilePath}.bak.${stamp}`;
  fs.copyFileSync(profilePath, backupPath);

  const text = String(doc);
  const tmp = path.join(path.dirname(profilePath), `.mesh.config.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  fs.renameSync(tmp, profilePath);

  return { profilePath, backupPath, ok: true };
}

/** Flatten loaded profile into hub form values. */
export function profileToFormValues(profile: Record<string, unknown>): ProfileFormPatch {
  const session = (profile.session ?? {}) as Record<string, unknown>;
  const daemon = (profile.daemon ?? {}) as Record<string, unknown>;
  const ports = (profile.ports ?? {}) as Record<string, unknown>;
  const layout = (profile.layout ?? {}) as Record<string, unknown>;
  const workers = (layout.workers ?? {}) as Record<string, unknown>;
  const minis = (layout.minis ?? {}) as Record<string, unknown>;
  const logs = (layout.logs ?? {}) as Record<string, unknown>;
  return {
    name: String(profile.name ?? ""),
    session: {
      name: String(session.name ?? "mesh"),
      workerCount: Number(session.workerCount ?? 6),
      miniMax: Number(session.miniMax ?? 8),
    },
    daemon: {
      port: Number(daemon.port ?? 3100),
      pollMs: Number(daemon.pollMs ?? 4000),
      autoStart: daemon.autoStart !== false,
    },
    ports: {
      worker: String(ports.worker ?? "30{n}0/30{n}1"),
    },
    layout: {
      workers: {
        grid: String(workers.grid ?? "3x2"),
        slots: Number(workers.slots ?? 6),
        enabled: workers.enabled !== false,
      },
      minis: {
        grid: String(minis.grid ?? "4x2"),
        max: Number(minis.max ?? 8),
        enabled: minis.enabled !== false,
      },
      logs: {
        enabled: logs.enabled !== false,
      },
    },
  };
}
