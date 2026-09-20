import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadedProfile } from "../profile/profile.js";
import type { MeshProfile } from "../schema/profile.js";
import { workspaceScopeId, resolveSessionName } from "../paths/runtime-paths.js";
import {
  assignCampaign,
  createCampaign,
  findCampaign,
  noteCampaign,
  readCampaigns,
  reduceCampaignEvents,
  setCampaignStatus,
  type CampaignEvent,
} from "./campaigns.js";

function stubProfile(): MeshProfile {
  return {
    name: "test",
    workspace: ".",
    session: { name: "mesh", scope: "workspace", idLength: 6, workerCount: 4, miniMax: 4 },
    seats: { root: "seats", templates: ["FOCUS"], dirs: {} as MeshProfile["seats"]["dirs"] },
    state: { agentsJson: "a.json", meshAgentsJson: "m.json" },
    roles: { dir: "roles" },
    providers: ["empty"],
  } as MeshProfile;
}

function stubLoaded(workspace: string): LoadedProfile {
  const profile = stubProfile();
  return {
    profile,
    profileDir: path.join(workspace, ".sm"),
    profilePath: path.join(workspace, ".sm", "mesh.config.yaml"),
    workspace,
    workspaceId: workspaceScopeId(workspace),
    sessionName: resolveSessionName(profile, workspace),
  };
}

describe("reduceCampaignEvents", () => {
  it("folds create + assign + status + note into current state", () => {
    const events: CampaignEvent[] = [
      { at: "2026-01-01T00:00:00.000Z", kind: "create", id: "cmp-1", title: "t1", objective: "obj" },
      { at: "2026-01-01T00:01:00.000Z", kind: "assign", id: "cmp-1", assignee: "worker-1" },
      { at: "2026-01-01T00:02:00.000Z", kind: "note", id: "cmp-1", note: "in progress", by: "worker-1" },
      { at: "2026-01-01T00:03:00.000Z", kind: "status", id: "cmp-1", status: "done" },
    ];
    const byId = reduceCampaignEvents(events);
    const c = byId.get("cmp-1");
    expect(c).toBeDefined();
    expect(c?.title).toBe("t1");
    expect(c?.objective).toBe("obj");
    expect(c?.assignee).toBe("worker-1");
    expect(c?.status).toBe("done");
    expect(c?.doneAt).toBe("2026-01-01T00:03:00.000Z");
    expect(c?.notes).toEqual([{ at: "2026-01-01T00:02:00.000Z", by: "worker-1", note: "in progress" }]);
  });

  it("is order-independent (sorts by at before folding)", () => {
    const events: CampaignEvent[] = [
      { at: "2026-01-01T00:02:00.000Z", kind: "status", id: "cmp-1", status: "done" },
      { at: "2026-01-01T00:00:00.000Z", kind: "create", id: "cmp-1", title: "t1" },
    ];
    const byId = reduceCampaignEvents(events);
    expect(byId.get("cmp-1")?.status).toBe("done");
  });

  it("ignores a duplicate create (first wins)", () => {
    const events: CampaignEvent[] = [
      { at: "2026-01-01T00:00:00.000Z", kind: "create", id: "cmp-1", title: "first" },
      { at: "2026-01-01T00:01:00.000Z", kind: "create", id: "cmp-1", title: "second" },
    ];
    expect(reduceCampaignEvents(events).get("cmp-1")?.title).toBe("first");
  });

  it("ignores an event for an id that was never created", () => {
    const events: CampaignEvent[] = [
      { at: "2026-01-01T00:00:00.000Z", kind: "assign", id: "ghost", assignee: "worker-1" },
    ];
    expect(reduceCampaignEvents(events).size).toBe(0);
  });
});

describe("campaigns store (jsonl round trip)", () => {
  let tmp = "";
  let loaded: LoadedProfile;

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  function setup(): void {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "campaigns-"));
    loaded = stubLoaded(tmp);
  }

  it("create -> readCampaigns round-trips a single open campaign", async () => {
    setup();
    const created = await createCampaign(loaded, { title: "ship the thing", objective: "green CI" });
    const all = await readCampaigns(loaded);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: created.id,
      title: "ship the thing",
      objective: "green CI",
      status: "open",
    });
  });

  it("findCampaign returns null for an unknown id", async () => {
    setup();
    expect(await findCampaign(loaded, "cmp-doesnotexist")).toBeNull();
  });

  it("assign + note + done are all reflected on read", async () => {
    setup();
    const c = await createCampaign(loaded, { title: "t" });
    await assignCampaign(loaded, c.id, "worker-2", "manager");
    await noteCampaign(loaded, c.id, "halfway there", "worker-2");
    await setCampaignStatus(loaded, c.id, "done", "worker-2");
    const found = await findCampaign(loaded, c.id);
    expect(found?.assignee).toBe("worker-2");
    expect(found?.status).toBe("done");
    expect(found?.doneAt).toBeDefined();
    expect(found?.notes).toHaveLength(1);
  });

  it("readCampaigns returns most-recently-created first", async () => {
    setup();
    const a = await createCampaign(loaded, { title: "a" });
    await new Promise((r) => setTimeout(r, 2));
    const b = await createCampaign(loaded, { title: "b" });
    const all = await readCampaigns(loaded);
    expect(all.map((c) => c.id)).toEqual([b.id, a.id]);
  });

  it("returns [] when no campaigns.jsonl exists yet", async () => {
    setup();
    expect(await readCampaigns(loaded)).toEqual([]);
  });
});
