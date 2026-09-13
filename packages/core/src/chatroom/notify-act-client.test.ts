import { describe, expect, it } from "vitest";
import {
  formatNotifyActLinksForToast,
  yesNoNotifyActActions,
} from "./notify-act-client.js";

describe("formatNotifyActLinksForToast", () => {
  it("returns HTML anchors only (no duplicate plain URL lines)", () => {
    const links = [
      { label: "Yes", url: "http://127.0.0.1:31670/act/v1/a", token: "a" },
      { label: "No", url: "http://127.0.0.1:31670/act/v1/b", token: "b" },
    ];
    const out = formatNotifyActLinksForToast(links);
    expect(out).toContain('<a href="http://127.0.0.1:31670/act/v1/a">Yes</a>');
    expect(out).toContain('<a href="http://127.0.0.1:31670/act/v1/b">No</a>');
    expect(out).not.toMatch(/Yes:\s*http/);
    expect(out).not.toContain("\n\n");
  });
});

describe("yesNoNotifyActActions", () => {
  it("defaults Yes and No peer to secretary", () => {
    const actions = yesNoNotifyActActions({ yesMsg: "Dan notify reply: YES" });
    expect(actions).toHaveLength(2);
    expect(actions[0]?.type).toBe("peer");
    expect(actions[1]?.type).toBe("peer");
    expect(actions[0]?.params.target).toBe("secretary");
    expect(actions[1]?.params.target).toBe("secretary");
    expect(actions[1]?.params.msg).toBe("Dan notify reply: NO");
  });
});
