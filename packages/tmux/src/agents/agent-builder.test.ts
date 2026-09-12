import { describe, expect, it } from "vitest";
import { buildAgentLaunchCmd } from "./agent-builder.js";

describe("buildAgentLaunchCmd opencode", () => {
  const ws = "/tmp/workspace";

  it("launches fresh when no resume id", () => {
    expect(buildAgentLaunchCmd("opencode", ws)).toBe(
      `cd ${ws} && ${ws}/scripts/opencode-cpe.sh`,
    );
  });

  it("passes --session when resume id is set", () => {
    expect(
      buildAgentLaunchCmd("opencode", ws, "ses_f6b3245b0ffe92gpOAVSl31ObU"),
    ).toBe(
      `cd ${ws} && ${ws}/scripts/opencode-cpe.sh --session ses_f6b3245b0ffe92gpOAVSl31ObU`,
    );
  });
});
