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
  it("returns blurb only — Info/Yes/No are toast buttons, not body links", () => {
    const out = formatYesNoToastBody(
      "Ship it?",
      "http://127.0.0.1:31680/act/card/abc ",
      "http://127.0.0.1:31680/act/v1/yes ",
      "http://127.0.0.1:31680/act/v1/no",
    );
    expect(out).toBe("Ship it?");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("http://");
    expect(out).not.toContain(" · ");
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

  it("appends card/info/target/session meta lines", () => {
    const out = formatOperatorDecideMsg("YES", "Act card → hub", undefined, {
      cardId: "abc-123",
      infoUrl: "http://127.0.0.1:3190/act/card/abc-123?port=31680",
      target: "manager",
      session: "mesh-c87d62",
    });
    expect(out).toBe(
      [
        "PRIORITY [operator-decide] YES — Act card → hub",
        "card=abc-123",
        "info=http://127.0.0.1:3190/act/card/abc-123?port=31680",
        "target=manager",
        "session=mesh-c87d62",
      ].join("\n"),
    );
  });
});
