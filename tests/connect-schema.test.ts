import { describe, it, expect } from "vitest";
import { validateSpec } from "../src/spec/schema";

const base = (ask: Record<string, unknown>) => ({
  title: "T",
  template: "sky_map",
  params: { focus: "con_ori" },
  commands: [{ draw: "all" }, { ask }],
});

const errorsOf = (spec: unknown): string[] => validateSpec(spec).errors ?? [];

describe("ask.widget connect", () => {
  it("accepts the shape the author writes", () => {
    expect(errorsOf(base({ question: "Draw Orion.", widget: "connect", answer: "con_ori", right: "The belt is the three in a row." }))).toEqual([]);
  });
  it("needs the constellation as its answer", () => {
    expect(errorsOf(base({ question: "Draw Orion.", widget: "connect", right: "x" })).join(" ")).toContain("answer");
  });
  it("needs a right line, because the reveal is a sentence", () => {
    expect(errorsOf(base({ question: "Draw Orion.", widget: "connect", answer: "con_ori" })).join(" ")).toContain("right");
  });
  it("takes no items and no tolerance — those belong to drag", () => {
    const errs = errorsOf(base({ question: "q", widget: "connect", answer: "con_ori", right: "r", items: ["a"] })).join(" ");
    expect(errs).toContain("items");
  });
});
