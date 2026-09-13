import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MeshProfile } from "../schema/profile.js";
import { resolveFromWorkspace } from "../paths.js";
import { resolveHarnessPath } from "../paths-manifest.js";
import type { LoadedProfile } from "../profile.js";
import { appendJsonlLine, readJsonlAll, readJsonlTail } from "../jsonl/store.js";
import {
  RoomMessageSchema,
  RoomProfileSchema,
  type RoomKind,
  type RoomMessage,
  type RoomMessageKind,
  type RoomProfile,
} from "./types.js";
import { isGlobalSlug } from "./global.js";
import YAML from "yaml";
import { armCheckback, inboxHealthy } from "./inbox-client.js";

export interface ChatRoomConfig {
  root: string;
  /** When set (via chatRoomConfigForLoaded), used instead of workspace-relative root. */
  rootAbs?: string;
  globalSlug: string;
  checkbackDuration: string;
  checkbackRenew: string;
  checkbackCallPendingDuration: string;
  checkbackCallPendingRenew: string;
  inboxBase: string;
}

export function chatRoomConfig(profile: MeshProfile): ChatRoomConfig {
  const cr = profile.chatRooms;
  return {
    root: cr?.root ?? "chat-rooms",
    globalSlug: cr?.globalSlug ?? "global",
    checkbackDuration: cr?.checkback?.duration ?? "5m",
    checkbackRenew: cr?.checkback?.renew ?? "3m",
    checkbackCallPendingDuration: cr?.checkback?.callPending?.duration ?? "1m",
    checkbackCallPendingRenew: cr?.checkback?.callPending?.renew ?? "1m",
    inboxBase: `http://127.0.0.1:${profile.daemon?.port ?? 31670}`,
  };
}

export function chatRoomConfigForLoaded(loaded: LoadedProfile): ChatRoomConfig {
  const cfg = chatRoomConfig(loaded.profile);
  return { ...cfg, rootAbs: resolveHarnessPath(loaded, cfg.root) };
}

export function roomDir(workspace: string, cfg: ChatRoomConfig, slug: string): string {
  const root = cfg.rootAbs ?? resolveFromWorkspace(workspace, cfg.root);
  return path.join(root, slug);
}

export function roomDirForLoaded(loaded: LoadedProfile, slug: string): string {
  return roomDir(loaded.workspace, chatRoomConfigForLoaded(loaded), slug);
}

export function roomLogPath(roomPath: string): string {
  return path.join(roomPath, "ROOM.jsonl");
}

