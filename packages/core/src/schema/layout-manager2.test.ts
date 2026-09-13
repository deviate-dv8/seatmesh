import { describe, expect, it } from "vitest";
import { LayoutSchema } from "./layout.js";

describe("layout open column ids", () => {
  it("accepts manager + manager-2 + secretary", () => {
    const layout = LayoutSchema.parse({
      base: {
        columns: ["manager", "manager-2", "secretary"],
        cli: {
          manager: "agent",
          "manager-2": "agent",
          secretary: "opencode",
        },
      },
    });
    expect(layout.base.columns).toEqual(["manager", "manager-2", "secretary"]);
    expect(layout.base.cli?.["manager-2"]).toBe("agent");
  });
});
