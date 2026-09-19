import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hostSupervisorMetaPath,
  hostSupervisorSessionsByProfilePath,
  readHostSupervisorMeta,
  type HostSupervisorMeta,
} from "./host-supervisor-meta.js";

describe("readHostSupervisorMeta", () => {
  let tmp = "";
  let prevXdg: string | undefined;

  beforeEach(() => {
    prevXdg = process.env.XDG_CONFIG_HOME;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "host-meta-"));
    process.env.XDG_CONFIG_HOME = tmp;
  });

  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("returns null when the host-supervisor has never run", () => {
    expect(readHostSupervisorMeta()).toBeNull();
  });

  it("returns null for a corrupt meta file rather than throwing", () => {
    const file = hostSupervisorMetaPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json");
    expect(readHostSupervisorMeta()).toBeNull();
  });

  it("reads back a real written meta file", () => {
    const meta: HostSupervisorMeta = {
      hostSupervisorPid: 1234,
      startedAt: "2026-09-19T00:00:00.000Z",
      rescanMs: 5000,
      sessions: [
        { profilePath: "/w/.sm/mesh.config.yaml", session: "mesh-abc", port: 31700, pid: 5678 },
      ],
    };
    const file = hostSupervisorMetaPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(meta));
    expect(readHostSupervisorMeta()).toEqual(meta);
  });
});

describe("hostSupervisorSessionsByProfilePath", () => {
  it("indexes sessions by profilePath", () => {
    const meta: HostSupervisorMeta = {
      hostSupervisorPid: 1,
      startedAt: "2026-09-19T00:00:00.000Z",
      rescanMs: 5000,
      sessions: [
        { profilePath: "/a/.sm/mesh.config.yaml", session: "mesh-a", port: 1 },
        { profilePath: "/b/.sm/mesh.config.yaml", session: "mesh-b", port: 2, pid: 99 },
      ],
    };
    const byPath = hostSupervisorSessionsByProfilePath(meta);
    expect(byPath.get("/a/.sm/mesh.config.yaml")?.session).toBe("mesh-a");
    expect(byPath.get("/b/.sm/mesh.config.yaml")?.pid).toBe(99);
    expect(byPath.get("/c/.sm/mesh.config.yaml")).toBeUndefined();
  });

  it("returns an empty map for null meta", () => {
    expect(hostSupervisorSessionsByProfilePath(null).size).toBe(0);
  });
});
