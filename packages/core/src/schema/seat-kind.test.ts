import { describe, expect, it } from "vitest";
import { LayoutSchema } from "./layout.js";
import {
  expandColumnAlias,
  humanCoTypedColumnIds,
  isCoordKind,
  isHumanCoTypedColumn,
  isManagerKind,
  isSecretaryKind,
  managerColumnIds,
  seatKindFromId,
  secretaryColumnIds,
} from "./seat-kind.js";

describe("seat kinds vs open column ids", () => {
  it("infers kind from prefix without a manager-N enum", () => {
    expect(seatKindFromId("manager")).toBe("manager");
    expect(seatKindFromId("manager-2")).toBe("manager");
    expect(seatKindFromId("manager-100")).toBe("manager");
    expect(seatKindFromId("manager-relief")).toBe("manager");
    expect(seatKindFromId("lead-west")).toBe("manager");
    expect(seatKindFromId("secretary")).toBe("secretary");
    expect(seatKindFromId("secretary-2")).toBe("secretary");
    expect(seatKindFromId("mini-3")).toBe("mini");
    expect(seatKindFromId("slot-4")).toBe("worker");
    expect(seatKindFromId("")).toBe("plain");
    expect(seatKindFromId("plain")).toBe("plain");
  });

  it("profile kinds map overrides prefix", () => {
    const kinds = { coach: "secretary" as const, "sec-a": "secretary" as const };
    expect(seatKindFromId("coach", kinds)).toBe("secretary");
    expect(isSecretaryKind("sec-a", kinds)).toBe(true);
  });

  it("accepts N manager + N secretary columns in layout", () => {
    const layout = LayoutSchema.parse({
      base: {
        columns: ["manager", "manager-2", "lead-west", "secretary", "secretary-2"],
        cli: {
          "lead-west": "claude",
          "secretary-2": "opencode",
        },
        kinds: { "lead-west": "manager" },
      },
    });
    expect(layout.base.columns).toHaveLength(5);
    expect(managerColumnIds(layout)).toEqual(["manager", "manager-2", "lead-west"]);
    expect(secretaryColumnIds(layout)).toEqual(["secretary", "secretary-2"]);
    expect(isCoordKind("lead-west", layout.base.kinds)).toBe(true);
    expect(isManagerKind("manager-2")).toBe(true);
  });

  it("expands compact aliases", () => {
    expect(expandColumnAlias("manager2")).toEqual(
      expect.arrayContaining(["manager2", "manager-2"]),
    );
    expect(expandColumnAlias("secretary-2")).toEqual(
      expect.arrayContaining(["secretary-2", "secretary2"]),
    );
    expect(expandColumnAlias("sec")).toContain("secretary");
    expect(expandColumnAlias("mgr")).toContain("manager");
  });
});

describe("humanCoTyped columns (FQ-inject-co-typed-pane)", () => {
  it("defaults humanCoTyped to empty when the profile sets nothing", () => {
    expect(humanCoTypedColumnIds()).toEqual([]);
    expect(isHumanCoTypedColumn("manager-2")).toBe(false);
    expect(isHumanCoTypedColumn("manager")).toBe(false);
    expect(isHumanCoTypedColumn("secretary")).toBe(false);
  });

  it("profile layout.base.humanCoTyped overrides the default list", () => {
    const layout = LayoutSchema.parse({
      base: {
        columns: ["manager", "lead-west", "secretary"],
        humanCoTyped: ["lead-west"],
      },
    });
    expect(humanCoTypedColumnIds(layout)).toEqual(["lead-west"]);
    expect(isHumanCoTypedColumn("lead-west", layout)).toBe(true);
    expect(isHumanCoTypedColumn("manager-2", layout)).toBe(false);
  });
});
