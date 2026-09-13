import fs from "node:fs";
import YAML from "yaml";
import type { LoadedProfile } from "./profile.js";
import { COLUMN_ID_RE } from "./schema/seat-kind.js";

/**
 * Programmatic edits to `mesh.config.yaml`'s `layout.base.columns` (+ the optional
 * per-column `cli` / `humanCoTyped` maps). N managers/secretaries are config, not
 * an enum (see docs/ARCHITECTURE.md "Coordinator columns") -- these helpers are the
 * one supported way to add/remove a column so nobody hand-edits the yaml array or
 * cargo-cults a per-instance `seats.dirs` entry that `seatDirSegment` already
 * defaults to identity for.
 */

export interface AddColumnOptions {
  /** CLI provider override for this column (default: agent, or opencode for secretary-kind). */
  cli?: string;
  /** Insert immediately after this existing column id (default: append at end). */
  after?: string;
  /** Add to `layout.base.humanCoTyped` (daemon queues injects while the human types). */
  coTyped?: boolean;
}

export interface ColumnEditResult {
  id: string;
  columns: string[];
  profilePath: string;
}

function normalizeId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  if (!COLUMN_ID_RE.test(trimmed)) {
    throw new Error(`bad column id: ${id} (want ${COLUMN_ID_RE})`);
  }
  return trimmed;
}

function readColumnsSeq(doc: YAML.Document): YAML.YAMLSeq {
  const columns = doc.getIn(["layout", "base", "columns"]);
  if (!YAML.isSeq(columns)) {
    throw new Error("layout.base.columns missing or not a sequence in profile yaml");
  }
  return columns;
}

function seqStrings(seq: YAML.YAMLSeq): string[] {
  return seq.items.map((n) => String(YAML.isScalar(n) ? n.value : n));
}

const MAX_BASE_COLUMNS = 128;

export function addBaseColumn(
  loaded: LoadedProfile,
  rawId: string,
  opts: AddColumnOptions = {},
): ColumnEditResult {
  const id = normalizeId(rawId);
  const doc = YAML.parseDocument(fs.readFileSync(loaded.profilePath, "utf8"));
  const columns = readColumnsSeq(doc);
  const existing = seqStrings(columns);

  if (existing.includes(id)) throw new Error(`column already exists: ${id}`);
  if (existing.length >= MAX_BASE_COLUMNS) {
    throw new Error(`base columns at max (${MAX_BASE_COLUMNS})`);
  }

  let insertAt = columns.items.length;
  if (opts.after) {
    const afterId = normalizeId(opts.after);
    const idx = existing.indexOf(afterId);
    if (idx === -1) throw new Error(`--after column not found: ${afterId}`);
    insertAt = idx + 1;
  }
  columns.items.splice(insertAt, 0, doc.createNode(id));

  if (opts.cli) {
    doc.setIn(["layout", "base", "cli", id], opts.cli);
  }

  if (opts.coTyped) {
    const coTyped = doc.getIn(["layout", "base", "humanCoTyped"]);
    if (YAML.isSeq(coTyped)) {
      if (!seqStrings(coTyped).includes(id)) coTyped.items.push(doc.createNode(id));
    } else {
      doc.setIn(["layout", "base", "humanCoTyped"], [id]);
    }
  }

  fs.writeFileSync(loaded.profilePath, doc.toString());
  return { id, columns: seqStrings(readColumnsSeq(doc)), profilePath: loaded.profilePath };
}

export function removeBaseColumn(loaded: LoadedProfile, rawId: string): ColumnEditResult {
  const id = normalizeId(rawId);
  const doc = YAML.parseDocument(fs.readFileSync(loaded.profilePath, "utf8"));
  const columns = readColumnsSeq(doc);
  const existing = seqStrings(columns);

  const idx = existing.indexOf(id);
  if (idx === -1) throw new Error(`column not found: ${id}`);
  if (columns.items.length <= 1) throw new Error("cannot remove the last base column");
  columns.items.splice(idx, 1);

  const cli = doc.getIn(["layout", "base", "cli"]);
  if (YAML.isMap(cli)) cli.delete(id);

  const coTyped = doc.getIn(["layout", "base", "humanCoTyped"]);
  if (YAML.isSeq(coTyped)) {
    const hIdx = seqStrings(coTyped).indexOf(id);
    if (hIdx !== -1) coTyped.items.splice(hIdx, 1);
  }

  const dirs = doc.getIn(["seats", "dirs"]);
  if (YAML.isMap(dirs)) dirs.delete(id);

  fs.writeFileSync(loaded.profilePath, doc.toString());
  return { id, columns: existing.filter((c) => c !== id), profilePath: loaded.profilePath };
}

export function listBaseColumns(loaded: LoadedProfile): string[] {
  const doc = YAML.parseDocument(fs.readFileSync(loaded.profilePath, "utf8"));
  return seqStrings(readColumnsSeq(doc));
}