export function roomProfilePath(roomPath: string): string {
  return path.join(roomPath, "profile.yaml");
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function parseRoomRow(row: unknown): RoomMessage | null {
  const parsed = RoomMessageSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

export function loadRoomProfile(roomPath: string): RoomProfile | null {
  const p = roomProfilePath(roomPath);
  if (!fs.existsSync(p)) return null;
  const raw = YAML.parse(fs.readFileSync(p, "utf8"));
  return RoomProfileSchema.parse(raw);
}

export function saveRoomProfile(roomPath: string, profile: RoomProfile): void {
  ensureDir(roomPath);
  fs.writeFileSync(roomProfilePath(roomPath), YAML.stringify(profile));
}

export interface CreateRoomInput {
  workspace: string;
  cfg: ChatRoomConfig;
  slug: string;
  createdBy: string;
  kind?: RoomKind;
  scope?: string;
  members?: string[];
  lead?: string;
  leads?: string[];
  supervisor?: string;
}

export function createRoom(input: CreateRoomInput): RoomProfile {
  const kind = input.kind ?? "contract";
  if (input.slug === input.cfg.globalSlug && kind !== "global") {
    throw new Error(`slug "${input.cfg.globalSlug}" is reserved for the global room`);
  }
  const dir = roomDir(input.workspace, input.cfg, input.slug);
  if (fs.existsSync(roomLogPath(dir))) {
    throw new Error(`room already exists: ${input.slug}`);
  }
  ensureDir(dir);
  const profile: RoomProfile = {
    slug: input.slug,
    kind,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    scope: input.scope,
    members: input.members ?? [],
    lead: input.lead,
    leads: input.leads,
    supervisor: input.supervisor,
  };
  saveRoomProfile(dir, profile);
  fs.writeFileSync(roomLogPath(dir), "");
  return profile;
}

/** Create or refresh a contract room profile (idempotent for contract on). */
export function upsertContractRoom(input: CreateRoomInput): RoomProfile {
  const kind = input.kind ?? "contract";
  if (input.slug === input.cfg.globalSlug && kind !== "global") {
    throw new Error(`slug "${input.cfg.globalSlug}" is reserved for the global room`);
  }
  const dir = roomDir(input.workspace, input.cfg, input.slug);
  ensureDir(dir);
  const existing = loadRoomProfile(dir);
  const profile: RoomProfile = {
    slug: input.slug,
    kind,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    createdBy: existing?.createdBy ?? input.createdBy,
    scope: input.scope ?? existing?.scope,
    members: input.members ?? existing?.members ?? [],
    lead: input.lead ?? existing?.lead,
    leads: input.leads ?? existing?.leads,
    supervisor: input.supervisor ?? existing?.supervisor,
  };
  saveRoomProfile(dir, profile);
  if (!fs.existsSync(roomLogPath(dir))) {
    fs.writeFileSync(roomLogPath(dir), "");
  }
  return profile;
}

/** Lazy-create the workspace global room (all tmux agents are implicit members). */
export function ensureGlobalRoom(workspace: string, cfg: ChatRoomConfig): RoomProfile {
  const slug = cfg.globalSlug;
  const dir = roomDir(workspace, cfg, slug);
  if (fs.existsSync(roomLogPath(dir))) {
    const existing = loadRoomProfile(dir);
    if (existing) return existing;
  }
  return createRoom({
    workspace,
    cfg,
    slug,
    createdBy: "system",
    kind: "global",
    scope: "All tmux agents (implicit membership)",
    supervisor: "secretary",
  });
}

export interface SayOptions {
  kind?: RoomMessageKind;
  expectReply?: boolean;
  armCheckback?: boolean;
  ownerPane?: string;
  senderPane?: string;
  ownerMini?: string | number | null;
  ownerSlot?: string | number | null;
}

export interface SayResult {
  message: RoomMessage;
  checkback?: { ok: boolean; skipped?: boolean; reason?: string };
}

export async function sayInRoom(
  workspace: string,
  cfg: ChatRoomConfig,
  slug: string,
  from: string,
  body: string,
  opts: SayOptions = {},
): Promise<SayResult> {
  if (isGlobalSlug(cfg, slug)) {
    ensureGlobalRoom(workspace, cfg);
  }
  const dir = roomDir(workspace, cfg, slug);
  if (!fs.existsSync(dir)) {
    throw new Error(`room not found: ${slug} (create with: seatmesh room create ${slug})`);
  }

  const kind = opts.kind ?? inferKind(body);
  const expectReply = opts.expectReply ?? looksLikeExpectsReply(body);
  const ts = new Date().toISOString();

  const message: RoomMessage = RoomMessageSchema.parse({
    id: randomUUID(),
    ts,
    from,
    kind,
    body: stampActionableBody(ts, normalizeBody(body, kind), kind),
    pane: opts.ownerPane,
    expectReply,
  });

  await appendJsonlLine(roomLogPath(dir), message);

  let checkbackResult: SayResult["checkback"];
  const shouldArm = opts.armCheckback !== false;
  if (shouldArm && opts.ownerPane) {
    const expect = `chat-room:${slug} peer update (${kind})`;
    checkbackResult = await armCheckback({
      inboxBase: cfg.inboxBase,
      ownerPane: opts.ownerPane,
      expect,
      duration: cfg.checkbackDuration,
      renew: cfg.checkbackRenew,
      kind: "room-comms",
      senderPane: opts.senderPane ?? opts.ownerPane,
      ownerMini: opts.ownerMini,
      ownerSlot: opts.ownerSlot,
    });
    if (!checkbackResult.ok && !checkbackResult.skipped) {
      const healthy = await inboxHealthy(cfg.inboxBase);
      if (!healthy) {
        checkbackResult = {
          ok: false,
          skipped: true,
          reason: "inbox-server down (room line saved; arm checkback when up)",
        };
      }
    }
  }

  return { message, checkback: checkbackResult };
}

/** Daemon-only: append room line without arming checkback (sync; single writer). */
export function sayInRoomSync(
  workspace: string,
  cfg: ChatRoomConfig,
  slug: string,
  from: string,
  body: string,
  opts: Pick<SayOptions, "kind" | "expectReply"> = {},
): RoomMessage {
  if (isGlobalSlug(cfg, slug)) {
    ensureGlobalRoom(workspace, cfg);
  }
  const dir = roomDir(workspace, cfg, slug);
  if (!fs.existsSync(dir)) {
    throw new Error(`room not found: ${slug}`);
  }
  const kind = opts.kind ?? inferKind(body);
  const ts = new Date().toISOString();
  const message: RoomMessage = RoomMessageSchema.parse({
    id: randomUUID(),
    ts,
    from,
    kind,
    body: stampActionableBody(ts, normalizeBody(body, kind), kind),
    expectReply: opts.expectReply ?? false,
  });
  const file = roomLogPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
  fs.appendFileSync(file, `${JSON.stringify(message)}\n`, "utf8");
  return message;
}

export async function tailRoom(
  workspace: string,
  cfg: ChatRoomConfig,
  slug: string,
  lines = 50,
): Promise<RoomMessage[]> {
  if (isGlobalSlug(cfg, slug)) {
    ensureGlobalRoom(workspace, cfg);
  }
  const file = roomLogPath(roomDir(workspace, cfg, slug));
  if (!fs.existsSync(file)) {
    throw new Error(`room not found: ${slug}`);
  }
  return readJsonlTail(file, lines, parseRoomRow);
}

/** Full room history (ndjson stream parse). */
export async function readRoom(
  workspace: string,
  cfg: ChatRoomConfig,
  slug: string,
): Promise<RoomMessage[]> {
  const file = roomLogPath(roomDir(workspace, cfg, slug));
  if (!fs.existsSync(file)) {
    throw new Error(`room not found: ${slug}`);
  }
  return readJsonlAll(file, parseRoomRow);
}

export function listRooms(workspace: string, cfg: ChatRoomConfig): string[] {
  const root = resolveFromWorkspace(workspace, cfg.root);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function inferKind(body: string): RoomMessageKind {
  const u = body.trim().toUpperCase();
  if (u.startsWith("BROADCAST:")) return "broadcast";
  if (u.startsWith("CLAIMED:") || u.startsWith("CLAIM:")) return "claim";
  if (u.startsWith("DONE:")) return "done";
  if (u.startsWith("BLOCKED:")) return "blocked";
  if (u.startsWith("FYI:")) return "fyi";
  if (u.startsWith("STATUS:") || /^STATUS\b/.test(u)) return "status";
  return "msg";
}

function normalizeBody(body: string, kind: RoomMessageKind): string {
  const t = body.trim();
  if (kind === "claim" && !/^CLAIM(ED)?:/i.test(t)) return `CLAIMED: ${t}`;
  if (kind === "done" && !/^DONE:/i.test(t)) return `DONE: ${t}`;
  if (kind === "blocked" && !/^BLOCKED:/i.test(t)) return `BLOCKED: ${t}`;
  if (kind === "broadcast" && !/^BROADCAST:/i.test(t)) return `BROADCAST: ${t}`;
  return t;
}

/** Actionable ledger lines carry [@ts] for supervise/tail progress checks. */
export function stampActionableBody(ts: string, body: string, kind: RoomMessageKind): string {
  if (kind !== "done" && kind !== "blocked" && kind !== "claim") return body;
  if (/\[@\d{4}-\d{2}-\d{2}T/.test(body)) return body;
  const compact = ts.replace(/\.\d{3}Z$/, "Z");
  return `${body} [@${compact}]`;
}

/** Human-assistant phrasing often implies a reply that never comes from peer agents. */
export function looksLikeExpectsReply(body: string): boolean {
  const t = body.trim();
  if (/\?$/.test(t)) return true;
  if (/^(would you|can you|should i|do you want|let me know|please confirm)/i.test(t)) return true;
  return false;
}
