import { describe, expect, it } from "vitest";
import {
  cleanUrl,
  formatNotifyActLinksForToast,
  formatOperatorDecideMsg,
  formatYesNoToastBody,
  yesNoNotifyActActions,
} from "./notify-act-client.js";

describe("cleanUrl", () => {
  it("trims trailing spaces and junk", () => {
    expect(cleanUrl(" http://127.0.0.1:31680/act/card/abc ")).toBe(
      "http://127.0.0.1:31680/act/card/abc",
    );
    expect(cleanUrl("http://x/y).")).toBe("http://x/y");
  });
});

describe("formatYesNoToastBody", () => {
  it("renders Info · Yes · No HTML anchors (no raw URL lines)", () => {
    const out = formatYesNoToastBody(
      "Ship it?",
      "http://127.0.0.1:31680/act/card/abc ",
      "http://127.0.0.1:31680/act/v1/yes ",
      "http://127.0.0.1:31680/act/v1/no",
    );
    expect(out).toContain("Ship it?");
    expect(out).toContain('<a href="http://127.0.0.1:31680/act/card/abc">Info</a>');
    expect(out).toContain('<a href="http://127.0.0.1:31680/act/v1/yes">Yes</a>');
    expect(out).toContain('<a href="http://127.0.0.1:31680/act/v1/no">No</a>');
    expect(out).toContain(" · ");
    expect(out).not.toContain("Info: http");
    expect(out).not.toContain("tap Info");
  });
});

describe("formatNotifyActLinksForToast", () => {
  it("returns cleaned plain URL lines", () => {
    const links = [
      { label: "Yes", url: "http://127.0.0.1:31670/act/v1/a ", token: "a" },
      { label: "No", url: "http://127.0.0.1:31670/act/v1/b", token: "b" },
    ];
    const out = formatNotifyActLinksForToast(links);
    expect(out).toContain("Yes: http://127.0.0.1:31670/act/v1/a");
    expect(out).not.toContain("a ");
  });
});

describe("yesNoNotifyActActions", () => {
  it("defaults Yes and No peer to manager with operator-decide msgs", () => {
    const actions = yesNoNotifyActActions({ title: "Ship CTA?" });
    expect(actions).toHaveLength(2);
    expect(actions[0]?.params.target).toBe("manager");
    expect(String(actions[0]?.params.msg)).toContain("PRIORITY [operator-decide] YES — Ship CTA?");
  });
});

describe("formatOperatorDecideMsg", () => {
  it("wraps custom notes under operator-decide with PRIORITY", () => {
    expect(formatOperatorDecideMsg("YES", "T", "ship it")).toBe(
      "PRIORITY [operator-decide] YES — T\nship it",
    );
  });
});
