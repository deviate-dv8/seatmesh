import { describe, expect, it } from "vitest";
import { buildAgentLaunchCmd } from "./agent-builder.js";

describe("buildAgentLaunchCmd kiro", () => {
  const ws = "/tmp/workspace";

  it("launches kiro-cli chat with opus when no resume id", () => {
    expect(buildAgentLaunchCmd("kiro", ws)).toBe(
      "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor kiro-cli chat --trust-all-tools --model claude-opus-5",
    );
  });

  it("passes --resume-id when resume id is set", () => {
    expect(buildAgentLaunchCmd("kiro", ws, "abc-123")).toBe(
      "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor kiro-cli chat --resume-id abc-123 --trust-all-tools --model claude-opus-5",
    );
  });
});

describe("buildAgentLaunchCmd agent (cursor)", () => {
  const ws = "/tmp/workspace";

  it("passes --trust --approve-mcps so workspace accept prompt does not block spawn", () => {
    expect(buildAgentLaunchCmd("agent", ws)).toBe(
      "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor agent --trust --approve-mcps --workspace /tmp/workspace",
    );
  });

  it("keeps --trust with --resume", () => {
    expect(buildAgentLaunchCmd("cursor-agent", ws, "abc-uuid")).toBe(
      "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor agent --trust --approve-mcps --resume abc-uuid --workspace /tmp/workspace",
    );
  });
});

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
