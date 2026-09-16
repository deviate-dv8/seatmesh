import { describe, expect, it } from "vitest";
import {
  injectOpenCodeSessionIntoCmd,
  isOpenCodeCpeResumeCmd,
} from "./save-session.js";

const CPE =
  "cd '/w' && env -u NO_COLOR COLORTERM=truecolor '/w/scripts/opencode-cpe.sh' --session ses_old";

describe("CPE resumeCmd helpers", () => {
  it("detects opencode-cpe.sh wrappers", () => {
    expect(isOpenCodeCpeResumeCmd(CPE)).toBe(true);
    expect(isOpenCodeCpeResumeCmd("opencode --auto")).toBe(false);
  });

  it("refreshes --session without dropping wrapper", () => {
    const sid = "ses_f6b3245b0ffe92gpOAVSl31ObU";
    const out = injectOpenCodeSessionIntoCmd(CPE, sid);
    expect(out).toContain("opencode-cpe.sh");
    expect(out).toContain(`--session ${sid}`);
    expect(out).not.toContain("ses_old");
  });
});
