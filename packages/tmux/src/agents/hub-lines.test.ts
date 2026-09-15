import { describe, expect, it } from "vitest";
import { hubRetrievalWhoamiLines } from "./hub-lines.js";

describe("hubRetrievalWhoamiLines", () => {
  it("teaches retrieve + mutate for hub entities", () => {
    const text = hubRetrievalWhoamiLines().join("\n");
    expect(text).toMatch(/--- retrieval \(hub\) ---/);
    expect(text).toMatch(/hub_entities=contexts/);
    expect(text).toMatch(/retrieve_chat=/);
    expect(text).toMatch(/mutate_acks=/);
    expect(text).toMatch(/mutate_cbs=/);
    expect(text).toMatch(/mutate_notify=/);
    expect(text).toMatch(/operator_eyes=/);
    expect(text).toMatch(/help notify/);
  });
});
