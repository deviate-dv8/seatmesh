import { describe, expect, it } from "vitest";
import {
  floorDuration,
  formatTodoExpect,
  TODO_CB_MIN_DURATION,
  todoCheckbackId,
} from "./todos-config.js";

describe("todos-config", () => {
  it("floors durations below min", () => {
    expect(floorDuration("5m", 20 * 60, TODO_CB_MIN_DURATION)).toBe(TODO_CB_MIN_DURATION);
    expect(floorDuration("19m", 20 * 60, TODO_CB_MIN_DURATION)).toBe(TODO_CB_MIN_DURATION);
    expect(floorDuration("20m", 20 * 60, TODO_CB_MIN_DURATION)).toBe("20m");
    expect(floorDuration("1h", 20 * 60, TODO_CB_MIN_DURATION)).toBe("1h");
  });

  it("formats expect + stable cb id", () => {
    expect(formatTodoExpect("slot-1", "fix login")).toBe("todo:slot-1 fix login");
    expect(todoCheckbackId("slot-1", "Fix Login")).toMatch(/^cb-todo-slot-1-fix-login$/);
  });
});
