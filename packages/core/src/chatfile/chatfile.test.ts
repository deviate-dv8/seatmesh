import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendSlotPrompt, querySlotPrompts, tailSlotPrompts, turnHash } from "./store.js";
import { resolveSlotKeyFromPane } from "./slot.js";
import {
  chatAgentSpeaker,
  chatHumanKind,
  formatChatTranscript,
  providerSpeakerTag,
} from "./speaker.js";
import type { PaneSnapshot } from "../providers/types.js";

describe("chatfile store", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("appends and dedupes by turnHash", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chatfile-"));
    const cfg = { root: "tasks/chat-files", filename: "CHAT.jsonl" };
    const ws = tmp;
    const base = path.join(ws, cfg.root);
    fs.mkdirSync(base, { recursive: true });

    const a = await appendSlotPrompt(ws, cfg, {
      slot: "worker-1",
      providerId: "cursor-agent",
      sessionId: "sess-1",
      model: "composer",
      humanPrompt: "fix the bug",
      agentResponse: "done",
    });
    expect(a.agent).toBe("slot-1-cursor");
    expect(a.humanKind).toBe("human");
    const b = await appendSlotPrompt(ws, cfg, {
      slot: "worker-1",
      providerId: "cursor-agent",
      sessionId: "sess-1",
      model: "composer",
      humanPrompt: "fix the bug",
      agentResponse: "done",
    });
    expect(a.id).toBe(b.id);
    const tail = await tailSlotPrompts(ws, cfg, "worker-1", 10);
    expect(tail).toHaveLength(1);
  });

  it("keeps separate records when the seat switches providers", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chatfile-"));
    const cfg = { root: "tasks/chat-files", filename: "CHAT.jsonl" };
    const ws = tmp;
    fs.mkdirSync(path.join(ws, cfg.root), { recursive: true });

    const oc = await appendSlotPrompt(ws, cfg, {
      slot: "mini-1",
      providerId: "opencode",
      sessionId: "ses_oc",
      humanPrompt: "same ask",
      agentResponse: "oc answer",
    });
    const claude = await appendSlotPrompt(ws, cfg, {
      slot: "mini-1",
      providerId: "claude",
      sessionId: "uuid-claude",
      humanPrompt: "same ask",
      agentResponse: "oc answer",
    });
    expect(oc.agent).toBe("mini-1-oc");
    expect(claude.agent).toBe("mini-1-claude");
    expect(oc.id).not.toBe(claude.id);
    const byAgent = await querySlotPrompts(ws, cfg, { agent: "mini-1-kiro" });
    expect(byAgent).toHaveLength(0);
    const ocRows = await querySlotPrompts(ws, cfg, { agent: "mini-1-oc" });
    expect(ocRows).toHaveLength(1);
  });

  it("queries by session and provider", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chatfile-"));
    const cfg = { root: "tasks/chat-files", filename: "CHAT.jsonl" };
    const ws = tmp;
    fs.mkdirSync(path.join(ws, cfg.root), { recursive: true });

    await appendSlotPrompt(ws, cfg, {
      slot: "worker-2",
      providerId: "claude",
      sessionId: "abc",
      humanPrompt: "hello",
      agentResponse: "hi",
    });
    await appendSlotPrompt(ws, cfg, {
      slot: "worker-3",
      providerId: "opencode",
      sessionId: "xyz",
      humanPrompt: "ping",
      agentResponse: "pong",
    });

    const bySession = await querySlotPrompts(ws, cfg, { sessionId: "abc" });
    expect(bySession).toHaveLength(1);
    expect(bySession[0]?.providerId).toBe("claude");
    expect(bySession[0]?.agent).toBe("slot-2-claude");

    const byProvider = await querySlotPrompts(ws, cfg, { providerId: "opencode" });
    expect(byProvider).toHaveLength(1);
    expect(byProvider[0]?.slot).toBe("worker-3");
  });

  it("marks mesh-inbox prompts as system", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chatfile-"));
    const cfg = { root: "tasks/chat-files", filename: "CHAT.jsonl" };
    const ws = tmp;
    fs.mkdirSync(path.join(ws, cfg.root), { recursive: true });
    const row = await appendSlotPrompt(ws, cfg, {
      slot: "mini-6",
      providerId: "opencode",
      humanPrompt: "[mesh-inbox] OC-PROVE-1: FYI only",
      agentResponse: "ack",
    });
    expect(row.humanKind).toBe("system");
    expect(row.agent).toBe("mini-6-oc");
    expect(formatChatTranscript(row)).toBe(
      "[system]: [mesh-inbox] OC-PROVE-1: FYI only\n[mini-6-oc]: ack",
    );
  });
});

describe("turnHash", () => {
  it("is stable for same input", () => {
    const h = turnHash({
      sessionId: "s",
      agent: "mini-1-oc",
      humanPrompt: "a",
      agentResponse: "b",
    });
    expect(h).toBe(
      turnHash({ sessionId: "s", agent: "mini-1-oc", humanPrompt: "a", agentResponse: "b" }),
    );
  });

  it("changes when agent switches", () => {
    const a = turnHash({
      sessionId: "s",
      agent: "mini-1-oc",
      humanPrompt: "a",
      agentResponse: "b",
    });
    const b = turnHash({
      sessionId: "s",
      agent: "mini-1-claude",
      humanPrompt: "a",
      agentResponse: "b",
    });
    expect(a).not.toBe(b);
  });
});

describe("speaker labels", () => {
  it("maps providers and seats", () => {
    expect(providerSpeakerTag("cursor-agent")).toBe("cursor");
    expect(providerSpeakerTag("opencode")).toBe("oc");
    expect(chatAgentSpeaker("worker-3", "kiro")).toBe("slot-3-kiro");
    expect(chatAgentSpeaker("mini-1", "opencode")).toBe("mini-1-oc");
    expect(chatHumanKind("[mesh-inbox] hi")).toBe("system");
    expect(chatHumanKind("fix the banner")).toBe("human");
  });
});

describe("resolveSlotKeyFromPane", () => {
  it("maps pane options", () => {
    const pane: PaneSnapshot = {
      paneId: "%1",
      windowName: "workers",
      cwd: "/tmp",
      currentCommand: "agent",
      captureTail: "",
      options: { mesh_role: "worker", mesh_slot: "3" },
    };
    expect(resolveSlotKeyFromPane(pane)).toBe("worker-3");
  });

  it("maps mini panes (mesh_slot mini-N + mesh_mini)", () => {
    const pane: PaneSnapshot = {
      paneId: "%15",
      windowName: "minis",
      cwd: "/tmp",
      currentCommand: "opencode",
      captureTail: "",
      options: { mesh_role: "manager-mini", mesh_slot: "mini-6", mesh_mini: "6" },
    };
    expect(resolveSlotKeyFromPane(pane)).toBe("mini-6");
  });
});
