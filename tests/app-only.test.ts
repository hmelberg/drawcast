import { describe, expect, test } from "vitest";
import { stripAppOnly } from "../src/spec/app-only";
import type { Spec } from "../src/spec/types";

describe("stripAppOnly — what a movie leaves out", () => {
  const spec = {
    title: "t",
    elements: [
      { id: "curve", type: "curve", expr: "x" },
      { id: "more", type: "text", text: "The math ▸", details: "$y = x$", app_only: true },
      { id: "more_label", type: "label", text: "click", attach_to: "more" },
      { id: "g", type: "group", members: ["curve", "more"] },
    ],
    commands: [
      { draw: ["curve", "more"], speak: "A line." },
      { draw: ["more"], speak: "Click for the math." },
      { highlight: { target: ["more"] } },
      { point: { at: { ref: "more" } }, speak: "Here." },
      { highlight: { target: ["curve", "more"], effect: "glow" } },
    ],
  } as unknown as Spec;

  test("the element, its label and its group membership go", () => {
    const out = stripAppOnly(spec);
    expect(out.elements!.map((e) => e.id)).toEqual(["curve", "g"]);
    expect(out.elements!.find((e) => e.id === "g")!.members).toEqual(["curve"]);
  });

  test("commands keep what they still do, and every sentence", () => {
    expect(stripAppOnly(spec).commands).toEqual([
      { draw: ["curve"], speak: "A line." },
      { speak: "Click for the math." },
      { speak: "Here." },
      { highlight: { target: ["curve"], effect: "glow" } },
    ]);
  });

  test("a spec with nothing app-only is returned as is", () => {
    const plain = { title: "t", elements: [{ id: "a", type: "text", text: "x" }], commands: [] } as unknown as Spec;
    expect(stripAppOnly(plain)).toBe(plain);
  });
});
