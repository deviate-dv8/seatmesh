import { describe, expect, it } from "vitest";
import {
  formatMeshInboxStamp,
  hubLockActive,
  intentKeepsShellFooter,
  parseMeshInboxIntent,
  stripReplyPeerFooter,
} from "./mesh-inbox-intent.js";

describe("mesh-inbox-intent", () => {
  it("stamps intent on mesh-inbox lines", () => {
    expect(formatMeshInboxStamp("[mesh-inbox] Check: foo", "checkback-verify")).toBe(
      "[mesh-inbox] intent=checkback-verify Check: foo",
    );
  });

  it("parses intent", () => {
    expect(parseMeshInboxIntent("[mesh-inbox] intent=continue CONTINUE: x")).toBe("continue");
  });

  it("strips Reply peer footer", () => {
    const raw = "line\nReply: peer manager \"<msg>\"";
    expect(stripReplyPeerFooter(raw)).toBe("line");
  });

  it("keeps checkback-verify kill shell (Ignored-chat failure mode)", () => {
    expect(intentKeepsShellFooter("checkback-verify")).toBe(true);
    expect(intentKeepsShellFooter("continue")).toBe(false);
  });

  it("hubLockActive is false when no lock file", () => {
    expect(hubLockActive("/tmp/no-such-workspace-zsign-test")).toBe(false);
  });
});
